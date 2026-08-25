package notify

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/SherClockHolmes/webpush-go"
	"gorm.io/gorm"

	"ksm-dns/models"
)

// PushPayload is the JSON body delivered to the browser's push event. It is
// parsed by the service worker to show a system notification.
type PushPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url,omitempty"`
}

// SendWebPush delivers a single push notification to the given subscription
// using the configured VAPID keys. It returns an error on failure.
func SendWebPush(sub *models.PushSubscription, title, content, vapidPublicKey, vapidPrivateKey string) error {
	if sub == nil || sub.Endpoint == "" || sub.P256dh == "" || sub.Auth == "" {
		return fmt.Errorf("推送订阅信息不完整")
	}
	if vapidPublicKey == "" || vapidPrivateKey == "" {
		return fmt.Errorf("VAPID 密钥未配置，请在系统设置中配置或生成")
	}

	payload, err := json.Marshal(PushPayload{Title: title, Body: content})
	if err != nil {
		return err
	}

	s := &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256dh,
			Auth:   sub.Auth,
		},
	}

	resp, err := webpush.SendNotification(payload, s, &webpush.Options{
		VAPIDPublicKey:  vapidPublicKey,
		VAPIDPrivateKey: vapidPrivateKey,
		Subscriber:      "mailto:admin@ksm-dns.local",
		TTL:             30,
		Urgency:         webpush.UrgencyNormal,
		VapidExpiration: time.Now().Add(24 * time.Hour),
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("推送服务返回 HTTP %d", resp.StatusCode)
	}
	return nil
}

// SendToSubscriptions pushes a notification to every stored subscription for
// the given user using the supplied VAPID keys. Expired subscriptions (HTTP
// 404/410) are removed automatically. It returns the number of successful
// deliveries.
func SendToSubscriptions(db *gorm.DB, userID uint, title, content, vapidPublicKey, vapidPrivateKey string) int {
	var subs []models.PushSubscription
	db.Where("user_id = ?", userID).Find(&subs)
	sent := 0
	for _, sub := range subs {
		if err := SendWebPush(&sub, title, content, vapidPublicKey, vapidPrivateKey); err != nil {
			continue
		}
		sent++
	}
	return sent
}

// SendWebPushToAll broadcasts a notification to every stored push subscription.
// VAPID keys are read from the settings store. It returns the number of
// successful deliveries, or an error when no keys are configured or no
// subscription could be reached.
func SendWebPushToAll(db *gorm.DB, title, content string) (int, error) {
	var pub, priv models.Setting
	if err := db.Where("key = ?", "vapid_public_key").First(&pub).Error; err != nil || pub.Value == "" {
		return 0, fmt.Errorf("VAPID 公钥未配置")
	}
	if err := db.Where("key = ?", "vapid_private_key").First(&priv).Error; err != nil || priv.Value == "" {
		return 0, fmt.Errorf("VAPID 私钥未配置")
	}

	var subs []models.PushSubscription
	db.Find(&subs)
	if len(subs) == 0 {
		return 0, fmt.Errorf("没有可用的推送订阅")
	}

	sent := 0
	for _, sub := range subs {
		if err := SendWebPush(&sub, title, content, pub.Value, priv.Value); err != nil {
			continue
		}
		sent++
	}
	if sent == 0 {
		return 0, fmt.Errorf("所有推送订阅发送失败")
	}
	return sent, nil
}
