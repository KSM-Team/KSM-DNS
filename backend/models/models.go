package models

import (
	"time"

	"gorm.io/gorm"
)

type User struct {
	ID                  uint           `gorm:"primarykey" json:"id"`
	Username            string         `gorm:"uniqueIndex;size:50" json:"username"`
	Password            string         `gorm:"size:255" json:"-"`
	Role                string         `gorm:"size:20;default:admin" json:"role"` // admin, subuser
	MustChangePassword  bool           `gorm:"default:false" json:"must_change_password"`
	TokenVersion        int            `gorm:"default:0" json:"-"`
	FailedLoginAttempts int            `gorm:"default:0" json:"-"`
	LockedUntil         *time.Time     `json:"-"`
	CreatedAt           time.Time      `json:"created_at"`
	UpdatedAt           time.Time      `json:"updated_at"`
	DeletedAt           gorm.DeletedAt `gorm:"index" json:"-"`
}

// SubUserPermission grants a sub-user access to a single domain with a permission level.
type SubUserPermission struct {
	ID         uint      `gorm:"primarykey" json:"id"`
	UserID     uint      `gorm:"index" json:"user_id"`
	DomainID   uint      `gorm:"index" json:"domain_id"`
	Domain     Domain    `gorm:"foreignKey:DomainID" json:"domain_info,omitempty"`
	Permission string    `gorm:"size:20;default:read" json:"permission"` // read, write, manage
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type Setting struct {
	ID    uint   `gorm:"primarykey" json:"id"`
	Key   string `gorm:"uniqueIndex;size:100" json:"key"`
	Value string `gorm:"type:text" json:"value"`
}

type DNSPlatform struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	Name        string         `gorm:"size:100" json:"name"`
	Type        string         `gorm:"size:50" json:"type"` // cloudflare, spaceship, namesilo, aliyun, tencent, porkbun
	Credentials string         `gorm:"type:text" json:"-"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

type Domain struct {
	ID         uint           `gorm:"primarykey" json:"id"`
	PlatformID uint           `gorm:"index" json:"platform_id"`
	Platform   DNSPlatform    `gorm:"foreignKey:PlatformID" json:"platform,omitempty"`
	Domain     string         `gorm:"size:255;index" json:"domain"`
	Status     string         `gorm:"size:50;default:active" json:"status"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`
}

type DNSRecord struct {
	ID               uint           `gorm:"primarykey" json:"id"`
	DomainID         uint           `gorm:"index" json:"domain_id"`
	Domain           Domain         `gorm:"foreignKey:DomainID" json:"domain_info,omitempty"`
	Name             string         `gorm:"size:255" json:"name"`
	Type             string         `gorm:"size:10" json:"type"`
	Value            string         `gorm:"size:500" json:"value"`
	TTL              int            `json:"ttl"`
	Proxied          bool           `json:"proxied"`
	PlatformRecordID string         `gorm:"size:100" json:"platform_record_id"`
	Status           string         `gorm:"size:50;default:active" json:"status"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`
}

type FailoverRule struct {
	ID             uint           `gorm:"primarykey" json:"id"`
	Name           string         `gorm:"size:200" json:"name"`
	DomainID       uint           `gorm:"index" json:"domain_id"`
	Domain         Domain         `gorm:"foreignKey:DomainID" json:"domain_info,omitempty"`
	RecordID       uint           `gorm:"index" json:"record_id"`
	Record         DNSRecord      `gorm:"foreignKey:RecordID" json:"record_info,omitempty"`
	CheckType      string         `gorm:"size:20" json:"check_type"` // ping, tcp, http, https
	CheckTarget    string         `gorm:"size:500" json:"check_target"`
	CheckInterval  int            `json:"check_interval"`  // seconds
	CheckTimeout   int            `json:"check_timeout"`   // seconds
	RetryCount     int            `json:"retry_count"`
	ActionType     string         `gorm:"size:20" json:"action_type"` // pause, modify
	BackupValue    string         `gorm:"size:500" json:"backup_value"`
	OriginalValue  string         `gorm:"size:500" json:"original_value"`
	NotifyChannels string         `gorm:"type:text" json:"notify_channels"` // JSON array of channel IDs
	Enabled        bool           `gorm:"default:true" json:"enabled"`
	Status         string         `gorm:"size:50;default:normal" json:"status"` // normal, triggered, recovering
	LastCheckAt    *time.Time     `json:"last_check_at"`
	FailCount      int            `gorm:"default:0" json:"fail_count"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}
