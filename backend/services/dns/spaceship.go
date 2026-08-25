package dns

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

func (s *Spaceship) ListDomains() ([]string, error) {
	data, err := s.doRequest("GET", "/domains", nil)
	if err != nil {
		return nil, err
	}
	var resp spDomainsResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, err
	}
	domains := make([]string, 0, len(resp.Items))
	for _, d := range resp.Items {
		domains = append(domains, d.Name)
	}
	return domains, nil
}

func (s *Spaceship) ListRecords(domain string) ([]Record, error) {
	data, err := s.doRequest("GET", "/dns/"+domain+"/records", nil)
	if err != nil {
		return nil, err
	}
	var resp spRecordsResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, err
	}

	records := make([]Record, 0, len(resp.Items))
	for _, r := range resp.Items {
		records = append(records, Record{
			ID:    r.ID,
			Name:  r.Name,
			Type:  r.Type,
			Value: r.Value,
			TTL:   r.TTL,
		})
	}
	return records, nil
}

func (s *Spaceship) CreateRecord(domain string, rec Record) (string, error) {
	body := map[string]interface{}{
		"name":  rec.Name,
		"type":  rec.Type,
		"value": rec.Value,
		"ttl":   rec.TTL,
	}
	data, err := s.doRequest("POST", "/dns/"+domain+"/records", body)
	if err != nil {
		return "", err
	}
	var resp spCreateResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return "", err
	}
	return resp.ID, nil
}

func (s *Spaceship) UpdateRecord(domain string, recordID string, rec Record) error {
	body := map[string]interface{}{
		"name":  rec.Name,
		"type":  rec.Type,
		"value": rec.Value,
		"ttl":   rec.TTL,
	}
	_, err := s.doRequest("PUT", "/dns/"+domain+"/records/"+recordID, body)
	return err
}

func (s *Spaceship) DeleteRecord(domain string, recordID string) error {
	_, err := s.doRequest("DELETE", "/dns/"+domain+"/records/"+recordID, nil)
	return err
}
