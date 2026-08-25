package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ksm-dns/models"
	"ksm-dns/services/notify"
)

type PushHandler struct {
	DB *gorm.DB
}

// getVAPIDKey reads a setting by key, returning an empty string when unset.
func getVAPIDKey(db *gorm.DB, key string) string {
	var s models.Setting
	if err := db.Where("key = ?", key).First(&s).Error; err != nil {
		return ""
	}
	return s.Value
}

// PublicKey exposes the VAPID public key so the browser can subscribe with
// pushManager. It is intentionally public: the public key alone cannot be used
// to send notifications.
func (h *PushHandler) PublicKey(c *gin.Context) {
	pub := getVAPIDKey(h.DB, "vapid_public_key")
	c.JSON(http.StatusOK, gin.H{"public_key": pub})
}

// Subscribe stores a Web Push subscription for the current user. The browser
// only ever calls this from a direct user gesture (satisfying Apple's
// requirement that permission be requested in response to user interaction).
func (h *PushHandler) Subscribe(c *gin.Context) {
	var req struct {
		Endpoint string `json:"endpoint" binding:"required"`
		Keys     struct {
			P256dh string `json:"p256dh" binding:"required"`
			Auth   string `json:"auth" binding:"required"`
		} `json:"keys" binding:"required"`
		UserAgent string `json:"user_agent"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "订阅参数错误"})
		return
	}

	userID := c.GetUint("user_id")
	sub := models.PushSubscription{
		UserID:    userID,
		Endpoint:  req.Endpoint,
		P256dh:    req.Keys.P256dh,
		Auth:      req.Keys.Auth,
		UserAgent: req.UserAgent,
	}
	// Upsert by unique endpoint so re-subscribing updates the keys in place.
	if err := h.DB.Where("endpoint = ?", req.Endpoint).Assign(sub).FirstOrCreate(&sub).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存订阅失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "订阅成功", "data": sub})
}

// Unsubscribe removes a stored subscription by endpoint.
func (h *PushHandler) Unsubscribe(c *gin.Context) {
	var req struct {
		Endpoint string `json:"endpoint" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	h.DB.Where("endpoint = ? AND user_id = ?", req.Endpoint, c.GetUint("user_id")).Delete(&models.PushSubscription{})
	c.JSON(http.StatusOK, gin.H{"message": "已取消订阅"})
}

// ListSubscriptions returns the current user's push subscriptions.
func (h *PushHandler) ListSubscriptions(c *gin.Context) {
	var subs []models.PushSubscription
	h.DB.Where("user_id = ?", c.GetUint("user_id")).Order("id desc").Find(&subs)
	c.JSON(http.StatusOK, gin.H{"data": subs})
}

// SendTest pushes a test notification to every subscription of the current user.
func (h *PushHandler) SendTest(c *gin.Context) {
	pub := getVAPIDKey(h.DB, "vapid_public_key")
	priv := getVAPIDKey(h.DB, "vapid_private_key")
	sent := notify.SendToSubscriptions(h.DB, c.GetUint("user_id"), "KSM-DNS 测试通知", "这是一条 Web Push 测试通知。", pub, priv)
	if sent == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "发送失败：没有可用的推送订阅或 VAPID 密钥未配置"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "测试通知已发送", "count": sent})
}
