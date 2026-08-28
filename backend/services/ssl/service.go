package ssl

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/acme"
	"gorm.io/gorm"

	"ksm-dns/models"
	"ksm-dns/services/dns"
)

// Service issues and renews TLS certificates through Let's Encrypt using the
// DNS-01 challenge, provisioning the TXT records via an existing DNS provider.
type Service struct {
	DB       *gorm.DB
	acctMu   sync.Mutex // protects concurrent accountKey() calls
}

func NewService(db *gorm.DB) *Service {
	return &Service{DB: db}
}

// StartRenewLoop launches the background auto-renew check, running once daily.
// It blocks until stop is closed, so call it in a goroutine.
func (s *Service) StartRenewLoop(stop chan struct{}) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			_, _ = s.CheckRenewals()
		}
	}
}

const (
	acmeAccountKeySetting = "acme_account_key"
	renewBeforeDays       = 30
)

// directoryFor returns the ACME directory URL for a certificate provider. The
// default empty value selects Let's Encrypt via acme.LetsEncryptURL.
func directoryFor(provider string) string {
	switch provider {
	case "zerossl":
		return "https://acme.zerossl.com/v2/DV90"
	case "google":
		return "https://dv.acme-v02.api.pki.goog/directory"
	default:
		return acme.LetsEncryptURL
	}
}

// acmeAccountKeySettingFor returns the per-provider settings key that persists
// the ACME account signing key, so each CA keeps its own distinct account.
func acmeAccountKeySettingFor(provider string) string {
	if provider == "" || provider == "letsencrypt" {
		return acmeAccountKeySetting
	}
	return "acme_account_key_" + provider
}

// eabSettingFor returns the settings key holding the base64url-encoded EAB HMAC
// key for a provider, e.g. "acme_eab_hmac_google".
func eabSettingFor(provider string) string {
	return "acme_eab_hmac_" + provider
}

// eabKidSettingFor returns the settings key holding the EAB key identifier for
// a provider, e.g. "acme_eab_kid_google".
func eabKidSettingFor(provider string) string {
	return "acme_eab_kid_" + provider
}

// Issue performs the ACME DNS-01 flow for the certificate and stores the
// resulting PEM certificate chain and private key, updating its status.
func (s *Service) Issue(cert *models.SSLCertificate) error {
	if cert.DomainID == 0 {
		return fmt.Errorf("证书未绑定域名")
	}
	if cert.DomainName == "" {
		return fmt.Errorf("证书域名不能为空")
	}

	var domain models.Domain
	if err := s.DB.Preload("Platform").First(&domain, cert.DomainID).Error; err != nil {
		return fmt.Errorf("未找到域名: %w", err)
	}

	provider, err := dns.ProviderFor(domain.Platform)
	if err != nil {
		return err
	}

	caProvider := cert.Provider
	if caProvider == "" {
		caProvider = "letsencrypt"
	}

	acctKey, err := s.accountKey(caProvider)
	if err != nil {
		return err
	}

	client := &acme.Client{
		Key:          acctKey,
		HTTPClient:   &http.Client{Timeout: 30 * time.Second},
		DirectoryURL: directoryFor(caProvider),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	// Build the ACME account, attaching an external account binding (EAB) for
	// CAs such as ZeroSSL and Google Trust Services that require one.
	acct := &acme.Account{}
	if eab, err := s.eabBinding(caProvider); err != nil {
		return err
	} else if eab != nil {
		acct.ExternalAccountBinding = eab
	}

	// Register (or re-use) the ACME account associated with our key.
	if _, err := client.Register(ctx, acct, acme.AcceptTOS); err != nil && err != acme.ErrAccountAlreadyExists {
		return fmt.Errorf("注册 ACME 账户失败: %w", err)
	}

	order, err := client.AuthorizeOrder(ctx, acme.DomainIDs(cert.DomainName))
	if err != nil {
		return fmt.Errorf("创建订单失败: %w", err)
	}

	// Cleanup helper: remove any TXT records we created once validation is done.
	var created []string
	defer func() {
		for _, id := range created {
			_ = provider.DeleteRecord(domain.Domain, id)
		}
	}()

	for _, authzURL := range order.AuthzURLs {
		authz, err := client.GetAuthorization(ctx, authzURL)
		if err != nil {
			return fmt.Errorf("获取授权失败: %w", err)
		}
		if authz.Status == acme.StatusValid {
			continue
		}

		var chal *acme.Challenge
		for _, c := range authz.Challenges {
			if c.Type == "dns-01" {
				chal = c
				break
			}
		}
		if chal == nil {
			return fmt.Errorf("未找到 dns-01 挑战")
		}

		txtValue, err := client.DNS01ChallengeRecord(chal.Token)
		if err != nil {
			return fmt.Errorf("计算 TXT 记录失败: %w", err)
		}
		recordName := "_acme-challenge." + cert.DomainName
		recordID, err := provider.CreateRecord(domain.Domain, dns.Record{
			Name:  recordName,
			Type:  "TXT",
			Value: txtValue,
			TTL:   120,
		})
		if err != nil {
			return fmt.Errorf("创建 TXT 记录失败: %w", err)
		}
		created = append(created, recordID)

		// Give DNS a moment to propagate before Let's Encrypt queries the TXT
		// record. Some providers need a few seconds even with low TTLs.
		time.Sleep(5 * time.Second)

		if _, err := client.Accept(ctx, chal); err != nil {
			return fmt.Errorf("确认挑战失败: %w", err)
		}
		if _, err := client.WaitAuthorization(ctx, authz.URI); err != nil {
			return fmt.Errorf("等待验证失败: %w", err)
		}
	}

	// The order transitions to "ready" once all authorizations are satisfied.
	if _, err := client.WaitOrder(ctx, order.URI); err != nil {
		return fmt.Errorf("等待订单失败: %w", err)
	}

	certKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("生成证书密钥失败: %w", err)
	}
	csrDER, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{
		Subject: pkix.Name{CommonName: cert.DomainName},
		DNSNames: []string{cert.DomainName},
	}, certKey)
	if err != nil {
		return fmt.Errorf("生成 CSR 失败: %w", err)
	}

	derChain, _, err := client.CreateOrderCert(ctx, order.FinalizeURL, csrDER, true)
	if err != nil {
		return fmt.Errorf("签发证书失败: %w", err)
	}
	if len(derChain) == 0 {
		return fmt.Errorf("签发返回空证书链")
	}

	// PEM-encode the leaf certificate plus any intermediate/chain certificates.
	var certPEM strings.Builder
	for _, der := range derChain {
		certPEM.Write(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	}

	keyBytes, err := x509.MarshalPKCS8PrivateKey(certKey)
	if err != nil {
		return fmt.Errorf("序列化证书密钥失败: %w", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyBytes})

	// Parse the leaf certificate for validity dates.
	leaf, err := x509.ParseCertificate(derChain[0])
	if err != nil {
		return fmt.Errorf("解析证书失败: %w", err)
	}

	issued := leaf.NotBefore
	expires := leaf.NotAfter
	cert.Certificate = certPEM.String()
	cert.PrivateKey = string(keyPEM)
	cert.IssuedAt = &issued
	cert.ExpiresAt = &expires
	cert.Status = "issued"

	return s.DB.Model(&models.SSLCertificate{}).Where("id = ?", cert.ID).Updates(map[string]interface{}{
		"certificate": cert.Certificate,
		"private_key": cert.PrivateKey,
		"issued_at":   issued,
		"expires_at":  expires,
		"status":      "issued",
	}).Error
}

// CheckRenewals scans issued certificates whose AutoRenew flag is set and that
// expire within renewBeforeDays days, re-issuing them. It returns the number
// of successfully renewed certificates and any individual failures logged to
// the certificate status.
func (s *Service) CheckRenewals() (int, error) {
	var certs []models.SSLCertificate
	if err := s.DB.Where("auto_renew = ? AND status = ?", true, "issued").Find(&certs).Error; err != nil {
		return 0, err
	}

	now := time.Now()
	renewed := 0
	for i := range certs {
		cert := certs[i]
		if cert.ExpiresAt == nil {
			continue
		}
		if now.Add(renewBeforeDays * 24 * time.Hour).Before(*cert.ExpiresAt) {
			continue
		}
		if err := s.Issue(&cert); err != nil {
			s.DB.Model(&models.SSLCertificate{}).Where("id = ?", cert.ID).Update("status", "failed")
			continue
		}
		renewed++
	}
	return renewed, nil
}

// accountKey returns the persisted ACME account signing key for the given
// provider, generating and storing a fresh EC key the first time it is needed.
func (s *Service) accountKey(provider string) (*ecdsa.PrivateKey, error) {
	s.acctMu.Lock()
	defer s.acctMu.Unlock()

	key := acmeAccountKeySettingFor(provider)
	var setting models.Setting
	err := s.DB.Where("key = ?", key).First(&setting).Error
	if err == nil && setting.Value != "" {
		return parseAccountKey(setting.Value)
	}

	acctKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("生成 ACME 账户密钥失败: %w", err)
	}
	keyBytes, err := x509.MarshalPKCS8PrivateKey(acctKey)
	if err != nil {
		return nil, err
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyBytes})

	setting = models.Setting{Key: key, Value: string(keyPEM)}
	if err == nil {
		s.DB.Model(&models.Setting{}).Where("key = ?", key).Update("value", string(keyPEM))
	} else {
		s.DB.Create(&setting)
	}
	return acctKey, nil
}

// parseAccountKey decodes a PEM-encoded PKCS8 ECDSA private key.
func parseAccountKey(pemValue string) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemValue))
	if block == nil {
		return nil, fmt.Errorf("解析 ACME 账户密钥失败")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("解析 ACME 账户密钥失败")
	}
	ec, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("ACME 账户密钥格式无效")
	}
	return ec, nil
}

// eabBinding returns the external account binding for a provider, or nil when
// the provider does not require one. The HMAC key is stored base64url-encoded
// in settings; an empty stored value yields nil rather than an error.
func (s *Service) eabBinding(provider string) (*acme.ExternalAccountBinding, error) {
	if provider != "zerossl" && provider != "google" {
		return nil, nil
	}
	var hmacSetting, kidSetting models.Setting
	s.DB.Where("key = ?", eabSettingFor(provider)).First(&hmacSetting)
	s.DB.Where("key = ?", eabKidSettingFor(provider)).First(&kidSetting)
	raw := decodeEABKey(hmacSetting.Value)
	if len(raw) == 0 {
		return nil, nil
	}
	return &acme.ExternalAccountBinding{
		KID: kidSetting.Value,
		Key: raw,
	}, nil
}

// decodeEABKey decodes an EAB HMAC key that may arrive base64url-encoded
// (with or without padding), standard-base64, or as plain bytes.
func decodeEABKey(s string) []byte {
	if s == "" {
		return nil
	}
	for _, enc := range []*base64.Encoding{
		base64.RawURLEncoding,
		base64.URLEncoding,
		base64.StdEncoding,
		base64.RawStdEncoding,
	} {
		if b, err := enc.DecodeString(s); err == nil {
			return b
		}
	}
	return []byte(s)
}

