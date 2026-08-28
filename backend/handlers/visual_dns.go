package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ksm-dns/models"
)

type VisualDNSHandler struct {
	DB *gorm.DB
}

// ipAPIResponse mirrors the ip-api.com JSON response.
type ipAPIResponse struct {
	Status      string  `json:"status"`
	Message     string  `json:"message"`
	Country     string  `json:"country"`
	RegionName  string  `json:"regionName"`
	City        string  `json:"city"`
	ISP         string  `json:"isp"`
	Org         string  `json:"org"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
}

// fetchIPGeo calls ip-api.com and returns the parsed geo data.
// Note: the free tier is limited to 45 req/min from a single IP.
func fetchIPGeo(ip string) (*ipAPIResponse, error) {
	resp, err := http.Get(fmt.Sprintf("http://ip-api.com/json/%s", ip))
	if err != nil {
		return nil, fmt.Errorf("查询 IP 地理信息失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("IP 查询服务返回状态码 %d", resp.StatusCode)
	}

	var geo ipAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&geo); err != nil {
		return nil, fmt.Errorf("解析 IP 地理信息失败: %w", err)
	}
	if geo.Status != "success" {
		return nil, fmt.Errorf("IP 查询失败: %s", geo.Message)
	}
	return &geo, nil
}

// --- IP CRUD ---

func (h *VisualDNSHandler) ListIPs(c *gin.Context) {
	var ips []models.IPAddress
	h.DB.Order("id desc").Find(&ips)
	c.JSON(http.StatusOK, gin.H{"data": ips})
}

func (h *VisualDNSHandler) CreateIP(c *gin.Context) {
	var req struct {
		IP string `json:"ip" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	req.IP = strings.TrimSpace(req.IP)
	if req.IP == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "IP 地址不能为空"})
		return
	}

	// Fetch geo data from ip-api.com
	geo, err := fetchIPGeo(req.IP)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	record := models.IPAddress{
		IP:        req.IP,
		Country:   geo.Country,
		City:      geo.City,
		Region:    geo.RegionName,
		ISP:       geo.ISP,
		Org:       geo.Org,
		Latitude:  geo.Lat,
		Longitude: geo.Lon,
	}

	if err := h.DB.Create(&record).Error; err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			c.JSON(http.StatusConflict, gin.H{"error": "该 IP 地址已存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存 IP 地址失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": record})
}

func (h *VisualDNSHandler) DeleteIP(c *gin.Context) {
	id, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	h.DB.Delete(&models.IPAddress{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

func (h *VisualDNSHandler) RefreshIPGeo(c *gin.Context) {
	id, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var record models.IPAddress
	if err := h.DB.First(&record, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "IP 地址不存在"})
		return
	}

	geo, err := fetchIPGeo(record.IP)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	record.Country = geo.Country
	record.City = geo.City
	record.Region = geo.RegionName
	record.ISP = geo.ISP
	record.Org = geo.Org
	record.Latitude = geo.Lat
	record.Longitude = geo.Lon

	h.DB.Save(&record)
	c.JSON(http.StatusOK, gin.H{"data": record})
}

// LookupIPGeo proxies ip-api.com without persisting anything.
func (h *VisualDNSHandler) LookupIPGeo(c *gin.Context) {
	ip := c.Param("ip")
	if ip == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "IP 地址不能为空"})
		return
	}

	geo, err := fetchIPGeo(ip)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": geo})
}

// --- Auto-generate records ---

// collectUniqueIPs extracts unique IP values from A/AAAA DNS records.
func collectUniqueIPs(db *gorm.DB) []string {
	var records []models.DNSRecord
	db.Where("type IN ?", []string{"A", "AAAA"}).Find(&records)
	seen := make(map[string]bool)
	var ips []string
	for _, r := range records {
		v := strings.TrimSpace(r.Value)
		if v != "" && !seen[v] {
			seen[v] = true
			ips = append(ips, v)
		}
	}
	return ips
}

// AutoGenerateRecords returns all DNS records as a node-edge graph and
// automatically saves any IPs found in A/AAAA records to the IPAddress table
// (with geo lookup) so they appear in the IP sidebar.
func (h *VisualDNSHandler) AutoGenerateRecords(c *gin.Context) {
	type node struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Label    string `json:"label"`
		Platform string `json:"platform,omitempty"`
		Country  string `json:"country,omitempty"`
		City     string `json:"city,omitempty"`
		ISP      string `json:"isp,omitempty"`
	}

	type edge struct {
		ID     string `json:"id"`
		Source string `json:"source"`
		Target string `json:"target"`
		Type   string `json:"type"`
		Name   string `json:"name"`
		TTL    int    `json:"ttl"`
	}

	// Auto-save unique IPs from A/AAAA records to IPAddress table
	for _, ip := range collectUniqueIPs(h.DB) {
		var existing models.IPAddress
		if h.DB.Where("ip = ?", ip).First(&existing).Error == nil {
			continue // already saved
		}
		geo, err := fetchIPGeo(ip)
		if err != nil {
			// Silently skip — ip-api may be rate-limited or unreachable
			continue
		}
		h.DB.Create(&models.IPAddress{
			IP:        ip,
			Country:   geo.Country,
			City:      geo.City,
			Region:    geo.RegionName,
			ISP:       geo.ISP,
			Org:       geo.Org,
			Latitude:  geo.Lat,
			Longitude: geo.Lon,
		})
	}

	// Build node-edge graph from all DNS records
	var records []models.DNSRecord
	h.DB.Preload("Domain.Platform").Find(&records)

	nodeMap := make(map[string]bool)
	nodes := make([]node, 0)
	edges := make([]edge, 0)

	for _, r := range records {
		if r.Domain.ID == 0 {
			continue
		}
		domainID := fmt.Sprintf("domain-%d", r.DomainID)
		domainLabel := r.Domain.Domain
		platformType := ""
		if r.Domain.Platform.ID != 0 {
			platformType = r.Domain.Platform.Type
		}

		if !nodeMap[domainID] {
			nodeMap[domainID] = true
			nodes = append(nodes, node{
				ID:       domainID,
				Type:     "domain",
				Label:    domainLabel,
				Platform: platformType,
			})
		}

		ipVal := r.Value
		if r.Type != "A" && r.Type != "AAAA" {
			targetID := fmt.Sprintf("target-%d", r.ID)
			nodes = append(nodes, node{
				ID:    targetID,
				Type:  "target",
				Label: fmt.Sprintf("%s → %s", r.Type, truncateValue(r.Value, 40)),
			})
			edges = append(edges, edge{
				ID:     fmt.Sprintf("record-%d", r.ID),
				Source: domainID,
				Target: targetID,
				Type:   r.Type,
				Name:   r.Name,
				TTL:    r.TTL,
			})
			continue
		}

		ipID := fmt.Sprintf("ip-%s", ipVal)
		if !nodeMap[ipID] {
			nodeMap[ipID] = true
			var savedIP models.IPAddress
			ipNode := node{
				ID:    ipID,
				Type:  "ip",
				Label: ipVal,
			}
			if h.DB.Where("ip = ?", ipVal).First(&savedIP).Error == nil {
				ipNode.Country = savedIP.Country
				ipNode.City = savedIP.City
				ipNode.ISP = savedIP.ISP
			}
			nodes = append(nodes, ipNode)
		}

		edges = append(edges, edge{
			ID:     fmt.Sprintf("record-%d", r.ID),
			Source: domainID,
			Target: ipID,
			Type:   r.Type,
			Name:   r.Name,
			TTL:    r.TTL,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"nodes": nodes,
			"edges": edges,
		},
	})
}

func truncateValue(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}