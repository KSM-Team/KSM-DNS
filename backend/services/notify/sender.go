package notify

import (
	"gorm.io/gorm"

	"ksm-dns/models"
)

// SendToChannels delivers a notification to every enabled channel whose ID is
// present in notifyChannels (a JSON array of IDs). It records a
// NotificationLog entry per channel and returns the number of successful
// deliveries.
func SendToChannels(db *gorm.DB, notifyChannels, title, content string) int {
	ids := ChannelIDs(notifyChannels)
	sent := 0
	for _, id := range ids {
		var ch models.NotificationChannel
		if err := db.First(&ch, id).Error; err != nil {
			continue
		}
		if ch.Enabled == nil || !*ch.Enabled {
			continue
		}

		log := models.NotificationLog{
			ChannelID: ch.ID,
			Title:     title,
			Content:   content,
		}

		// A webpush channel fans out to every stored push subscription instead of
		// going through Send(), which has no per-browser destination. It records
		// one log entry per delivery attempt.
		if ch.Type == "webpush" {
			if _, err := SendWebPushToAll(db, title, content); err != nil {
				log.Status = "failed"
				log.Error = err.Error()
			} else {
				log.Status = "sent"
				sent++
			}
			db.Create(&log)
			continue
		}

		if err := Send(ch.Type, ch.Config, Message{Title: title, Content: content}); err != nil {
			log.Status = "failed"
			log.Error = err.Error()
		} else {
			log.Status = "sent"
			sent++
		}
		db.Create(&log)
	}
	return sent
}
