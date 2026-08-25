package monitor

import (
	"fmt"
	"sync"
	"time"

	"gorm.io/gorm"

	"ksm-dns/models"
	"ksm-dns/services/dns"
	"ksm-dns/services/notify"
)

// Manager runs the polling loop for all enabled failover rules. It is the
// single owner of the background goroutine that periodically checks each rule.
type Manager struct {
	DB       *gorm.DB
	mu       sync.Mutex
	stop     chan struct{}
	stopped  bool
	wake     chan struct{} // nudge to re-read rules immediately
	interval time.Duration
}

func NewManager(db *gorm.DB) *Manager {
	return &Manager{
		DB:       db,
		stop:     make(chan struct{}),
		wake:     make(chan struct{}, 1),
		interval: 5 * time.Second,
	}
}

func (m *Manager) Start() {
	go m.loop()
}

func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.stopped {
		m.stopped = true
		close(m.stop)
	}
}

// Wake requests an immediate re-read of rules (used after CRUD changes).
func (m *Manager) Wake() {
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

func (m *Manager) loop() {
	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-ticker.C:
			m.tick()
		case <-m.wake:
			m.tick()
		}
	}
}

func (m *Manager) tick() {
	var rules []models.FailoverRule
	m.DB.Where("enabled = ?", true).Find(&rules)
	now := time.Now()
	for i := range rules {
		rule := rules[i]
		if rule.CheckInterval <= 0 {
			continue
		}
		// Only run the check when its interval has elapsed since the last check.
		if rule.LastCheckAt != nil && now.Sub(*rule.LastCheckAt) < time.Duration(rule.CheckInterval)*time.Second {
			continue
		}
		m.checkRule(&rule)
	}
}

func (m *Manager) checkRule(rule *models.FailoverRule) {
	timeout := time.Duration(rule.CheckTimeout) * time.Second
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	res := Check(rule.CheckType, rule.CheckTarget, timeout)

	updates := map[string]interface{}{
		"last_check_at": time.Now(),
	}
	if res.OK {
		updates["fail_count"] = 0
		// If currently triggered and the target is healthy again, attempt recovery.
		if rule.Status == "triggered" {
			m.recover(rule)
		}
	} else {
		failCount := rule.FailCount + 1
		updates["fail_count"] = failCount
		if rule.Status == "normal" && failCount >= max(rule.RetryCount, 1) {
			m.trigger(rule)
		}
	}
	m.DB.Model(&models.FailoverRule{}).Where("id = ?", rule.ID).Updates(updates)
}

// TriggerRule forces a failover action for the rule (used by the handler for
// manual triggering). The rule's Status is updated to "triggered" on success.
func (m *Manager) TriggerRule(rule *models.FailoverRule) {
	m.trigger(rule)
}

// RecoverRule forces a recovery action for the rule (used by the handler for
// manual recovery). The rule's Status is updated to "normal" on success.
func (m *Manager) RecoverRule(rule *models.FailoverRule) {
	m.recover(rule)
}

// trigger performs the failover action (pause or modify) and marks the rule triggered.
func (m *Manager) trigger(rule *models.FailoverRule) {
	var record models.DNSRecord
	if err := m.DB.Preload("Domain.Platform").First(&record, rule.RecordID).Error; err != nil {
		m.log(rule.ID, "triggered", "触发失败：未找到记录", "", "", err.Error())
		return
	}
	domain := record.Domain
	platform := domain.Platform

	provider, err := dns.ProviderFor(platform)
	if err != nil {
		m.log(rule.ID, "triggered", "触发失败：初始化提供商", "", "", err.Error())
		return
	}

	oldValue := record.Value

	var newValue string
	switch rule.ActionType {
	case "pause":
		// Pause falls back to "modify" semantics using BackupValue.
		if rule.BackupValue == "" {
			m.log(rule.ID, "triggered", "触发失败：暂停类型缺少备用值", oldValue, "", "备用值为空")
			return
		}
		newValue = rule.BackupValue
	case "modify":
		newValue = rule.BackupValue
	default:
		m.log(rule.ID, "triggered", "触发失败：不支持的操作类型", oldValue, newValue, rule.ActionType)
		return
	}

	if err := provider.UpdateRecord(domain.Domain, record.PlatformRecordID, dns.Record{
		Name:    record.Name,
		Type:    record.Type,
		Value:   newValue,
		TTL:     record.TTL,
		Proxied: record.Proxied,
	}); err != nil {
		m.log(rule.ID, "triggered", "触发失败：修改记录", oldValue, newValue, err.Error())
		return
	}

	m.DB.Model(&models.FailoverRule{}).Where("id = ?", rule.ID).Updates(map[string]interface{}{
		"status":         "triggered",
		"original_value": oldValue,
	})

	// Persist the new value locally for reference.
	m.DB.Model(&models.DNSRecord{}).Where("id = ?", record.ID).Update("value", newValue)

	m.log(rule.ID, "triggered", "故障触发，已切换记录", oldValue, newValue, "")
	m.sendNotification(rule, fmt.Sprintf("容灾规则「%s」已触发，记录值已从 %s 切换为 %s", rule.Name, oldValue, newValue))
}

// recover restores the original record value and marks the rule normal.
func (m *Manager) recover(rule *models.FailoverRule) {
	var record models.DNSRecord
	if err := m.DB.Preload("Domain.Platform").First(&record, rule.RecordID).Error; err != nil {
		m.log(rule.ID, "recovered", "恢复失败：未找到记录", "", "", err.Error())
		return
	}
	domain := record.Domain
	platform := domain.Platform

	provider, err := dns.ProviderFor(platform)
	if err != nil {
		m.log(rule.ID, "recovered", "恢复失败：初始化提供商", "", "", err.Error())
		return
	}

	original := rule.OriginalValue
	if original == "" {
		original = record.Value
	}

	if err := provider.UpdateRecord(domain.Domain, record.PlatformRecordID, dns.Record{
		Name:    record.Name,
		Type:    record.Type,
		Value:   original,
		TTL:     record.TTL,
		Proxied: record.Proxied,
	}); err != nil {
		m.log(rule.ID, "recovered", "恢复失败：还原记录", record.Value, original, err.Error())
		return
	}

	m.DB.Model(&models.FailoverRule{}).Where("id = ?", rule.ID).Updates(map[string]interface{}{
		"status":         "normal",
		"original_value": "",
	})
	m.DB.Model(&models.DNSRecord{}).Where("id = ?", record.ID).Update("value", original)

	m.log(rule.ID, "recovered", "目标已恢复，记录已还原", record.Value, original, "")
	m.sendNotification(rule, fmt.Sprintf("容灾规则「%s」已恢复，记录值已还原为 %s", rule.Name, original))
}

func (m *Manager) log(ruleID uint, event, message, oldValue, newValue, errDetail string) {
	entry := models.FailoverLog{
		RuleID:   ruleID,
		Event:    event,
		Message:  message,
		OldValue: oldValue,
		NewValue: newValue,
	}
	if errDetail != "" {
		entry.Message = message + ": " + errDetail
	}
	m.DB.Create(&entry)
}

func (m *Manager) sendNotification(rule *models.FailoverRule, content string) {
	notify.SendToChannels(m.DB, rule.NotifyChannels, "容灾切换告警", content)
}

