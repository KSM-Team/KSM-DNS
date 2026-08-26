package dns

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type Cloudflare struct {
	apiToken string
	client   *http.Client
}

func NewCloudflare(creds map[string]string) (*Cloudflare, error) {
	token := creds["api_token"]
	if token == "" {
		return nil, ErrInvalidCredentials
	}
	return &Cloudflare{
		apiToken: token,
		client:   &http.Client{},
	}, nil
}

func (c *Cloudflare) doRequest(method, path string, body interface{}) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reqBody = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, "https://api.cloudflare.com/client/v4"+path, reqBody)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
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

type cfZoneResponse struct {
	Result []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"result"`
	ResultInfo struct {
		Page       int `json:"page"`
		PerPage    int `json:"per_page"`
		TotalPages int `json:"total_pages"`
		TotalCount int `json:"total_count"`
	} `json:"result_info"`
	Success bool `json:"success"`
}

type cfRecordResponse struct {
	Result []struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Type    string `json:"type"`
		Content string `json:"content"`
		TTL     int    `json:"ttl"`
		Proxied bool   `json:"proxied"`
	} `json:"result"`
	Success bool `json:"success"`
}

type cfSingleRecordResponse struct {
	Result struct {
		ID string `json:"id"`
	} `json:"result"`
	Success bool `json:"success"`
}

func (c *Cloudflare) getZoneID(domain string) (string, error) {
	data, err := c.doRequest("GET", "/zones?name="+domain, nil)
	if err != nil {
		return "", err
	}
	var resp cfZoneResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return "", err
	}
	if !resp.Success || len(resp.Result) == 0 {
		return "", ErrDomainNotFound
	}
	return resp.Result[0].ID, nil
}

func (c *Cloudflare) ListDomains() ([]string, error) {
	var domains []string
	page := 1
	for {
		path := fmt.Sprintf("/zones?per_page=50&page=%d", page)
		data, err := c.doRequest("GET", path, nil)
		if err != nil {
			return nil, err
		}
		var resp cfZoneResponse
		if err := json.Unmarshal(data, &resp); err != nil {
			return nil, err
		}
		// Debug: print raw page info
		fmt.Printf("[Cloudflare] page=%d total_pages=%d total_count=%d count=%d success=%v\n",
			page, resp.ResultInfo.TotalPages, resp.ResultInfo.TotalCount, len(resp.Result), resp.Success)
		for _, z := range resp.Result {
			domains = append(domains, z.Name)
		}
		if page >= resp.ResultInfo.TotalPages {
			break
		}
		page++
	}
	fmt.Printf("[Cloudflare] ListDomains returned %d domains: %v\n", len(domains), domains)
	return domains, nil
}

func (c *Cloudflare) ListRecords(domain string) ([]Record, error) {
	zoneID, err := c.getZoneID(domain)
	if err != nil {
		return nil, err
	}

	data, err := c.doRequest("GET", "/zones/"+zoneID+"/dns_records?per_page=100", nil)
	if err != nil {
		return nil, err
	}
	var resp cfRecordResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, err
	}

	records := make([]Record, 0, len(resp.Result))
	for _, r := range resp.Result {
		records = append(records, Record{
			ID:      r.ID,
			Name:    r.Name,
			Type:    r.Type,
			Value:   r.Content,
			TTL:     r.TTL,
			Proxied: r.Proxied,
		})
	}
	return records, nil
}

func (c *Cloudflare) CreateRecord(domain string, rec Record) (string, error) {
	zoneID, err := c.getZoneID(domain)
	if err != nil {
		return "", err
	}

	body := map[string]interface{}{
		"type":    rec.Type,
		"name":    rec.Name,
		"content": rec.Value,
		"ttl":     rec.TTL,
		"proxied": rec.Proxied,
	}

	data, err := c.doRequest("POST", "/zones/"+zoneID+"/dns_records", body)
	if err != nil {
		return "", err
	}
	var resp cfSingleRecordResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return "", err
	}
	return resp.Result.ID, nil
}

func (c *Cloudflare) UpdateRecord(domain string, recordID string, rec Record) error {
	zoneID, err := c.getZoneID(domain)
	if err != nil {
		return err
	}

	body := map[string]interface{}{
		"type":    rec.Type,
		"name":    rec.Name,
		"content": rec.Value,
		"ttl":     rec.TTL,
		"proxied": rec.Proxied,
	}

	_, err = c.doRequest("PUT", "/zones/"+zoneID+"/dns_records/"+recordID, body)
	return err
}

func (c *Cloudflare) DeleteRecord(domain string, recordID string) error {
	zoneID, err := c.getZoneID(domain)
	if err != nil {
		return err
	}
	_, err = c.doRequest("DELETE", "/zones/"+zoneID+"/dns_records/"+recordID, nil)
	return err
}
