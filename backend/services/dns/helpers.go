package dns

import (
	"encoding/json"
	"time"

	"ksm-dns/models"
)

// parseInt converts a string to int, returning 0 on failure.
func parseInt(s string) int {
	var n int
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// parseDate attempts to parse a date string in the given layout. Returns the
// parsed time or an error if the string is empty or malformed.
func parseDate(s, layout string) (time.Time, error) {
	return time.Parse(layout, s)
}

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