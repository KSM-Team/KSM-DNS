package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ksm-dns/models"
)

type SettingsHandler struct {
	DB *gorm.DB
}

// allowedSettingKeys is the whitelist of setting keys that can be modified via
// the generic UpdateSetting endpoint. Internal keys (VAPID, ACME, etc.) must be
// managed through dedicated endpoints.
var allowedSettingKeys = map[string]bool{
	"site_name": true,
	"logo_url":  true,
}

func (h *SettingsHandler) UpdateSetting(c *gin.Context) {
	var req struct {
		Key   string `json:"key" binding:"required"`
		Value string `json:"value"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	if !allowedSettingKeys[req.Key] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不允许修改此设置项"})
		return
	}

	h.DB.Where("key = ?", req.Key).Assign(models.Setting{Value: req.Value}).FirstOrCreate(&models.Setting{Key: req.Key})
	c.JSON(http.StatusOK, gin.H{"message": "设置已保存"})
}

// sensitiveKeys are settings that must never be returned via the API. They are
// used internally (e.g. VAPID private keys, ACME account keys) and exposing them
// would allow token forgery or certificate abuse.
var sensitiveKeys = map[string]bool{
	"vapid_private_key":    true,
	"acme_account_key":     true,
	"acme_eab_hmac_key":    true,
}

func (h *SettingsHandler) GetSettings(c *gin.Context) {
	var settings []models.Setting
	h.DB.Find(&settings)

	result := make(map[string]string)
	for _, s := range settings {
		if sensitiveKeys[s.Key] {
			continue
		}
		// Also skip any key that looks like a private key or secret.
		if strings.HasSuffix(s.Key, "_private_key") || strings.HasSuffix(s.Key, "_secret") {
			continue
		}
		result[s.Key] = s.Value
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// GetPublicSettings returns only the settings safe to expose to unauthenticated
// clients (the login page). It must never leak secrets such as vapid_private_key.
func (h *SettingsHandler) GetPublicSettings(c *gin.Context) {
	result := make(map[string]string)
	for _, key := range []string{"site_name", "logo_url"} {
		var s models.Setting
		if err := h.DB.Where("key = ?", key).First(&s).Error; err == nil {
			result[s.Key] = s.Value
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (h *SettingsHandler) UploadLogo(c *gin.Context) {
	file, err := c.FormFile("logo")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择文件"})
		return
	}

	ext := filepath.Ext(file.Filename)
	allowed := map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".svg": true, ".ico": true}
	if !allowed[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的文件格式"})
		return
	}

	uploadDir := "../data/uploads"
	os.MkdirAll(uploadDir, 0755)

	filename := fmt.Sprintf("logo_%d%s", time.Now().Unix(), ext)
	dst := filepath.Join(uploadDir, filename)

	if err := c.SaveUploadedFile(file, dst); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件保存失败"})
		return
	}

	logoURL := "/uploads/" + filename
	h.DB.Where("key = ?", "logo_url").Assign(models.Setting{Value: logoURL}).FirstOrCreate(&models.Setting{Key: "logo_url"})

	c.JSON(http.StatusOK, gin.H{
		"message": "Logo上传成功",
		"url":     logoURL,
	})
}

// GenerateVAPIDKeys creates a fresh VAPID key pair, stores it in settings, and
// returns the public key. These keys authenticate Web Push requests to the
// browser's push service (a requirement for Apple Web Push on iOS/iPadOS).
func (h *SettingsHandler) GenerateVAPIDKeys(c *gin.Context) {
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 VAPID 密钥失败"})
		return
	}

	h.DB.Where("key = ?", "vapid_public_key").Assign(models.Setting{Value: publicKey}).FirstOrCreate(&models.Setting{Key: "vapid_public_key"})
	h.DB.Where("key = ?", "vapid_private_key").Assign(models.Setting{Value: privateKey}).FirstOrCreate(&models.Setting{Key: "vapid_private_key"})

	c.JSON(http.StatusOK, gin.H{
		"message":    "VAPID 密钥已生成",
		"public_key": publicKey,
	})
}
