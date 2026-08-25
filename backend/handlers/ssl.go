package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ksm-dns/models"
	"ksm-dns/services/deploy"
	"ksm-dns/services/ssl"
)

type SSLHandler struct {
	DB       *gorm.DB
	SSL      *ssl.Service
	Deploy   *deploy.Service
}

// --- Certificates ---

func (h *SSLHandler) ListCertificates(c *gin.Context) {
	var certs []models.SSLCertificate
	query := h.DB.Preload("Domain").Order("id desc")
	if domainIDs, isAdmin := allowedDomainIDs(h.DB, c); !isAdmin {
		query = query.Where("domain_id IN ?", domainIDs)
	}
	p := parsePagination(c, 20)
	var total int64
	query.Model(&models.SSLCertificate{}).Count(&total)
	query.Limit(p.PageSize).Offset(p.Offset).Find(&certs)
	c.JSON(http.StatusOK, paginatedResult(certs, total, p))
}

func (h *SSLHandler) GetCertificate(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var cert models.SSLCertificate
	if err := h.DB.Preload("Domain").First(&cert, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "证书不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cert})
}

func (h *SSLHandler) CreateCertificate(c *gin.Context) {
	var req struct {
		DomainID   uint   `json:"domain_id" binding:"required"`
		DomainName string `json:"domain_name" binding:"required"`
		Provider   string `json:"provider"`
		AutoRenew  *bool  `json:"auto_renew"`
		EABKID     string `json:"eab_kid"`
		EABHMACKey string `json:"eab_hmac_key"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	var domain models.Domain
	if err := h.DB.Preload("Platform").First(&domain, req.DomainID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "域名不存在"})
		return
	}

	provider := req.Provider
	if provider == "" {
		provider = "letsencrypt"
	}
	switch provider {
	case "letsencrypt", "zerossl", "google":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的证书机构，仅支持 Let's Encrypt、ZeroSSL 和 Google Trust Services"})
		return
	}

	// Persist EAB credentials so re-issues and auto-renewals can re-use them.
	if (provider == "zerossl" || provider == "google") && req.EABHMACKey != "" {
		h.DB.Where("key = ?", "acme_eab_kid_"+provider).Assign(models.Setting{Value: req.EABKID}).
			FirstOrCreate(&models.Setting{Key: "acme_eab_kid_" + provider})
		h.DB.Where("key = ?", "acme_eab_hmac_"+provider).Assign(models.Setting{Value: req.EABHMACKey}).
			FirstOrCreate(&models.Setting{Key: "acme_eab_hmac_" + provider})
	}

	autoRenew := true
	if req.AutoRenew != nil {
		autoRenew = *req.AutoRenew
	}

	cert := models.SSLCertificate{
		DomainID:   req.DomainID,
		DomainName: req.DomainName,
		Provider:   provider,
		AutoRenew:  autoRenew,
		Status:     "pending",
	}
	if err := h.DB.Create(&cert).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}

	// Issue immediately so the caller receives the full result.
	if err := h.SSL.Issue(&cert); err != nil {
		h.DB.Model(&models.SSLCertificate{}).Where("id = ?", cert.ID).Update("status", "failed")
		cert.Status = "failed"
		c.JSON(http.StatusOK, gin.H{"data": cert, "message": "证书签发失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cert})
}

func (h *SSLHandler) IssueCertificate(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var cert models.SSLCertificate
	if err := h.DB.First(&cert, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "证书不存在"})
		return
	}
	if err := h.SSL.Issue(&cert); err != nil {
		h.DB.Model(&models.SSLCertificate{}).Where("id = ?", cert.ID).Update("status", "failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "证书签发失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cert})
}

func (h *SSLHandler) DeleteCertificate(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	h.DB.Where("certificate_id = ?", id).Delete(&models.SSLDeployTarget{})
	h.DB.Delete(&models.SSLCertificate{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// DownloadCertificate streams the certificate chain PEM file to the client.
func (h *SSLHandler) DownloadCertificate(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var cert models.SSLCertificate
	if err := h.DB.First(&cert, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "证书不存在"})
		return
	}
	if cert.Certificate == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "证书尚未签发，无法下载"})
		return
	}
	filename := strings.ReplaceAll(cert.DomainName, "*", "_") + ".crt"
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Header("Content-Type", "application/x-pem-file")
	c.String(http.StatusOK, cert.Certificate)
}

// DownloadPrivateKey streams the certificate private key PEM file to the client.
func (h *SSLHandler) DownloadPrivateKey(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var cert models.SSLCertificate
	if err := h.DB.First(&cert, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "证书不存在"})
		return
	}
	if cert.PrivateKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "证书尚未签发，无法下载"})
		return
	}
	filename := strings.ReplaceAll(cert.DomainName, "*", "_") + ".key"
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Header("Content-Type", "application/x-pem-file")
	c.String(http.StatusOK, cert.PrivateKey)
}

// --- Deploy targets ---

func (h *SSLHandler) ListDeployTargets(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	query := h.DB.Model(&models.SSLDeployTarget{}).Where("certificate_id = ?", id)
	p := parsePagination(c, 20)
	var total int64
	query.Count(&total)
	var targets []models.SSLDeployTarget
	query.Order("id desc").Limit(p.PageSize).Offset(p.Offset).Find(&targets)
	c.JSON(http.StatusOK, paginatedResult(targets, total, p))
}

func (h *SSLHandler) CreateDeployTarget(c *gin.Context) {
	certID, ok := parseUintParam(c, "id"); if !ok { return }
	var cert models.SSLCertificate
	if err := h.DB.First(&cert, certID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "证书不存在"})
		return
	}

	var req struct {
		Name       string `json:"name" binding:"required"`
		Host       string `json:"host" binding:"required"`
		Port       int    `json:"port"`
		Username   string `json:"username"`
		AuthType   string `json:"auth_type"`
		Password   string `json:"password"`
		PrivateKey string `json:"private_key"`
		CertPath   string `json:"cert_path" binding:"required"`
		KeyPath    string `json:"key_path" binding:"required"`
		ReloadCmd  string `json:"reload_cmd"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if req.AuthType != "password" && req.AuthType != "key" {
		req.AuthType = "password"
	}
	port := req.Port
	if port <= 0 {
		port = 22
	}

	target := models.SSLDeployTarget{
		CertificateID: uint(certID),
		Name:          req.Name,
		Host:          req.Host,
		Port:          port,
		Username:      req.Username,
		AuthType:      req.AuthType,
		Password:      req.Password,
		PrivateKey:    req.PrivateKey,
		CertPath:      req.CertPath,
		KeyPath:       req.KeyPath,
		ReloadCmd:     req.ReloadCmd,
		Status:        "pending",
	}
	if err := h.DB.Create(&target).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": target})
}

func (h *SSLHandler) UpdateDeployTarget(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var target models.SSLDeployTarget
	if err := h.DB.First(&target, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "部署目标不存在"})
		return
	}

	var req struct {
		Name       string `json:"name"`
		Host       string `json:"host"`
		Port       *int   `json:"port"`
		Username   string `json:"username"`
		AuthType   string `json:"auth_type"`
		Password   string `json:"password"`
		PrivateKey string `json:"private_key"`
		CertPath   string `json:"cert_path"`
		KeyPath    string `json:"key_path"`
		ReloadCmd  string `json:"reload_cmd"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	if req.Name != "" {
		target.Name = req.Name
	}
	if req.Host != "" {
		target.Host = req.Host
	}
	if req.Port != nil && *req.Port > 0 {
		target.Port = *req.Port
	}
	if req.Username != "" {
		target.Username = req.Username
	}
	if req.AuthType != "" {
		if req.AuthType != "password" && req.AuthType != "key" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的认证类型"})
			return
		}
		target.AuthType = req.AuthType
	}
	if req.Password != "" {
		target.Password = req.Password
	}
	if req.PrivateKey != "" {
		target.PrivateKey = req.PrivateKey
	}
	if req.CertPath != "" {
		target.CertPath = req.CertPath
	}
	if req.KeyPath != "" {
		target.KeyPath = req.KeyPath
	}
	target.ReloadCmd = req.ReloadCmd

	if err := h.DB.Save(&target).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": target})
}

func (h *SSLHandler) DeleteDeployTarget(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	h.DB.Delete(&models.SSLDeployTarget{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

func (h *SSLHandler) DeployTarget(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var target models.SSLDeployTarget
	if err := h.DB.First(&target, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "部署目标不存在"})
		return
	}
	if err := h.Deploy.Deploy(&target); err != nil {
		h.DB.Model(&models.SSLDeployTarget{}).Where("id = ?", target.ID).Update("status", "failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "部署失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": target})
}
