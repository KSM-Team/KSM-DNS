package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ksm-dns/models"
	"ksm-dns/services/monitor"
)

type FailoverHandler struct {
	DB      *gorm.DB
	Manager *monitor.Manager
}

func (h *FailoverHandler) List(c *gin.Context) {
	var rules []models.FailoverRule
	query := h.DB.Preload("Domain").Preload("Record").Order("id desc")
	if domainIDs, isAdmin := allowedDomainIDs(h.DB, c); !isAdmin {
		query = query.Where("domain_id IN ?", domainIDs)
	}
	p := parsePagination(c, 20)
	var total int64
	query.Model(&models.FailoverRule{}).Count(&total)
	query.Limit(p.PageSize).Offset(p.Offset).Find(&rules)
	c.JSON(http.StatusOK, paginatedResult(rules, total, p))
}

func (h *FailoverHandler) Get(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var rule models.FailoverRule
	if err := h.DB.Preload("Domain").Preload("Record").First(&rule, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "容灾规则不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rule})
}

func (h *FailoverHandler) Create(c *gin.Context) {
	var req struct {
		Name           string   `json:"name" binding:"required"`
		DomainID       uint     `json:"domain_id" binding:"required"`
		RecordID       uint     `json:"record_id" binding:"required"`
		CheckType      string   `json:"check_type" binding:"required"`
		CheckTarget    string   `json:"check_target" binding:"required"`
		CheckInterval  int      `json:"check_interval"`
		CheckTimeout   int      `json:"check_timeout"`
		RetryCount     int      `json:"retry_count"`
		ActionType     string   `json:"action_type"`
		BackupValue    string   `json:"backup_value"`
		NotifyChannels []uint   `json:"notify_channels"`
		Enabled        *bool    `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	// Validate the record belongs to the domain.
	var record models.DNSRecord
	if err := h.DB.First(&record, req.RecordID).Error; err != nil || record.DomainID != req.DomainID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "记录不存在或不属于该域名"})
		return
	}

	if req.CheckType != "ping" && req.CheckType != "tcp" && req.CheckType != "http" && req.CheckType != "https" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的检测类型"})
		return
	}
	if req.ActionType != "pause" && req.ActionType != "modify" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的切换操作"})
		return
	}
	if req.CheckInterval <= 0 {
		req.CheckInterval = 60
	}
	if req.CheckTimeout <= 0 {
		req.CheckTimeout = 5
	}
	if req.RetryCount < 0 {
		req.RetryCount = 0
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	rule := models.FailoverRule{
		Name:           req.Name,
		DomainID:       req.DomainID,
		RecordID:       req.RecordID,
		CheckType:      req.CheckType,
		CheckTarget:    req.CheckTarget,
		CheckInterval:  req.CheckInterval,
		CheckTimeout:   req.CheckTimeout,
		RetryCount:     req.RetryCount,
		ActionType:     req.ActionType,
		BackupValue:    req.BackupValue,
		NotifyChannels: encodeChannelIDs(req.NotifyChannels),
		Enabled:        enabled,
		Status:         "normal",
	}
	if err := h.DB.Create(&rule).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	h.Manager.Wake()
	c.JSON(http.StatusOK, gin.H{"data": rule})
}

func (h *FailoverHandler) Update(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var rule models.FailoverRule
	if err := h.DB.First(&rule, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "容灾规则不存在"})
		return
	}

	var req struct {
		Name           string `json:"name"`
		CheckType      string `json:"check_type"`
		CheckTarget    string `json:"check_target"`
		CheckInterval  *int   `json:"check_interval"`
		CheckTimeout   *int   `json:"check_timeout"`
		RetryCount     *int   `json:"retry_count"`
		ActionType     string `json:"action_type"`
		BackupValue    string `json:"backup_value"`
		NotifyChannels *[]uint `json:"notify_channels"`
		Enabled        *bool  `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	if req.Name != "" {
		rule.Name = req.Name
	}
	if req.CheckType != "" {
		if req.CheckType != "ping" && req.CheckType != "tcp" && req.CheckType != "http" && req.CheckType != "https" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的检测类型"})
			return
		}
		rule.CheckType = req.CheckType
	}
	if req.CheckTarget != "" {
		rule.CheckTarget = req.CheckTarget
	}
	if req.CheckInterval != nil {
		rule.CheckInterval = *req.CheckInterval
	}
	if req.CheckTimeout != nil {
		rule.CheckTimeout = *req.CheckTimeout
	}
	if req.RetryCount != nil {
		rule.RetryCount = *req.RetryCount
	}
	if req.ActionType != "" {
		if req.ActionType != "pause" && req.ActionType != "modify" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的切换操作"})
			return
		}
		rule.ActionType = req.ActionType
	}
	if req.BackupValue != "" {
		rule.BackupValue = req.BackupValue
	}
	if req.NotifyChannels != nil {
		rule.NotifyChannels = encodeChannelIDs(*req.NotifyChannels)
	}
	if req.Enabled != nil {
		rule.Enabled = *req.Enabled
	}

	if err := h.DB.Save(&rule).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}
	h.Manager.Wake()
	c.JSON(http.StatusOK, gin.H{"data": rule})
}

func (h *FailoverHandler) Delete(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	h.DB.Delete(&models.FailoverRule{}, id)
	h.DB.Where("rule_id = ?", id).Delete(&models.FailoverLog{})
	h.Manager.Wake()
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// Trigger forces a failover action immediately regardless of current status.
func (h *FailoverHandler) Trigger(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var rule models.FailoverRule
	if err := h.DB.First(&rule, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "容灾规则不存在"})
		return
	}
	if rule.Status == "triggered" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "规则已处于切换状态"})
		return
	}
	h.Manager.TriggerRule(&rule)
	c.JSON(http.StatusOK, gin.H{"message": "已触发切换"})
}

// Recover forces a recovery action immediately regardless of current status.
func (h *FailoverHandler) Recover(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var rule models.FailoverRule
	if err := h.DB.First(&rule, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "容灾规则不存在"})
		return
	}
	if rule.Status == "normal" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "规则已处于正常状态"})
		return
	}
	h.Manager.RecoverRule(&rule)
	c.JSON(http.StatusOK, gin.H{"message": "已执行恢复"})
}

func (h *FailoverHandler) ListLogs(c *gin.Context) {
	var logs []models.FailoverLog
	query := h.DB.Order("id desc")
	if domainIDs, isAdmin := allowedDomainIDs(h.DB, c); !isAdmin {
		query = query.Where("rule_id IN (SELECT id FROM failover_rules WHERE domain_id IN ?)", domainIDs)
	}
	if rid := c.Query("rule_id"); rid != "" {
		query = query.Where("rule_id = ?", rid)
	}
	p := parsePagination(c, 20)
	var total int64
	query.Model(&models.FailoverLog{}).Count(&total)
	query.Limit(p.PageSize).Offset(p.Offset).Find(&logs)
	c.JSON(http.StatusOK, paginatedResult(logs, total, p))
}

func encodeChannelIDs(ids []uint) string {
	if len(ids) == 0 {
		return "[]"
	}
	b, _ := json.Marshal(ids)
	return string(b)
}
