package scheduler

import (
	"fmt"
	"sync"
	"time"

	"github.com/robfig/cron/v3"
	"gorm.io/gorm"

	"ksm-dns/models"
	"ksm-dns/services/dns"
	"ksm-dns/services/notify"
)

// Manager runs the background loop that executes scheduled DNS tasks. It is the
// single owner of the goroutine that periodically inspects enabled tasks and
// fires those whose time has come (once) or whose cron schedule matches.
type Manager struct {
	DB       *gorm.DB
	mu       sync.Mutex
	stop     chan struct{}
	stopped  bool
	wake     chan struct{}
	interval time.Duration
}

func NewManager(db *gorm.DB) *Manager {
	return &Manager{
		DB:       db,
		stop:     make(chan struct{}),
		wake:     make(chan struct{}, 1),
		interval: 10 * time.Second,
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

// Wake requests an immediate re-read of tasks (used after CRUD changes).
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
	var tasks []models.SchedulerTask
	m.DB.Where("enabled = ?", true).Find(&tasks)
	now := time.Now()
	for i := range tasks {
		task := tasks[i]
		m.checkTask(&task, now)
	}
}

func (m *Manager) checkTask(task *models.SchedulerTask, now time.Time) {
	switch task.TaskType {
	case "once":
		// Fire exactly once at ExecuteAt.
		if task.ExecuteAt == nil || now.Before(*task.ExecuteAt) {
			return
		}
		m.execute(task)
	case "cron":
		sched, err := cron.ParseStandard(task.CronExpr)
		if err != nil {
			return
		}
		next := sched.Next(now)
		// Fire when the previously recorded next-run time has passed.
		if task.NextRunAt != nil && now.After(*task.NextRunAt) {
			m.execute(task)
		}
		// Only persist NextRunAt when it actually changed to avoid unnecessary DB writes.
		if task.NextRunAt == nil || !task.NextRunAt.Equal(next) {
			m.DB.Model(&models.SchedulerTask{}).Where("id = ?", task.ID).
				Update("next_run_at", next)
		}
	default:
		return
	}
}

// RunTask forces a task to execute immediately (used by the handler for manual
// "run now" triggers).
func (m *Manager) RunTask(task *models.SchedulerTask) {
	m.execute(task)
}

// execute performs the task's action on its target DNS record.
func (m *Manager) execute(task *models.SchedulerTask) {
	var record models.DNSRecord
	if err := m.DB.Preload("Domain.Platform").First(&record, task.RecordID).Error; err != nil {
		m.log(task.ID, "failed", "执行失败：未找到记录: "+err.Error())
		return
	}
	domain := record.Domain
	platform := domain.Platform

	provider, err := dns.ProviderFor(platform)
	if err != nil {
		m.log(task.ID, "failed", "执行失败：初始化提供商: "+err.Error())
		return
	}

	switch task.ActionType {
	case "modify":
		err = m.modify(provider, task, &record, domain, task.ActionValue)
	case "pause":
		err = m.modify(provider, task, &record, domain, pauseValue(record.Type, task.ActionValue))
	case "enable":
		err = m.modify(provider, task, &record, domain, task.ActionValue)
	case "delete":
		err = provider.DeleteRecord(domain.Domain, record.PlatformRecordID)
		if err == nil {
			m.DB.Delete(&record)
		}
	default:
		err = fmt.Errorf("不支持的操作类型: %s", task.ActionType)
	}

	now := time.Now()
	updates := map[string]interface{}{"last_run_at": now}
	if err != nil {
		m.log(task.ID, "failed", "执行失败: "+err.Error())
	} else {
		m.log(task.ID, "success", fmt.Sprintf("任务「%s」执行成功（%s）", task.Name, task.ActionType))
		m.sendNotification(task, fmt.Sprintf("定时任务「%s」已执行成功（操作：%s）", task.Name, task.ActionType))
	}
	if task.TaskType == "once" {
		// Disable after a one-shot run.
		updates["enabled"] = false
	}
	m.DB.Model(&models.SchedulerTask{}).Where("id = ?", task.ID).Updates(updates)
}

func (m *Manager) modify(provider dns.Provider, task *models.SchedulerTask, record *models.DNSRecord, domain models.Domain, newValue string) error {
	if err := provider.UpdateRecord(domain.Domain, record.PlatformRecordID, dns.Record{
		Name:    record.Name,
		Type:    record.Type,
		Value:   newValue,
		TTL:     record.TTL,
		Proxied: record.Proxied,
	}); err != nil {
		return err
	}
	return m.DB.Model(&models.DNSRecord{}).Where("id = ?", record.ID).Update("value", newValue).Error
}

// pauseValue returns a "blackhole" destination for A/AAAA records so they stop
// serving traffic; other record types fall back to the configured action value.
func pauseValue(recordType, actionValue string) string {
	switch recordType {
	case "A":
		return "0.0.0.0"
	case "AAAA":
		return "::"
	default:
		return actionValue
	}
}

func (m *Manager) log(taskID uint, status, message string) {
	m.DB.Create(&models.SchedulerLog{
		TaskID:  taskID,
		Status:  status,
		Message: message,
	})
}

func (m *Manager) sendNotification(task *models.SchedulerTask, content string) {
	notify.SendToChannels(m.DB, task.NotifyChannels, "定时切换告警", content)
}

