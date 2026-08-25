package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-gomail/gomail"
)

// ChannelConfig holds the JSON-decoded configuration for a notification channel.
type ChannelConfig struct {
	Type string `json:"type"` // email, telegram, webpush
	// email
	SMTPHost     string `json:"smtp_host"`
	SMTPPort     int    `json:"smtp_port"`
	SMTPUsername string `json:"smtp_username"`
	SMTPPassword string `json:"smtp_password"`
	FromAddress  string `json:"from_address"`
	ToAddresses  string `json:"to_addresses"` // comma-separated
	// telegram
	BotToken string `json:"bot_token"`
	ChatID   string `json:"chat_id"`
	// webpush
	VAPIDPublicKey  string `json:"vapid_public_key"`
	VAPIDPrivateKey string `json:"vapid_private_key"`
	Subscriber      string `json:"subscriber"` // mailto: address or https URL for VAPID "sub"
}

// Message is a notification payload.
type Message struct {
	Title   string
	Content string
}

// Send delivers a message through the given channel. channelType is the stored
// channel type from the database (e.g. "email", "telegram"), not from the config
// JSON (which may not include a "type" field).
func Send(channelType, configJSON string, msg Message) error {
	var cfg ChannelConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return fmt.Errorf("解析通知配置失败: %w", err)
	}

	switch channelType {
	case "email":
		return sendEmail(cfg, msg)
	case "telegram":
		return sendTelegram(cfg, msg)
	case "webpush":
		return fmt.Errorf("webpush 渠道需要通过服务端推送订阅发送，请使用 Web Push 订阅")
	default:
		return fmt.Errorf("不支持的通知渠道类型: %s", channelType)
	}
}

func sendEmail(cfg ChannelConfig, msg Message) error {
	if cfg.SMTPHost == "" {
		return fmt.Errorf("SMTP 服务器地址未配置")
	}
	port := cfg.SMTPPort
	if port == 0 {
		port = 465
	}

	m := gomail.NewMessage()
	m.SetHeader("Subject", msg.Title)
	if cfg.FromAddress != "" {
		m.SetHeader("From", cfg.FromAddress)
	} else if cfg.SMTPUsername != "" {
		m.SetHeader("From", cfg.SMTPUsername)
	} else {
		return fmt.Errorf("发件人地址未配置")
	}

	if cfg.ToAddresses == "" {
		return fmt.Errorf("收件人地址未配置")
	}
	to := splitComma(cfg.ToAddresses)
	if len(to) == 0 {
		return fmt.Errorf("收件人地址未配置")
	}
	m.SetHeader("To", to...)
	m.SetBody("text/plain", msg.Content)

	d := gomail.NewDialer(cfg.SMTPHost, port, cfg.SMTPUsername, cfg.SMTPPassword)
	// Port 465 uses implicit TLS (SMTPS); gomail defaults to SSL=false
	// which only works with STARTTLS on port 587.
	if port == 465 {
		d.SSL = true
	}
	return d.DialAndSend(m)
}

func sendTelegram(cfg ChannelConfig, msg Message) error {
	if cfg.BotToken == "" || cfg.ChatID == "" {
		return fmt.Errorf("Telegram Bot Token 或 Chat ID 未配置")
	}

	text := html.EscapeString(msg.Content)
	if msg.Title != "" {
		text = fmt.Sprintf("<b>%s</b>\n%s", html.EscapeString(msg.Title), text)
	}

	body := map[string]string{
		"chat_id":    cfg.ChatID,
		"text":       text,
		"parse_mode": "HTML",
	}
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", cfg.BotToken)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("Telegram 发送失败: HTTP %d - %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// splitComma splits a comma- or semicolon-separated address list.
func splitComma(s string) []string {
	parts := strings.FieldsFunc(s, func(r rune) bool {
		return r == ',' || r == ';'
	})
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if part := strings.TrimSpace(p); part != "" {
			out = append(out, part)
		}
	}
	return out
}

// ChannelIDs parses a JSON array of channel IDs into an []uint slice.
func ChannelIDs(raw string) []uint {
	var ids []uint
	if raw == "" {
		return ids
	}
	var list []json.Number
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		var single json.Number
		if err := json.Unmarshal([]byte(raw), &single); err == nil {
			if n, err := strconv.ParseUint(string(single), 10, 64); err == nil {
				ids = append(ids, uint(n))
			}
		}
		return ids
	}
	for _, n := range list {
		if v, err := strconv.ParseUint(string(n), 10, 64); err == nil {
			ids = append(ids, uint(v))
		}
	}
	return ids
}
