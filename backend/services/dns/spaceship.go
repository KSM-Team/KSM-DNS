package dns

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

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
	Items []struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Type  string `json:"type"`
		Value string `json:"value"`
		TTL   int    `json:"ttl"`
	} `json:"items"`
}

type spCreateResponse struct {
	ID string `json:"id"`
}

type spDeleteRequest struct {
	Type string `json:"type"`
	Name string `json:"name"`
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
		// Store type+name as JSON so DeleteRecord can use it (Spaceship API
		// deletes by matching type+name, not by ID).
		idJSON, _ := json.Marshal(spDeleteRequest{Type: r.Type, Name: r.Name})
		records = append(records, Record{
			ID:    string(idJSON),
			Name:  r.Name,
			Type:  r.Type,
			Value: r.Value,
			TTL:   r.TTL,
		})
	}
	return records, nil
}

func (s *Spaceship) CreateRecord(domain string, rec Record) (string, error) {
	body := []map[string]interface{}{{
		"name":  rec.Name,
		"type":  rec.Type,
		"value": rec.Value,
		"ttl":   rec.TTL,
	}}
	path := "/dns/records/" + domain
	data, err := s.doRequest("POST", path, body)
	if err != nil {
		fmt.Printf("[Spaceship] CreateRecord(%s): API error: %v\n", domain, err)
		return "", err
	}
	fmt.Printf("[Spaceship] CreateRecord(%s): raw response: %s\n", domain, string(data))
	// POST returns an array of created records
	var items []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &items); err == nil && len(items) > 0 {
		idJSON, _ := json.Marshal(spDeleteRequest{Type: rec.Type, Name: rec.Name})
		return string(idJSON), nil
	}
	return "", fmt.Errorf("unexpected response from Spaceship create record: %s", string(data))
}

func (s *Spaceship) UpdateRecord(domain string, recordID string, rec Record) error {
	// Spaceship API uses PUT /dns/records/{domain} with force:true and items[]
	body := map[string]interface{}{
		"force": true,
		"items": []map[string]interface{}{{
			"name":  rec.Name,
			"type":  rec.Type,
			"value": rec.Value,
			"ttl":   rec.TTL,
		}},
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
	// recordID is a JSON string like {"type":"A","name":"@"} from ListRecords/CreateRecord
	var delReq []spDeleteRequest
	if err := json.Unmarshal([]byte(recordID), &delReq); err != nil {
		// If recordID is not JSON, try as a single object
		var single spDeleteRequest
		if err := json.Unmarshal([]byte(recordID), &single); err != nil {
			return fmt.Errorf("cannot parse Spaceship record ID: %s", recordID)
		}
		delReq = []spDeleteRequest{single}
	}
	path := "/dns/records/" + domain
	data, err := s.doRequest("DELETE", path, delReq)
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
