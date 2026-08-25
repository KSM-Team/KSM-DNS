package dns

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// Aliyun implements the Provider interface against Alibaba Cloud DNS
// (阿里云云解析 DNS, product code alidns). It signs requests with the
// RPC-style HMAC-SHA1 signature scheme used by the alidns.aliyuncs.com API.
// Docs: https://www.alibabacloud.com/help/en/alibaba-cloud-dns
type Aliyun struct {
	accessKeyID     string
	accessKeySecret string
	client          *http.Client
}

func NewAliyun(creds map[string]string) (*Aliyun, error) {
	id := creds["access_key_id"]
	secret := creds["access_key_secret"]
	if id == "" || secret == "" {
		return nil, ErrInvalidCredentials
	}
	return &Aliyun{
		accessKeyID:     id,
		accessKeySecret: secret,
		client:          &http.Client{},
	}, nil
}

// percentEncode implements the RFC3986 encoding required by Aliyun's
// signature algorithm, then normalises "+", "*" and "%7E" per the spec.
func aliyunPercentEncode(s string) string {
	encoded := url.QueryEscape(s)
	encoded = strings.ReplaceAll(encoded, "+", "%20")
	encoded = strings.ReplaceAll(encoded, "*", "%2A")
	encoded = strings.ReplaceAll(encoded, "%7E", "~")
	return encoded
}

// aliyunSign produces the "Signature" parameter value for a request.
func (a *Aliyun) aliyunSign(params url.Values) string {
	// Build the canonicalized query string: sorted keys, each key=value pair
	// individually percent-encoded.
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var parts []string
	for _, k := range keys {
		parts = append(parts, aliyunPercentEncode(k)+"="+aliyunPercentEncode(params.Get(k)))
	}
	canonicalized := strings.Join(parts, "&")

	stringToSign := "GET&%2F&" + aliyunPercentEncode(canonicalized)

	mac := hmac.New(sha1.New, []byte(a.accessKeySecret+"&"))
	mac.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// call performs a signed GET to the alidns API and decodes the JSON body.
// Aliyun returns an HTTP 200 even for logical errors, which are surfaced in
// the "Code"/"Message" fields of the top-level object.
func (a *Aliyun) call(action string, params url.Values) (map[string]interface{}, error) {
	params.Set("Format", "JSON")
	params.Set("Version", "2015-01-09")
	params.Set("AccessKeyId", a.accessKeyID)
	params.Set("SignatureMethod", "HMAC-SHA1")
	params.Set("SignatureVersion", "1.0")
	params.Set("SignatureNonce", fmt.Sprintf("%d", rand.Uint64()))
	params.Set("Timestamp", time.Now().UTC().Format("2006-01-02T15:04:05Z"))
	params.Set("Action", action)
	params.Set("Signature", a.aliyunSign(params))

	reqURL := "https://alidns.aliyuncs.com/?" + params.Encode()
	resp, err := a.client.Get(reqURL)
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

	var decoded map[string]interface{}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil, err
	}
	if code, ok := decoded["Code"].(string); ok && code != "" {
		var msg interface{}
		if m, ok := decoded["Message"]; ok {
			msg = m
		}
		return nil, fmt.Errorf("%w: %s (%s)", ErrAPIRequest, msg, code)
	}
	return decoded, nil
}

// stringSlice pulls a "[]string" out of an Aliyun API response map, where the
// key holds a []interface{} of string values.
func aliyunStringSlice(m map[string]interface{}, key string) []string {
	raw, ok := m[key].([]interface{})
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, v := range raw {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func (a *Aliyun) ListDomains() ([]string, error) {
	resp, err := a.call("DescribeDomains", url.Values{"PageSize": {"100"}})
	if err != nil {
		return nil, err
	}
	domainsObj, _ := resp["Domains"].(map[string]interface{})
	if domainsObj == nil {
		return nil, nil
	}
	domains, _ := domainsObj["Domain"].([]interface{})
	names := make([]string, 0, len(domains))
	for _, d := range domains {
		if dm, ok := d.(map[string]interface{}); ok {
			if name, ok := dm["DomainName"].(string); ok && name != "" {
				names = append(names, name)
			}
		}
	}
	return names, nil
}

func (a *Aliyun) ListRecords(domain string) ([]Record, error) {
	resp, err := a.call("DescribeDomainRecords", url.Values{
		"DomainName": {domain},
		"PageSize":   {"500"},
	})
	if err != nil {
		return nil, err
	}
	recordsObj, _ := resp["DomainRecords"].(map[string]interface{})
	if recordsObj == nil {
		return nil, nil
	}
	items, _ := recordsObj["Record"].([]interface{})
	records := make([]Record, 0, len(items))
	for _, it := range items {
		r, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		records = append(records, Record{
			ID:    stringValue(r["RecordId"]),
			Name:  stringValue(r["RR"]),
			Type:  stringValue(r["Type"]),
			Value: stringValue(r["Value"]),
			TTL:   intValue(r["TTL"]),
		})
	}
	return records, nil
}

func (a *Aliyun) CreateRecord(domain string, rec Record) (string, error) {
	resp, err := a.call("AddDomainRecord", url.Values{
		"DomainName": {domain},
		"RR":         {rec.Name},
		"Type":       {rec.Type},
		"Value":      {rec.Value},
		"TTL":        {fmt.Sprintf("%d", rec.TTL)},
	})
	if err != nil {
		return "", err
	}
	return stringValue(resp["RecordId"]), nil
}

func (a *Aliyun) UpdateRecord(domain string, recordID string, rec Record) error {
	_, err := a.call("UpdateDomainRecord", url.Values{
		"RecordId": {recordID},
		"RR":       {rec.Name},
		"Type":     {rec.Type},
		"Value":    {rec.Value},
		"TTL":      {fmt.Sprintf("%d", rec.TTL)},
	})
	return err
}

func (a *Aliyun) DeleteRecord(domain string, recordID string) error {
	_, err := a.call("DeleteDomainRecord", url.Values{
		"RecordId": {recordID},
	})
	return err
}

func stringValue(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func intValue(v interface{}) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	default:
		return 0
	}
}
