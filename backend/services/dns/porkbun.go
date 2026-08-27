package dns

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Porkbun implements the Provider interface against the Porkbun JSON API.
// API docs: https://porkbun.com/api/json/v3/documentation
type Porkbun struct {
	apiKey    string
	secretKey string
	client    *http.Client
}

func NewPorkbun(creds map[string]string) (*Porkbun, error) {
	apiKey := creds["api_key"]
	secretKey := creds["secret_key"]
	if apiKey == "" || secretKey == "" {
		return nil, ErrInvalidCredentials
	}
	return &Porkbun{
		apiKey:    apiKey,
		secretKey: secretKey,
		client:    &http.Client{},
	}, nil
}

// pbAuth is embedded in every Porkbun API request body.
type pbAuth struct {
	APIKey       string `json:"apikey"`
	SecretAPIKey string `json:"secretapikey"`
}

// pbStatusResponse is used for ping and error responses.
type pbStatusResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

// pbDomainListResponse is the response from /domain/listAll.
type pbDomainListResponse struct {
	Status  string `json:"status"`
	Domains []struct {
		Domain string `json:"domain"`
	} `json:"domains"`
}

// pbRecordResponse is the response from /dns/retrieve/{domain}.
type pbRecordResponse struct {
	Status  string `json:"status"`
	Records []struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Type    string `json:"type"`
		Content string `json:"content"`
		TTL     string `json:"ttl"`
		Prio    string `json:"prio"`
	} `json:"records"`
}

// pbCreateResponse is the response from /dns/create/{domain}.
type pbCreateResponse struct {
	Status string `json:"status"`
	ID     int    `json:"id"`
}

// doRequest sends a POST request to the Porkbun API with the given path and
// body. It merges the auth payload into the body automatically.
func (p *Porkbun) doRequest(path string, body map[string]interface{}) ([]byte, error) {
	if body == nil {
		body = make(map[string]interface{})
	}
	body["apikey"] = p.apiKey
	body["secretapikey"] = p.secretKey

	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", "https://api.porkbun.com/api/json/v3"+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrAPIRequest, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("%w: HTTP %d - %s", ErrAPIRequest, resp.StatusCode, string(respBody))
	}

	// Check for API-level errors (status != "SUCCESS")
	var statusCheck pbStatusResponse
	if err := json.Unmarshal(respBody, &statusCheck); err == nil {
		if statusCheck.Status == "ERROR" {
			return nil, fmt.Errorf("%w: %s", ErrAPIRequest, statusCheck.Message)
		}
	}

	return respBody, nil
}

// parseName strips the domain suffix from a record name, returning the bare
// hostname portion (e.g. "www" or "@" for the root).
func (p *Porkbun) parseName(domain, name string) string {
	name = strings.TrimSpace(name)
	if name == "" || name == domain {
		return "@"
	}
	name = strings.TrimSuffix(name, "."+domain)
	name = strings.TrimSuffix(name, domain)
	name = strings.TrimSuffix(name, ".")
	if name == "" {
		return "@"
	}
	return name
}

// fullName returns the full hostname for a record name (e.g. "www" becomes
// "www.example.com" and "@" becomes "example.com").
func (p *Porkbun) fullName(domain, name string) string {
	name = strings.TrimSpace(name)
	if name == "" || name == "@" {
		return domain
	}
	return name + "." + domain
}

func (p *Porkbun) ListDomains() ([]string, error) {
	data, err := p.doRequest("/domain/listAll", nil)
	if err != nil {
		return nil, err
	}
	var resp pbDomainListResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, err
	}
	domains := make([]string, 0, len(resp.Domains))
	for _, d := range resp.Domains {
		if d.Domain != "" {
			domains = append(domains, d.Domain)
		}
	}
	return domains, nil
}

func (p *Porkbun) ListRecords(domain string) ([]Record, error) {
	data, err := p.doRequest("/dns/retrieve/"+domain, nil)
	if err != nil {
		return nil, err
	}
	var resp pbRecordResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, err
	}

	records := make([]Record, 0, len(resp.Records))
	for _, r := range resp.Records {
		records = append(records, Record{
			ID:    r.ID,
			Name:  p.parseName(domain, r.Name),
			Type:  r.Type,
			Value: r.Content,
			TTL:   parseInt(r.TTL),
		})
	}
	return records, nil
}

func (p *Porkbun) CreateRecord(domain string, rec Record) (string, error) {
	body := map[string]interface{}{
		"name":    rec.Name,
		"type":    rec.Type,
		"content": rec.Value,
		"ttl":     fmt.Sprintf("%d", rec.TTL),
	}

	data, err := p.doRequest("/dns/create/"+domain, body)
	if err != nil {
		return "", err
	}
	var resp pbCreateResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d", resp.ID), nil
}

func (p *Porkbun) UpdateRecord(domain string, recordID string, rec Record) error {
	body := map[string]interface{}{
		"name":    rec.Name,
		"type":    rec.Type,
		"content": rec.Value,
		"ttl":     fmt.Sprintf("%d", rec.TTL),
	}

	_, err := p.doRequest("/dns/edit/"+domain+"/"+recordID, body)
	return err
}

func (p *Porkbun) DeleteRecord(domain string, recordID string) error {
	_, err := p.doRequest("/dns/delete/"+domain+"/"+recordID, nil)
	return err
}

// pbDomainInfoResponse is the response from /domain/getInfo/:domain.
type pbDomainInfoResponse struct {
	Status         string `json:"status"`
	ExpirationDate string `json:"expirationDate"`
	AutoRenew      string `json:"autoRenew"` // "1" or "0"
	WhoisPrivacy   string `json:"whoisPrivacy"`
}

func (p *Porkbun) GetDomainInfo(domain string) (*DomainInfo, error) {
	data, err := p.doRequest("/domain/getInfo/"+domain, nil)
	if err != nil {
		return nil, err
	}
	var resp pbDomainInfoResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, err
	}
	info := &DomainInfo{
		DomainName:         domain,
		AutoRenewEnabled:   resp.AutoRenew == "1",
		AutoRenewSupported: true,
	}
	// Porkbun returns expiration dates in format "MM/DD/YYYY"
	if t, err := parseDate(resp.ExpirationDate, "01/02/2006"); err == nil {
		info.ExpiryDate = &t
	}
	return info, nil
}