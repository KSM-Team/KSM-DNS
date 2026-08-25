package monitor

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/net/ipv6"
)

// isPrivateIP reports whether ip is in a private or reserved range that should
// not be reachable via health checks.
func isPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsPrivate() || ip.IsUnspecified() {
		return true
	}
	return false
}

// validateCheckTarget parses a host:port or URL target and returns an error if
// the resolved IP falls into a private/internal range.
func validateCheckTarget(checkType, target string) error {
	host := target
	switch checkType {
	case "http", "https":
		u, err := url.Parse(target)
		if err != nil {
			// Try prefixing with scheme.
			u, err = url.Parse(checkType + "://" + target)
			if err != nil {
				return fmt.Errorf("无法解析目标 URL: %w", err)
			}
		}
		host = u.Hostname()
		if host == "" {
			host = u.Host
		}
	case "tcp":
		h, _, err := net.SplitHostPort(target)
		if err == nil {
			host = h
		}
	}

	// Resolve hostname.
	ip := net.ParseIP(host)
	if ip == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil // Allow if DNS fails; the health check itself will fail.
		}
		if len(addrs) == 0 {
			return nil
		}
		ip = addrs[0].IP
	}

	if isPrivateIP(ip) {
		return fmt.Errorf("不允许检测内网地址: %s (%s)", host, ip.String())
	}
	return nil
}

// CheckResult is the outcome of a single health check.
type CheckResult struct {
	OK    bool
	Error string
}

// Check performs a health check of the given type against target.
// Supported types: ping, tcp, http, https.
func Check(checkType, target string, timeout time.Duration) CheckResult {
	if err := validateCheckTarget(checkType, target); err != nil {
		return CheckResult{OK: false, Error: err.Error()}
	}
	switch checkType {
	case "ping":
		return checkPing(target, timeout)
	case "tcp":
		return checkTCP(target, timeout)
	case "http":
		return checkHTTP("http://"+target, timeout)
	case "https":
		return checkHTTP("https://"+target, timeout)
	default:
		return CheckResult{OK: false, Error: "不支持的检测类型: " + checkType}
	}
}

func checkTCP(target string, timeout time.Duration) CheckResult {
	conn, err := net.DialTimeout("tcp", target, timeout)
	if err != nil {
		return CheckResult{OK: false, Error: err.Error()}
	}
	conn.Close()
	return CheckResult{OK: true}
}

func checkHTTP(url string, timeout time.Duration) CheckResult {
	client := &http.Client{
		Timeout: timeout,
	}
	resp, err := client.Get(url)
	if err != nil {
		return CheckResult{OK: false, Error: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 500 {
		return CheckResult{OK: true}
	}
	return CheckResult{OK: false, Error: "HTTP 状态码 " + strconv.Itoa(resp.StatusCode)}
}

func checkPing(target string, timeout time.Duration) CheckResult {
	host := target
	if h, _, err := net.SplitHostPort(target); err == nil {
		host = h
	}

	ip := net.ParseIP(host)
	if ip == nil {
		// Resolve hostname.
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return CheckResult{OK: false, Error: err.Error()}
		}
		if len(addrs) == 0 {
			return CheckResult{OK: false, Error: "无法解析主机"}
		}
		ip = addrs[0].IP
	}

	return pingIP(ip, timeout)
}

func pingIP(ip net.IP, timeout time.Duration) CheckResult {
	seq := int(time.Now().UnixNano() & 0xFFFF)

	if ip.To4() != nil {
		c, err := icmp.ListenPacket("udp4", "0.0.0.0")
		if err != nil {
			// ICMP requires CAP_NET_RAW or root on Linux; fall back to TCP.
			return fallbackTCP(ip, timeout, err)
		}
		defer c.Close()

		m := icmp.Message{
			Type: ipv4.ICMPTypeEcho,
			Code: 0,
			Body: &icmp.Echo{
				ID:   0,
				Seq:  seq,
				Data: []byte("ksm-dns"),
			},
		}
		b, err := m.Marshal(nil)
		if err != nil {
			return CheckResult{OK: false, Error: err.Error()}
		}
		if _, err := c.WriteTo(b, &net.UDPAddr{IP: ip}); err != nil {
			return CheckResult{OK: false, Error: err.Error()}
		}

		if err := c.SetReadDeadline(time.Now().Add(timeout)); err != nil {
			return CheckResult{OK: false, Error: err.Error()}
		}
		rb := make([]byte, 1500)
		for {
			n, _, err := c.ReadFrom(rb)
			if err != nil {
				return CheckResult{OK: false, Error: err.Error()}
			}
			msg, err := icmp.ParseMessage(1, rb[:n])
			if err != nil {
				continue
			}
			if msg.Type == ipv4.ICMPTypeEchoReply {
				return CheckResult{OK: true}
			}
		}
	}

	c, err := icmp.ListenPacket("udp6", "::")
	if err != nil {
		return fallbackTCP(ip, timeout, err)
	}
	defer c.Close()

	m := icmp.Message{
		Type: ipv6.ICMPTypeEchoRequest,
		Code: 0,
		Body: &icmp.Echo{
			ID:   0,
			Seq:  seq,
			Data: []byte("ksm-dns"),
		},
	}
	b, err := m.Marshal(nil)
	if err != nil {
		return CheckResult{OK: false, Error: err.Error()}
	}
	if _, err := c.WriteTo(b, &net.UDPAddr{IP: ip}); err != nil {
		return CheckResult{OK: false, Error: err.Error()}
	}

	if err := c.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		return CheckResult{OK: false, Error: err.Error()}
	}
	rb := make([]byte, 1500)
	for {
		n, _, err := c.ReadFrom(rb)
		if err != nil {
			return CheckResult{OK: false, Error: err.Error()}
		}
		msg, err := icmp.ParseMessage(58, rb[:n])
		if err != nil {
			continue
		}
		if msg.Type == ipv6.ICMPTypeEchoReply {
			return CheckResult{OK: true}
		}
	}
}

// fallbackTCP attempts a TCP connection to common ports when ICMP is unavailable.
func fallbackTCP(ip net.IP, timeout time.Duration, icmpErr error) CheckResult {
	addr := net.JoinHostPort(ip.String(), "80")
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err == nil {
		conn.Close()
		return CheckResult{OK: true}
	}
	// Try HTTPS port as well.
	addr = net.JoinHostPort(ip.String(), "443")
	conn, err = net.DialTimeout("tcp", addr, timeout)
	if err == nil {
		conn.Close()
		return CheckResult{OK: true}
	}
	return CheckResult{OK: false, Error: "ICMP ping 不可用（需要 root 权限），TCP 80/443 连接也失败: " + icmpErr.Error()}
}

// FormatTarget normalizes a bare host:port target for the given check type.
func FormatTarget(checkType, target string) string {
	return checkType + " " + target
}
