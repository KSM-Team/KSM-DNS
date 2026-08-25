package models

import (
	"strings"

	"gorm.io/gorm"

	"ksm-dns/services/crypto"
)

// ─── Setting ───────────────────────────────────────────────────────────────

func (s *Setting) BeforeSave(tx *gorm.DB) error {
	if s.Value != "" && isSensitiveKey(s.Key) {
		enc, err := crypto.Encrypt(s.Value)
		if err != nil {
			return err
		}
		s.Value = enc
	}
	return nil
}

func (s *Setting) AfterFind(tx *gorm.DB) error {
	if s.Value != "" && isSensitiveKey(s.Key) {
		dec, err := crypto.Decrypt(s.Value)
		if err != nil {
			return err
		}
		s.Value = dec
	}
	return nil
}

func isSensitiveKey(key string) bool {
	return strings.HasSuffix(key, "_private_key") ||
		strings.HasSuffix(key, "_secret") ||
		strings.HasPrefix(key, "acme_")
}

// ─── DNSPlatform ───────────────────────────────────────────────────────────

func (p *DNSPlatform) BeforeSave(tx *gorm.DB) error {
	if p.Credentials != "" {
		enc, err := crypto.Encrypt(p.Credentials)
		if err != nil {
			return err
		}
		p.Credentials = enc
	}
	return nil
}

func (p *DNSPlatform) AfterFind(tx *gorm.DB) error {
	if p.Credentials != "" {
		dec, err := crypto.Decrypt(p.Credentials)
		if err != nil {
			return err
		}
		p.Credentials = dec
	}
	return nil
}

// ─── NotificationChannel ───────────────────────────────────────────────────

func (ch *NotificationChannel) BeforeSave(tx *gorm.DB) error {
	if ch.Config != "" {
		enc, err := crypto.Encrypt(ch.Config)
		if err != nil {
			return err
		}
		ch.Config = enc
	}
	return nil
}

func (ch *NotificationChannel) AfterFind(tx *gorm.DB) error {
	if ch.Config != "" {
		dec, err := crypto.Decrypt(ch.Config)
		if err != nil {
			return err
		}
		ch.Config = dec
	}
	return nil
}

// ─── SSLDeployTarget ───────────────────────────────────────────────────────

func (t *SSLDeployTarget) BeforeSave(tx *gorm.DB) error {
	if t.Password != "" {
		enc, err := crypto.Encrypt(t.Password)
		if err != nil {
			return err
		}
		t.Password = enc
	}
	if t.PrivateKey != "" {
		enc, err := crypto.Encrypt(t.PrivateKey)
		if err != nil {
			return err
		}
		t.PrivateKey = enc
	}
	return nil
}

func (t *SSLDeployTarget) AfterFind(tx *gorm.DB) error {
	if t.Password != "" {
		dec, err := crypto.Decrypt(t.Password)
		if err != nil {
			return err
		}
		t.Password = dec
	}
	if t.PrivateKey != "" {
		dec, err := crypto.Decrypt(t.PrivateKey)
		if err != nil {
			return err
		}
		t.PrivateKey = dec
	}
	return nil
}

// ─── SSLCertificate ────────────────────────────────────────────────────────

func (c *SSLCertificate) BeforeSave(tx *gorm.DB) error {
	if c.PrivateKey != "" {
		enc, err := crypto.Encrypt(c.PrivateKey)
		if err != nil {
			return err
		}
		c.PrivateKey = enc
	}
	return nil
}

func (c *SSLCertificate) AfterFind(tx *gorm.DB) error {
	if c.PrivateKey != "" {
		dec, err := crypto.Decrypt(c.PrivateKey)
		if err != nil {
			return err
		}
		c.PrivateKey = dec
	}
	return nil
}