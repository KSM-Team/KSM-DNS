package dns

import (
	"time"

	"ksm-dns/models"
)

type Record struct {
	ID      string
	Name    string
	Type    string
	Value   string
	TTL     int
	Proxied bool
}

// DomainInfo holds domain registration details returned by a provider.
type DomainInfo struct {
	DomainName         string
	ExpiryDate         *time.Time
	Registrar          string
	AutoRenewEnabled   bool
	AutoRenewSupported bool
}

type Provider interface {
	ListDomains() ([]string, error)
	ListRecords(domain string) ([]Record, error)
	CreateRecord(domain string, rec Record) (string, error)
	UpdateRecord(domain string, recordID string, rec Record) error
	DeleteRecord(domain string, recordID string) error
	GetDomainInfo(domain string) (*DomainInfo, error)
}

func NewProvider(platform models.DNSPlatform, credentials map[string]string) (Provider, error) {
	switch platform.Type {
	case "cloudflare":
		return NewCloudflare(credentials)
	case "spaceship":
		return NewSpaceship(credentials)
	case "namesilo":
		return NewNamesilo(credentials)
	case "aliyun":
		return NewAliyun(credentials)
	case "tencent":
		return NewTencent(credentials)
	case "porkbun":
		return NewPorkbun(credentials)
	default:
		return nil, ErrUnsupportedPlatform
	}
}