package dns

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// Tencent implements the Provider interface against Tencent Cloud DNSPod
// (腾讯云 DNSPod), accessed via the Tencent Cloud API 3.0 protocol using
// TC3-HMAC-SHA256 request signing.
// Docs: https://cloud.tencent.com/document/product/1427
type Tencent struct {
	secretID  string
	secretKey string
	client    *http.Client
}

const (
	tencentEndpoint = "dnspod.tencentcloudapi.com"
	tencentService  = "dnspod"
	tencentVersion  = "2021-03-23"
)

func NewTencent(creds map[string]string) (*Tencent, error) {
	id := creds["secret_id"]
	key := creds["secret_key"]
	if id == "" || key == "" {
		return nil, ErrInvalidCredentials
	}
	return &Tencent{
		secretID:  id,
		secretKey: key,
		client:    &http.Client{},
	}, nil
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// call signs and sends a TC3 request to DNSPod and decodes the JSON body.
// The payload is a JSON object of action parameters.
func (t *Tencent) call(action string, payload map[string]interface{}) (map[string]interface{}, error) {
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	timestamp := now.Unix()
	date := now.Format("2006-01-02")

	// Step 1: canonical request.
	canonicalHeaders := "content-type:application/json; charset=utf-8\n" +
		"host:" + tencentEndpoint + "\n" +
		"x-tc-action:" + action + "\n"
	signedHeaders := "content-type;host;x-tc-action"
	hashedPayload := sha256Hex(bodyBytes)
	canonicalRequest := "POST\n/\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + hashedPayload

	// Step 2: string to sign.
	credentialScope := date + "/" + tencentService + "/tc3_request"
	stringToSign := "TC3-HMAC-SHA256\n" + strconv.FormatInt(timestamp, 10) + "\n" +
		credentialScope + "\n" + sha256Hex([]byte(canonicalRequest))

	// Step 3: signature.
	secretDate := hmacSHA256([]byte("TC3"+t.secretKey), []byte(date))
	secretService := hmacSHA256(secretDate, []byte(tencentService))
	secretSigning := hmacSHA256(secretService, []byte("tc3_request"))
	signature := hex.EncodeToString(hmacSHA256(secretSigning, []byte(stringToSign)))

	authorization := "TC3-HMAC-SHA256 Credential=" + t.secretID + "/" + credentialScope +
		", SignedHeaders=" + signedHeaders + ", Signature=" + signature

	req, err := http.NewRequest("POST", "https://"+tencentEndpoint+"/", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", authorization)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Host", tencentEndpoint)
	req.Header.Set("X-TC-Action", action)
	req.Header.Set("X-TC-Timestamp", strconv.FormatInt(timestamp, 10))
	req.Header.Set("X-TC-Version", tencentVersion)

	resp, err := t.client.Do(req)
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

	var decoded map[string]interface{}
	if err := json.Unmarshal(respBody, &decoded); err != nil {
		return nil, err
	}

	// Tencent wraps logical errors in a top-level "Response.Error" object.
	if respObj, ok := decoded["Response"].(map[string]interface{}); ok {
		if errObj, ok := respObj["Error"].(map[string]interface{}); ok {
			return nil, fmt.Errorf("%w: %v (%v)", ErrAPIRequest, errObj["Message"], errObj["Code"])
		}
	}
	return decoded, nil
}

func (t *Tencent) responseData(action string, payload map[string]interface{}) (map[string]interface{}, error) {
	decoded, err := t.call(action, payload)
	if err != nil {
		return nil, err
	}
	data, _ := decoded["Response"].(map[string]interface{})
	return data, nil
}

func tencentStringSlice(items []interface{}, key string) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		if m, ok := it.(map[string]interface{}); ok {
			if s, ok := m[key].(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

func (t *Tencent) ListDomains() ([]string, error) {
	var allNames []string
	offset := 0
	limit := 3000
	for {
		data, err := t.responseData("DescribeDomainList", map[string]interface{}{
			"Limit":  limit,
			"Offset": offset,
		})
		if err != nil {
			return nil, err
		}
		items, _ := data["DomainList"].([]interface{})
		allNames = append(allNames, tencentStringSlice(items, "Name")...)
		if len(items) < limit {
			break
		}
		offset += limit
	}
	return allNames, nil
}

func (t *Tencent) ListRecords(domain string) ([]Record, error) {
	data, err := t.responseData("DescribeRecordList", map[string]interface{}{
		"Domain": domain,
		"Limit":  3000,
	})
	if err != nil {
		return nil, err
	}
	items, _ := data["RecordList"].([]interface{})
	records := make([]Record, 0, len(items))
	for _, it := range items {
		r, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		records = append(records, Record{
			ID:    fmt.Sprintf("%v", r["RecordId"]),
			Name:  fmt.Sprintf("%v", r["Name"]),
			Type:  fmt.Sprintf("%v", r["Type"]),
			Value: fmt.Sprintf("%v", r["Value"]),
			TTL:   intValue(r["TTL"]),
		})
	}
	return records, nil
}

func (t *Tencent) CreateRecord(domain string, rec Record) (string, error) {
	data, err := t.responseData("CreateRecord", map[string]interface{}{
		"Domain":     domain,
		"RecordType": rec.Type,
		"RecordLine": "默认",
		"Value":      rec.Value,
		"SubDomain":  rec.Name,
		"TTL":        rec.TTL,
	})
	if err != nil {
		return "", err
	}
	if id, ok := data["RecordId"]; ok {
		return fmt.Sprintf("%v", id), nil
	}
	return "", nil
}

func (t *Tencent) UpdateRecord(domain string, recordID string, rec Record) error {
	_, err := t.responseData("ModifyRecord", map[string]interface{}{
		"Domain":     domain,
		"RecordId":   recordID,
		"RecordType": rec.Type,
		"RecordLine": "默认",
		"Value":      rec.Value,
		"SubDomain":  rec.Name,
		"TTL":        rec.TTL,
	})
	return err
}

func (t *Tencent) DeleteRecord(domain string, recordID string) error {
	_, err := t.responseData("DeleteRecord", map[string]interface{}{
		"Domain":   domain,
		"RecordId": recordID,
	})
	return err
}

func (t *Tencent) GetDomainInfo(domain string) (*DomainInfo, error) {
	data, err := t.responseData("DescribeDomain", map[string]interface{}{
		"Domain": domain,
	})
	if err != nil {
		return nil, err
	}
	info := &DomainInfo{
		DomainName:         domain,
		AutoRenewSupported: false, // Tencent DNSPod API doesn't expose auto-renew management
	}
	if domainInfo, ok := data["DomainInfo"].(map[string]interface{}); ok {
		if expireOn, ok := domainInfo["ExpireOn"].(string); ok && expireOn != "" {
			if t, err := parseDate(expireOn, "2006-01-02"); err == nil {
				info.ExpiryDate = &t
			}
		}
	}
	return info, nil
}
