package dns

import (
	"encoding/json"

	"ksm-dns/models"
)

// ProviderFor creates a DNS Provider from a platform record by parsing its
// stored credentials JSON. It is the single shared implementation used by the
// monitor, scheduler, SSL service, and DNS handlers.
func ProviderFor(platform models.DNSPlatform) (Provider, error) {
	var creds map[string]string
	if err := json.Unmarshal([]byte(platform.Credentials), &creds); err != nil {
		return nil, err
	}
	return NewProvider(platform, creds)
}