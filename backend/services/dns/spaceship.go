package dns

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// trimDomainSuffix strips the domain suffix from a record name if it ends with
// the given domain. For example, "_acme-challenge.dns.ksm.im" with domain
// "dns.ksm.im" becomes "_acme-challenge". A bare "@" or name that doesn't end
// with the domain is returned unchanged.
func trimDomainSuffix(name, domain string) string {
	if name == "@" || name == "" {
		return name
	}
	suffix := "." + domain
	if strings.HasSuffix(name, suffix) {
		return name[:len(name)-len(suffix)]
	}
	return name
}

type Spaceship struct {
	apiKey    string
	apiSecret string
	client    *http.Client
}

func NewSpaceship(creds map[string]string) (*Spaceship, error) {
	key := creds["api_key"]
	secret := creds["api_secret"]
	if key == "" || secret == "" {
		return nil, ErrInvalidCredentials
	}
	return &Spaceship{
		apiKey:    key,
		apiSecret: secret,
		client:    &http.Client{},
	}, nil
}

func (s *Spaceship) doRequest(method, path string, body interface{}) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reqBody = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, "https://spaceship.dev/api/v1"+path, reqBody)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", s.apiKey)
	req.Header.Set("X-API-Secret", s.apiSecret)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
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

	return respBody, nil
}

type spDomainsResponse struct {
	Items []struct {
		Name string `json:"name"`
	} `json:"items"`
}

type spRecordsResponse struct {
	Items []map[string]interface{} `json:"items"`
}

// spRecordValue extracts the record value from the API response, which uses
// type-specific field names: address, cname, exchange, nameserver, value.
func spRecordValue(item map[string]interface{}, recType string) string {
	switch recType {
	case "A", "AAAA":
		if v, ok := item["address"].(string); ok {
			return v
		}
	case "CNAME":
		if v, ok := item["cname"].(string); ok {
			return v
		}
	case "MX":
		// MX records have exchange + preference; reconstruct the value string
		exchange, _ := item["exchange"].(string)
		pref := 0
		if p, ok := item["preference"].(float64); ok {
			pref = int(p)
		}
		return fmt.Sprintf("%d %s", pref, exchange)
	case "NS":
		if v, ok := item["nameserver"].(string); ok {
			return v
		}
	case "SRV":
		// SRV records have priority, weight, port, target
		pri, _ := item["priority"].(float64)
		weight, _ := item["weight"].(float64)
		port, _ := item["port"].(float64)
		target, _ := item["target"].(string)
		return fmt.Sprintf("%d %d %d %s", int(pri), int(weight), int(port), target)
	case "CAA":
		flag, _ := item["flag"].(float64)
		tag, _ := item["tag"].(string)
		val, _ := item["value"].(string)
		return fmt.Sprintf("%d %s %s", int(flag), tag, val)
	default:
		if v, ok := item["value"].(string); ok {
			return v
		}
	}
	return ""
}

type spCreateResponse struct {
	ID string `json:"id"`
}

// spDeleteRequest is stored as the platform_record_id for Spaceship records.
// It carries enough info to reconstruct a delete request for the API.
type spDeleteRequest struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Value string `json:"value,omitempty"`
}

func (s *Spaceship) ListDomains() ([]string, error) {
	var domains []string
	skip := 0
	take := 100
	for {
		path := fmt.Sprintf("/domains?take=%d&skip=%d", take, skip)
		data, err := s.doRequest("GET", path, nil)
		if err != nil {
			return nil, err
		}
		var resp spDomainsResponse
		if err := json.Unmarshal(data, &resp); err != nil {
			return nil, err
		}
		for _, d := range resp.Items {
			domains = append(domains, d.Name)
		}
		if len(resp.Items) < take {
			break
		}
		skip += take
	}
	return domains, nil
}

func (s *Spaceship) ListRecords(domain string) ([]Record, error) {
	path := fmt.Sprintf("/dns/records/%s?take=500&skip=0", domain)
	data, err := s.doRequest("GET", path, nil)
	if err != nil {
		fmt.Printf("[Spaceship] ListRecords(%s): API error: %v\n", domain, err)
		return nil, err
	}
	fmt.Printf("[Spaceship] ListRecords(%s): raw response: %s\n", domain, string(data))
	var resp spRecordsResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, err
	}

	records := make([]Record, 0, len(resp.Items))
	for _, r := range resp.Items {
		recType, _ := r["type"].(string)
		recName, _ := r["name"].(string)
		recValue := spRecordValue(r, recType)
		recTTL := 0
		if t, ok := r["ttl"].(float64); ok {
			recTTL = int(t)
		}
		// Store type+name+value as JSON so DeleteRecord can reconstruct the
		// correct request body (the Spaceship API requires the value field).
		idJSON, _ := json.Marshal(spDeleteRequest{Type: recType, Name: recName, Value: recValue})
		records = append(records, Record{
			ID:    string(idJSON),
			Name:  recName,
			Type:  recType,
			Value: recValue,
			TTL:   recTTL,
		})
	}
	return records, nil
}

// spItem builds a DNS record item map for the Spaceship API. The API uses
// type-specific field names: address, cname, exchange, nameserver, etc.
// Complex types (MX, SRV, CAA) are parsed from the space-separated Value.
func spItem(rec Record) map[string]interface{} {
	item := map[string]interface{}{
		"name": rec.Name,
		"type": rec.Type,
		"ttl":  rec.TTL,
	}
	parts := strings.Fields(rec.Value)
	switch rec.Type {
	case "A", "AAAA":
		item["address"] = rec.Value
	case "CNAME":
		item["cname"] = rec.Value
	case "MX":
		// Value format: "priority exchange", e.g. "10 mail.example.com"
		if len(parts) >= 2 {
			item["priority"] = parseInt(parts[0])
			item["exchange"] = parts[1]
		}
	case "NS":
		item["nameserver"] = rec.Value
	case "SRV":
		// Value format: "priority weight port target"
		if len(parts) >= 4 {
			item["priority"] = parseInt(parts[0])
			item["weight"] = parseInt(parts[1])
			item["port"] = parseInt(parts[2])
			item["target"] = parts[3]
		}
		// Parse _service._proto from the name
		nameParts := strings.SplitN(rec.Name, ".", 2)
		if len(nameParts) == 2 {
			item["service"] = nameParts[0] // e.g. "_sip"
			item["protocol"] = nameParts[1] // e.g. "_tcp"
		}
	case "CAA":
		// Value format: flag tag "value" or flag tag value
		if len(parts) >= 3 {
			item["flag"] = parseInt(parts[0])
			item["tag"] = parts[1]
			// Re-join remaining parts as the value (handles quoted strings)
			item["value"] = strings.Join(parts[2:], " ")
		}
	default:
		item["value"] = rec.Value
	}
	return item
}

func (s *Spaceship) CreateRecord(domain string, rec Record) (string, error) {
	// Trim the domain suffix from the record name. The ACME client (and
	// potentially other callers) pass the full FQDN like
	// "_acme-challenge.dns.ksm.im", but the Spaceship API expects just the
	// subdomain part ("_acme-challenge") since the zone is already in the URL.
	rec.Name = trimDomainSuffix(rec.Name, domain)

	// Spaceship uses PUT (not POST) for creating DNS records, with the same
	// {force, items} envelope as UpdateRecord.
	body := map[string]interface{}{
		"force": true,
		"items": []map[string]interface{}{spItem(rec)},
	}
	path := "/dns/records/" + domain
	data, err := s.doRequest("PUT", path, body)
	if err != nil {
		fmt.Printf("[Spaceship] CreateRecord(%s): API error: %v\n", domain, err)
		return "", err
	}
	fmt.Printf("[Spaceship] CreateRecord(%s): raw response: %s\n", domain, string(data))
	// Spaceship identifies records by type+name, not by a server-assigned ID.
	// The PUT endpoint returns an empty body on success, so we always use the
	// type+name+value as the platform record ID.
	idJSON, _ := json.Marshal(spDeleteRequest{Type: rec.Type, Name: rec.Name, Value: rec.Value})
	return string(idJSON), nil
}

func (s *Spaceship) UpdateRecord(domain string, recordID string, rec Record) error {
	// Trim the domain suffix (same rationale as CreateRecord).
	rec.Name = trimDomainSuffix(rec.Name, domain)

	// Spaceship API uses PUT /dns/records/{domain} with force:true and items[]
	body := map[string]interface{}{
		"force": true,
		"items": []map[string]interface{}{spItem(rec)},
	}
	path := "/dns/records/" + domain
	data, err := s.doRequest("PUT", path, body)
	if err != nil {
		fmt.Printf("[Spaceship] UpdateRecord(%s): API error: %v\n", domain, err)
		return err
	}
	fmt.Printf("[Spaceship] UpdateRecord(%s): raw response: %s\n", domain, string(data))
	return nil
}

func (s *Spaceship) DeleteRecord(domain string, recordID string) error {
	// recordID is a JSON string like {"type":"A","name":"@","value":"1.2.3.4"}
	// from ListRecords/CreateRecord.
	var delReq spDeleteRequest
	if err := json.Unmarshal([]byte(recordID), &delReq); err != nil {
		return fmt.Errorf("cannot parse Spaceship record ID: %s", recordID)
	}
	// The DELETE API uses the same lowercase field names as create/update,
	// but only needs type + name + the type-specific value field (no ttl).
	item := spItem(Record{Name: delReq.Name, Type: delReq.Type, Value: delReq.Value})
	path := "/dns/records/" + domain
	data, err := s.doRequest("DELETE", path, []map[string]interface{}{item})
	if err != nil {
		fmt.Printf("[Spaceship] DeleteRecord(%s): API error: %v\n", domain, err)
		return err
	}
	fmt.Printf("[Spaceship] DeleteRecord(%s): raw response: %s\n", domain, string(data))
	return nil
}

// spDomainInfoResponse is the response from /domains/:name.
type spDomainInfoResponse struct {
	Name       string `json:"name"`
	ExpiresAt  string `json:"expirationDate"`
	AutoRenew  bool   `json:"autoRenew"`
	Registrar  string `json:"registrar"`
}

func (s *Spaceship) GetDomainInfo(domain string) (*DomainInfo, error) {
	data, err := s.doRequest("GET", "/domains/"+domain, nil)
	if err != nil {
		fmt.Printf("[Spaceship] GetDomainInfo(%s): API error: %v\n", domain, err)
		return nil, err
	}
	fmt.Printf("[Spaceship] GetDomainInfo(%s): raw response: %s\n", domain, string(data))
	var resp spDomainInfoResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		fmt.Printf("[Spaceship] GetDomainInfo(%s): unmarshal error: %v\n", domain, err)
		return nil, err
	}
	info := &DomainInfo{
		DomainName:         resp.Name,
		AutoRenewEnabled:   resp.AutoRenew,
		AutoRenewSupported: true,
		Registrar:          resp.Registrar,
	}
	if t, err := parseDate(resp.ExpiresAt, time.RFC3339); err == nil {
		info.ExpiryDate = &t
	}
	return info, nil
}