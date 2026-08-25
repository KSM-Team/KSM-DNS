package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ksm-dns/models"
	"ksm-dns/services/notify"
)

type NotifyHandler struct {
	DB *gorm.DB
}

func (h *NotifyHandler) ListChannels(c *gin.Context) {
	var channels []models.NotificationChannel
	p := parsePagination(c, 20)
	var total int64
	h.DB.Model(&models.NotificationChannel{}).Count(&total)
	h.DB.Order("id desc").Limit(p.PageSize).Offset(p.Offset).Find(&channels)
	// Redact sensitive fields before returning.
	for i := range channels {
		channels[i].Config = redactConfig(channels[i].Config)
	}
	c.JSON(http.StatusOK, paginatedResult(channels, total, p))
}

func (h *NotifyHandler) CreateChannel(c *gin.Context) {
	var req struct {
		Name    string          `json:"name" binding:"required"`
		Type    string          `json:"type" binding:"required"`
		Config  json.RawMessage `json:"config"`
		Enabled *bool           `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if req.Type != "email" && req.Type != "telegram" && req.Type != "webpush" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的通知渠道类型，仅支持 email、telegram 和 webpush"})
		return
	}

	configJSON := string(req.Config)
	if configJSON == "" || configJSON == "null" {
		configJSON = "{}"
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	channel := models.NotificationChannel{
		Name:    req.Name,
		Type:    req.Type,
		Config:  configJSON,
		Enabled: &enabled,
	}
	if h.DB.Create(&channel).Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	// Re-read so AfterFind decrypts the config before we redact it.
	h.DB.First(&channel, channel.ID)
	channel.Config = redactConfig(channel.Config)
	c.JSON(http.StatusOK, gin.H{"data": channel})
}

func (h *NotifyHandler) UpdateChannel(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var channel models.NotificationChannel
	if err := h.DB.First(&channel, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "通知渠道不存在"})
		return
	}

	var req struct {
		Name    string          `json:"name"`
		Config  json.RawMessage `json:"config"`
		Enabled *bool           `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	if req.Name != "" {
		channel.Name = req.Name
	}
	if req.Config != nil && string(req.Config) != "null" && string(req.Config) != "" {
		channel.Config = string(req.Config)
	}
	if req.Enabled != nil {
		channel.Enabled = req.Enabled
	}

	h.DB.Save(&channel)
	// Re-read so AfterFind decrypts the config before we redact it.
	h.DB.First(&channel, channel.ID)
	channel.Config = redactConfig(channel.Config)
	c.JSON(http.StatusOK, gin.H{"data": channel})
}

func (h *NotifyHandler) DeleteChannel(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	h.DB.Delete(&models.NotificationChannel{}, id)
	h.DB.Where("channel_id = ?", id).Delete(&models.NotificationLog{})
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

func (h *NotifyHandler) TestChannel(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var channel models.NotificationChannel
	if err := h.DB.First(&channel, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "通知渠道不存在"})
		return
	}

	if err := notify.Send(channel.Type, channel.Config, notify.Message{
		Title:   "KSM-DNS 测试通知",
		Content: "这是一条测试通知，用于验证通知渠道配置是否正确。",
	}); err != nil {
		h.DB.Create(&models.NotificationLog{
			ChannelID: channel.ID,
			Title:     "测试通知",
			Content:   "这是一条测试通知",
			Status:    "failed",
			Error:     err.Error(),
		})
		c.JSON(http.StatusBadRequest, gin.H{"error": "发送失败: " + err.Error()})
		return
	}

	h.DB.Create(&models.NotificationLog{
		ChannelID: channel.ID,
		Title:     "测试通知",
		Content:   "这是一条测试通知",
		Status:    "sent",
	})
	c.JSON(http.StatusOK, gin.H{"message": "测试通知发送成功"})
}

func (h *NotifyHandler) ListLogs(c *gin.Context) {
	var logs []models.NotificationLog
	query := h.DB.Order("id desc")
	if cid := c.Query("channel_id"); cid != "" {
		query = query.Where("channel_id = ?", cid)
	}
	p := parsePagination(c, 20)
	var total int64
	query.Model(&models.NotificationLog{}).Count(&total)
	query.Limit(p.PageSize).Offset(p.Offset).Find(&logs)
	c.JSON(http.StatusOK, paginatedResult(logs, total, p))
}

// redactConfig masks sensitive fields in notification channel config JSON so
// secrets (SMTP passwords, Telegram bot tokens) are never returned to the
// frontend. The original config is stored in the database and remains intact.
func redactConfig(configJSON string) string {
	var cfg map[string]interface{}
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return configJSON
	}
	changed := false
	for _, key := range []string{
		"smtp_password", "smtp_username", "bot_token", "api_key",
		"api_secret", "access_key", "secret_key", "token", "password",
	} {
		if _, ok := cfg[key]; ok {
			cfg[key] = "***"
			changed = true
		}
	}
	if !changed {
		return configJSON
	}
	out, err := json.Marshal(cfg)
	if err != nil {
		return configJSON
	}
	return string(out)
}
