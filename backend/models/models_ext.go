package models

import (
	"time"

	"gorm.io/gorm"
)

type FailoverLog struct {
	ID         uint      `gorm:"primarykey" json:"id"`
	RuleID     uint      `gorm:"index" json:"rule_id"`
	Event      string    `gorm:"size:50" json:"event"` // triggered, recovered
	Message    string    `gorm:"type:text" json:"message"`
	OldValue   string    `gorm:"size:500" json:"old_value"`
	NewValue   string    `gorm:"size:500" json:"new_value"`
	CreatedAt  time.Time `json:"created_at"`
}

type SchedulerTask struct {
	ID             uint           `gorm:"primarykey" json:"id"`
	Name           string         `gorm:"size:200" json:"name"`
	DomainID       uint           `gorm:"index" json:"domain_id"`
	Domain         Domain         `gorm:"foreignKey:DomainID" json:"domain_info,omitempty"`
	RecordID       uint           `gorm:"index" json:"record_id"`
	Record         DNSRecord      `gorm:"foreignKey:RecordID" json:"record_info,omitempty"`
	TaskType       string         `gorm:"size:20" json:"task_type"` // once, cron
	CronExpr       string         `gorm:"size:100" json:"cron_expr"`
	ExecuteAt      *time.Time     `json:"execute_at"`
	ActionType     string         `gorm:"size:20" json:"action_type"` // modify, enable, pause, delete
	ActionValue    string         `gorm:"size:500" json:"action_value"`
	NotifyChannels string         `gorm:"type:text" json:"notify_channels"`
	Enabled        bool           `gorm:"default:true" json:"enabled"`
	LastRunAt      *time.Time     `json:"last_run_at"`
	NextRunAt      *time.Time     `json:"next_run_at"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

type SchedulerLog struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	TaskID    uint      `gorm:"index" json:"task_id"`
	Status    string    `gorm:"size:50" json:"status"` // success, failed
	Message   string    `gorm:"type:text" json:"message"`
	CreatedAt time.Time `json:"created_at"`
}

type SSLCertificate struct {
	ID            uint           `gorm:"primarykey" json:"id"`
	DomainID      uint           `gorm:"index" json:"domain_id"`
	Domain        Domain         `gorm:"foreignKey:DomainID" json:"domain_info,omitempty"`
	DomainName    string         `gorm:"size:255" json:"domain_name"`
	Provider      string         `gorm:"size:50;default:letsencrypt" json:"provider"`
	Certificate   string         `gorm:"type:text" json:"-"`
	PrivateKey    string         `gorm:"type:text" json:"-"`
	ExpiresAt     *time.Time     `json:"expires_at"`
	IssuedAt      *time.Time     `json:"issued_at"`
	Status        string         `gorm:"size:50;default:pending" json:"status"` // pending, issued, expired, failed
	AutoRenew     bool           `gorm:"default:true" json:"auto_renew"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`
}

type SSLDeployTarget struct {
	ID                 uint           `gorm:"primarykey" json:"id"`
	CertificateID      uint           `gorm:"index" json:"certificate_id"`
	Name               string         `gorm:"size:200" json:"name"`
	Host               string         `gorm:"size:255" json:"host"`
	Port               int            `gorm:"default:22" json:"port"`
	Username           string         `gorm:"size:100" json:"username"`
	AuthType           string         `gorm:"size:20" json:"auth_type"` // password, key
	Password           string         `gorm:"size:255" json:"-"`
	PrivateKey         string         `gorm:"type:text" json:"-"`
	CertPath           string         `gorm:"size:500" json:"cert_path"`
	KeyPath            string         `gorm:"size:500" json:"key_path"`
	ReloadCmd          string         `gorm:"size:500" json:"reload_cmd"`
	Status             string         `gorm:"size:50;default:pending" json:"status"`
	LastDeployAt       *time.Time     `json:"last_deploy_at"`
	HostKeyFingerprint string         `gorm:"size:255" json:"host_key_fingerprint"` // SHA256 fingerprint for TOFU verification
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
	DeletedAt          gorm.DeletedAt `gorm:"index" json:"-"`
}

type NotificationChannel struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	Name      string         `gorm:"size:200" json:"name"`
	Type      string         `gorm:"size:20" json:"type"` // email, telegram, webpush
	Config    string         `gorm:"type:text" json:"config"` // JSON config
	Enabled   *bool          `gorm:"default:true" json:"enabled"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// PushSubscription is a Web Push subscription registered by a browser. The
// endpoint and keys are stored so the backend can deliver push notifications
// (Apple Web Push requires the app be installed to the Home Screen and the
// subscription be created from a direct user gesture).
type PushSubscription struct {
	ID          uint      `gorm:"primarykey" json:"id"`
	UserID      uint      `gorm:"index" json:"user_id"`
	Endpoint    string    `gorm:"size:1024;uniqueIndex" json:"endpoint"`
	P256dh      string    `gorm:"type:text" json:"p256dh"`
	Auth        string    `gorm:"size:255" json:"auth"`
	UserAgent   string    `gorm:"size:500" json:"user_agent"`
	CreatedAt   time.Time `json:"created_at"`
}

type NotificationLog struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	ChannelID uint      `gorm:"index" json:"channel_id"`
	Title     string    `gorm:"size:255" json:"title"`
	Content   string    `gorm:"type:text" json:"content"`
	Status    string    `gorm:"size:50" json:"status"` // sent, failed
	Error     string    `gorm:"type:text" json:"error"`
	CreatedAt time.Time `json:"created_at"`
}
