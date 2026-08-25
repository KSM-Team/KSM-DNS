package dns

import (
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Namesilo implements the Provider interface against the Namesilo XML API.
// API docs: https://www.namesilo.com/api-reference
type Namesilo struct {
	apiKey string
	client *http.Client
}

func NewNamesilo(creds map[string]string) (*Namesilo, error) {
	key := creds["api_key"]
	if key == "" {
		return nil, ErrInvalidCredentials
	}
	return &Namesilo{
		apiKey: key,
		client: &http.Client{},
	}, nil
}

// nsReply mirrors the subset of the Namesilo XML envelope we read. The reply
// carries either a <domains> or <resource_record> payload depending on the
// operation, plus a status <code> (300 = success).
type nsReply struct {
	Code   string `xml:"reply>code"`
	Detail string `xml:"reply>detail"`
	Domains []struct {
		Domain string `xml:"domain"`
	} `xml:"reply>domains>domain"`
	Records []struct {
		RecordID string `xml:"record_id"`
		Type     string `xml:"type"`
		Host     string `xml:"host"`
		Value    string `xml:"value"`
		TTL      int    `xml:"ttl"`
	} `xml:"reply>resource_record"`
	RecordID string `xml:"reply>record_id"`
}

func (n *Namesilo) call(operation string, params url.Values) (*nsReply, error) {
	params.Set("version", "1")
	params.Set("type", "xml")
	params.Set("key", n.apiKey)

	reqURL := "https://www.namesilo.com/api/" + operation + "?" + params.Encode()
	resp, err := n.client.Get(reqURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrAPIRequest, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("%w: HTTP %d - %s", ErrAPIRequest, resp.StatusCode, string(body))
	}

	var reply nsReply
	if err := xml.Unmarshal(body, &reply); err != nil {
		return nil, err
	}
	if reply.Code != "300" {
		return nil, fmt.Errorf("%w: %s (%s)", ErrAPIRequest, reply.Detail, reply.Code)
	}
	return &reply, nil
}

// rrhost converts an app record name ("www", "@", or a full hostname) to the
// Namesilo "rrhost" parameter, which expects the bare subdomain (blank = root).
func (n *Namesilo) rrhost(domain, name string) string {
	name = strings.TrimSpace(name)
	if name == "" || name == "@" {
		return ""
	}
	name = strings.TrimSuffix(name, "."+domain)
	name = strings.TrimSuffix(name, domain)
	return strings.TrimSuffix(name, ".")
}

func (n *Namesilo) ListDomains() ([]string, error) {
	reply, err := n.call("listDomains", url.Values{})
	if err != nil {
		return nil, err
	}
	domains := make([]string, 0, len(reply.Domains))
	for _, d := range reply.Domains {
		if d.Domain != "" {
			domains = append(domains, d.Domain)
		}
	}
	return domains, nil
}

func (n *Namesilo) ListRecords(domain string) ([]Record, error) {
	reply, err := n.call("dnsListRecords", url.Values{"domain": {domain}})
	if err != nil {
		return nil, err
	}
	records := make([]Record, 0, len(reply.Records))
	for _, r := range reply.Records {
		name := r.Host
		name = strings.TrimSuffix(name, "."+domain)
		name = strings.TrimSuffix(name, domain)
		name = strings.TrimSuffix(name, ".")
		if name == "" {
			name = "@"
		}
		records = append(records, Record{
			ID:    r.RecordID,
			Name:  name,
			Type:  r.Type,
			Value: r.Value,
			TTL:   r.TTL,
		})
	}
	return records, nil
}

func (n *Namesilo) CreateRecord(domain string, rec Record) (string, error) {
	reply, err := n.call("dnsAddRecord", url.Values{
		"domain":  {domain},
		"rrtype":  {rec.Type},
		"rrhost":  {n.rrhost(domain, rec.Name)},
		"rrvalue": {rec.Value},
		"rrttl":   {fmt.Sprintf("%d", rec.TTL)},
	})
	if err != nil {
		return "", err
	}
	return reply.RecordID, nil
}

func (n *Namesilo) UpdateRecord(domain string, recordID string, rec Record) error {
	_, err := n.call("dnsUpdateRecord", url.Values{
		"domain":  {domain},
		"rrid":    {recordID},
		"rrhost":  {n.rrhost(domain, rec.Name)},
		"rrvalue": {rec.Value},
		"rrttl":   {fmt.Sprintf("%d", rec.TTL)},
	})
	return err
}

func (n *Namesilo) DeleteRecord(domain string, recordID string) error {
	_, err := n.call("dnsDeleteRecord", url.Values{
		"domain": {domain},
		"rrid":   {recordID},
	})
	return err
}
