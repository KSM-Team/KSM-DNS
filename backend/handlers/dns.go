package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ksm-dns/models"
	"ksm-dns/services/dns"
)

type DNSHandler struct {
	DB *gorm.DB
}

func (h *DNSHandler) getProvider(platform models.DNSPlatform) (dns.Provider, error) {
	return dns.ProviderFor(platform)
}

// --- Dashboard ---

func (h *DNSHandler) GetDashboardStats(c *gin.Context) {
	domainIDs, isAdmin := allowedDomainIDs(h.DB, c)

	var domains, failoverRules, schedulerTasks, sslCerts int64
	domainQuery := h.DB.Model(&models.Domain{})
	failoverQuery := h.DB.Model(&models.FailoverRule{})
	schedulerQuery := h.DB.Model(&models.SchedulerTask{})
	sslQuery := h.DB.Model(&models.SSLCertificate{})
	if !isAdmin {
		domainQuery = domainQuery.Where("id IN ?", domainIDs)
		failoverQuery = failoverQuery.Where("domain_id IN ?", domainIDs)
		schedulerQuery = schedulerQuery.Where("domain_id IN ?", domainIDs)
		sslQuery = sslQuery.Where("domain_id IN ?", domainIDs)
	}
	domainQuery.Count(&domains)
	failoverQuery.Count(&failoverRules)
	schedulerQuery.Count(&schedulerTasks)
	sslQuery.Count(&sslCerts)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"domains":          domains,
		"failover_rules":   failoverRules,
		"scheduler_tasks":  schedulerTasks,
		"ssl_certificates": sslCerts,
	}})
}

// --- Platform CRUD ---

func (h *DNSHandler) ListPlatforms(c *gin.Context) {
	domainIDs, isAdmin := allowedDomainIDs(h.DB, c)

	// For a sub-user, only show platforms that host at least one of their domains.
	query := h.DB.Model(&models.DNSPlatform{})
	if !isAdmin {
		query = query.Where("id IN (SELECT platform_id FROM domains WHERE id IN ?)", domainIDs)
	}
	if kw := c.Query("keyword"); kw != "" {
		like := "%" + kw + "%"
		query = query.Where("name LIKE ? OR type LIKE ?", like, like)
	}

	p := parsePagination(c, 20)
	var total int64
	query.Count(&total)

	var platforms []models.DNSPlatform
	query.Order("id desc").Limit(p.PageSize).Offset(p.Offset).Find(&platforms)

	// Count domains per platform so the frontend can show e.g. "3 个域名".
	type platformWithCount struct {
		models.DNSPlatform
		DomainCount int64 `json:"domain_count"`
	}
	result := make([]platformWithCount, 0, len(platforms))
	for _, pl := range platforms {
		var count int64
		countQuery := h.DB.Model(&models.Domain{}).Where("platform_id = ?", pl.ID)
		if !isAdmin {
			countQuery = countQuery.Where("id IN ?", domainIDs)
		}
		countQuery.Count(&count)
		result = append(result, platformWithCount{DNSPlatform: pl, DomainCount: count})
	}
	c.JSON(http.StatusOK, paginatedResult(result, total, p))
}

func (h *DNSHandler) CreatePlatform(c *gin.Context) {
	var req struct {
		Name        string            `json:"name" binding:"required"`
		Type        string            `json:"type" binding:"required"`
		Credentials map[string]string `json:"credentials" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	switch req.Type {
	case "cloudflare", "spaceship", "namesilo", "aliyun", "tencent", "porkbun":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的平台类型，仅支持 cloudflare、spaceship、namesilo、aliyun、tencent 和 porkbun"})
		return
	}

	credsJSON, _ := json.Marshal(req.Credentials)

	platform := models.DNSPlatform{
		Name:        req.Name,
		Type:        req.Type,
		Credentials: string(credsJSON),
	}

	// Verify credentials by trying to list domains
	provider, err := dns.NewProvider(platform, req.Credentials)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "凭证无效: " + err.Error()})
		return
	}
	_, err = provider.ListDomains()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "凭证验证失败: " + err.Error()})
		return
	}

	if err := h.DB.Create(&platform).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": platform})
}

func (h *DNSHandler) UpdatePlatform(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var platform models.DNSPlatform
	if err := h.DB.First(&platform, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "平台不存在"})
		return
	}

	var req struct {
		Name        string            `json:"name"`
		Credentials map[string]string `json:"credentials"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	if req.Name != "" {
		platform.Name = req.Name
	}
	if req.Credentials != nil {
		credsJSON, _ := json.Marshal(req.Credentials)
		platform.Credentials = string(credsJSON)
	}

	h.DB.Save(&platform)
	c.JSON(http.StatusOK, gin.H{"data": platform})
}

func (h *DNSHandler) DeletePlatform(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var platform models.DNSPlatform
	if err := h.DB.First(&platform, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "平台不存在"})
		return
	}

	h.DB.Delete(&platform)
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// --- Domain Sync & Management ---

func (h *DNSHandler) SyncDomains(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var platform models.DNSPlatform
	if err := h.DB.First(&platform, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "平台不存在"})
		return
	}

	provider, err := h.getProvider(platform)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "初始化提供商失败: " + err.Error()})
		return
	}

	domains, err := provider.ListDomains()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "同步域名失败: " + err.Error()})
		return
	}

	var added int
	for _, d := range domains {
		var existing models.Domain
		result := h.DB.Where("platform_id = ? AND domain = ?", platform.ID, d).First(&existing)
		if result.Error != nil {
			h.DB.Create(&models.Domain{
				PlatformID: platform.ID,
				Domain:     d,
				Status:     "active",
			})
			added++
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "同步完成", "added": added, "total": len(domains)})
}

// SyncAllDomains syncs domains from all platforms at once.
func (h *DNSHandler) SyncAllDomains(c *gin.Context) {
	var platforms []models.DNSPlatform
	h.DB.Find(&platforms)

	var totalAdded int
	var totalDomains int
	var errors []string

	for _, platform := range platforms {
		provider, err := h.getProvider(platform)
		if err != nil {
			errors = append(errors, platform.Name+": 初始化失败")
			continue
		}
		domains, err := provider.ListDomains()
		if err != nil {
			errors = append(errors, platform.Name+": "+err.Error())
			continue
		}
		totalDomains += len(domains)
		for _, d := range domains {
			var existing models.Domain
			result := h.DB.Where("platform_id = ? AND domain = ?", platform.ID, d).First(&existing)
			if result.Error != nil {
				h.DB.Create(&models.Domain{
					PlatformID: platform.ID,
					Domain:     d,
					Status:     "active",
				})
				totalAdded++
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "批量同步完成",
		"added":         totalAdded,
		"total":         totalDomains,
		"platforms":     len(platforms),
		"errors":        errors,
	})
}

func (h *DNSHandler) ListDomains(c *gin.Context) {
	var domains []models.Domain
	query := h.DB.Preload("Platform")

	domainIDs, isAdmin := allowedDomainIDs(h.DB, c)
	if !isAdmin {
		query = query.Where("id IN ?", domainIDs)
	}
	if pid := c.Query("platform_id"); pid != "" {
		query = query.Where("platform_id = ?", pid)
	}
	if kw := c.Query("keyword"); kw != "" {
		like := "%" + kw + "%"
		query = query.Where("domain LIKE ?", like)
	}

	p := parsePagination(c, 20)
	var total int64
	query.Model(&models.Domain{}).Count(&total)
	query.Order("id desc").Limit(p.PageSize).Offset(p.Offset).Find(&domains)
	c.JSON(http.StatusOK, paginatedResult(domains, total, p))
}

func (h *DNSHandler) DeleteDomain(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	// Cascade-delete all related records to avoid orphaned data.
	// Delete failover logs belonging to this domain's rules.
	h.DB.Exec("DELETE FROM failover_logs WHERE rule_id IN (SELECT id FROM failover_rules WHERE domain_id = ?)", id)
	h.DB.Where("domain_id = ?", id).Delete(&models.FailoverRule{})
	// Delete scheduler logs belonging to this domain's tasks.
	h.DB.Exec("DELETE FROM scheduler_logs WHERE task_id IN (SELECT id FROM scheduler_tasks WHERE domain_id = ?)", id)
	h.DB.Where("domain_id = ?", id).Delete(&models.SchedulerTask{})
	// Delete SSL deploy targets belonging to this domain's certificates.
	h.DB.Exec("DELETE FROM ssl_deploy_targets WHERE certificate_id IN (SELECT id FROM ssl_certificates WHERE domain_id = ?)", id)
	h.DB.Where("domain_id = ?", id).Delete(&models.SSLCertificate{})
	h.DB.Where("domain_id = ?", id).Delete(&models.DNSRecord{})
	h.DB.Delete(&models.Domain{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// --- DNS Records ---

func (h *DNSHandler) SyncRecords(c *gin.Context) {
	domainID, ok := parseUintParam(c, "id"); if !ok { return }
	var domain models.Domain
	if err := h.DB.Preload("Platform").First(&domain, domainID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "域名不存在"})
		return
	}

	provider, err := h.getProvider(domain.Platform)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "初始化提供商失败"})
		return
	}

	records, err := provider.ListRecords(domain.Domain)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "同步记录失败: " + err.Error()})
		return
	}

	// Remove old records and insert fresh
	h.DB.Where("domain_id = ?", domain.ID).Delete(&models.DNSRecord{})

	for _, r := range records {
		h.DB.Create(&models.DNSRecord{
			DomainID:         domain.ID,
			Name:             r.Name,
			Type:             r.Type,
			Value:            r.Value,
			TTL:              r.TTL,
			Proxied:          r.Proxied,
			PlatformRecordID: r.ID,
			Status:           "active",
		})
	}

	c.JSON(http.StatusOK, gin.H{"message": "同步完成", "count": len(records)})
}

func (h *DNSHandler) ListRecords(c *gin.Context) {
	domainID, ok := parseUintParam(c, "id"); if !ok { return }
	if !hasDomainPermission(h.DB, c, uint(domainID), "read") {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权限访问该域名"})
		return
	}

	base := h.DB.Model(&models.DNSRecord{}).Where("domain_id = ?", domainID)
	if kw := c.Query("keyword"); kw != "" {
		like := "%" + kw + "%"
		base = base.Where("name LIKE ? OR value LIKE ?", like, like)
	}
	if t := c.Query("type"); t != "" {
		base = base.Where("type = ?", t)
	}

	p := parsePagination(c, 50)
	var total int64
	base.Count(&total)

	var records []models.DNSRecord
	base.Order("id asc").Limit(p.PageSize).Offset(p.Offset).Find(&records)
	c.JSON(http.StatusOK, paginatedResult(records, total, p))
}

func (h *DNSHandler) CreateRecord(c *gin.Context) {
	domainID, ok := parseUintParam(c, "id"); if !ok { return }
	var domain models.Domain
	if err := h.DB.Preload("Platform").First(&domain, domainID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "域名不存在"})
		return
	}

	var req struct {
		Name    string `json:"name" binding:"required"`
		Type    string `json:"type" binding:"required"`
		Value   string `json:"value" binding:"required"`
		TTL     int    `json:"ttl"`
		Proxied bool   `json:"proxied"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	if !isValidRecordType(req.Type) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的记录类型，仅支持 A, AAAA, CNAME, MX, TXT, NS, SRV, CAA"})
		return
	}

	if req.TTL == 0 {
		req.TTL = 300
	}

	provider, err := h.getProvider(domain.Platform)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "初始化提供商失败"})
		return
	}

	recordID, err := provider.CreateRecord(domain.Domain, dns.Record{
		Name:    req.Name,
		Type:    req.Type,
		Value:   req.Value,
		TTL:     req.TTL,
		Proxied: req.Proxied,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建记录失败: " + err.Error()})
		return
	}

	record := models.DNSRecord{
		DomainID:         domain.ID,
		Name:             req.Name,
		Type:             req.Type,
		Value:            req.Value,
		TTL:              req.TTL,
		Proxied:          req.Proxied,
		PlatformRecordID: recordID,
		Status:           "active",
	}
	h.DB.Create(&record)

	c.JSON(http.StatusOK, gin.H{"data": record})
}

func (h *DNSHandler) UpdateRecord(c *gin.Context) {
	recordID, ok := parseUintParam(c, "recordId"); if !ok { return }
	var record models.DNSRecord
	if err := h.DB.First(&record, recordID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
		return
	}

	var domain models.Domain
	if err := h.DB.Preload("Platform").First(&domain, record.DomainID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "域名不存在"})
		return
	}

	var req struct {
		Name    string `json:"name"`
		Type    string `json:"type"`
		Value   string `json:"value"`
		TTL     int    `json:"ttl"`
		Proxied *bool  `json:"proxied"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	if req.Type != "" && !isValidRecordType(req.Type) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的记录类型，仅支持 A, AAAA, CNAME, MX, TXT, NS, SRV, CAA"})
		return
	}

	if req.Name != "" {
		record.Name = req.Name
	}
	if req.Type != "" {
		record.Type = req.Type
	}
	if req.Value != "" {
		record.Value = req.Value
	}
	if req.TTL > 0 {
		record.TTL = req.TTL
	}
	if req.Proxied != nil {
		record.Proxied = *req.Proxied
	}

	provider, err := h.getProvider(domain.Platform)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "初始化提供商失败"})
		return
	}

	err = provider.UpdateRecord(domain.Domain, record.PlatformRecordID, dns.Record{
		Name:    record.Name,
		Type:    record.Type,
		Value:   record.Value,
		TTL:     record.TTL,
		Proxied: record.Proxied,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新记录失败: " + err.Error()})
		return
	}

	h.DB.Save(&record)
	c.JSON(http.StatusOK, gin.H{"data": record})
}

func (h *DNSHandler) DeleteRecord(c *gin.Context) {
	recordID, ok := parseUintParam(c, "recordId"); if !ok { return }
	var record models.DNSRecord
	if err := h.DB.First(&record, recordID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
		return
	}

	var domain models.Domain
	if err := h.DB.Preload("Platform").First(&domain, record.DomainID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "域名不存在"})
		return
	}

	provider, err := h.getProvider(domain.Platform)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "初始化提供商失败"})
		return
	}

	if err := provider.DeleteRecord(domain.Domain, record.PlatformRecordID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除记录失败: " + err.Error()})
		return
	}

	h.DB.Delete(&record)
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// isValidRecordType returns true if t is one of the allowed DNS record types.
func isValidRecordType(t string) bool {
	switch t {
	case "A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA":
		return true
	}
	return false
}
