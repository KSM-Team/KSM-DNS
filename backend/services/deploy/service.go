package deploy

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"gorm.io/gorm"

	"ksm-dns/models"
)

// Service deploys issued certificates to remote hosts over SSH, writing the
// certificate and private key to their configured paths and running a reload
// command. Authentication supports password or SSH private key.
type Service struct {
	DB *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{DB: db}
}

// Deploy uploads the certificate's PEM files to the target and reloads the
// service. It updates the target status and last deploy timestamp.
func (s *Service) Deploy(target *models.SSLDeployTarget) error {
	var cert models.SSLCertificate
	if err := s.DB.First(&cert, target.CertificateID).Error; err != nil {
		return fmt.Errorf("未找到证书: %w", err)
	}
	if cert.Certificate == "" || cert.PrivateKey == "" {
		return fmt.Errorf("证书尚未签发，无法部署")
	}

	client, err := connect(s.DB, target)
	if err != nil {
		return err
	}
	defer client.Close()

	// Write the certificate chain to its path.
	if err := writeFile(client, target.CertPath, cert.Certificate, "0644"); err != nil {
		return fmt.Errorf("写入证书文件失败: %w", err)
	}
	// Write the private key to its path.
	if err := writeFile(client, target.KeyPath, cert.PrivateKey, "0600"); err != nil {
		return fmt.Errorf("写入密钥文件失败: %w", err)
	}

	if target.ReloadCmd != "" {
		if !isReloadCmdAllowed(target.ReloadCmd) {
			return fmt.Errorf("不允许的 reload 命令: %s", target.ReloadCmd)
		}
		if _, err := runCommand(client, target.ReloadCmd); err != nil {
			return fmt.Errorf("执行 reload 命令失败: %w", err)
		}
	}

	now := time.Now()
	return s.DB.Model(&models.SSLDeployTarget{}).Where("id = ?", target.ID).Updates(map[string]interface{}{
		"status":         "deployed",
		"last_deploy_at": now,
	}).Error
}

// connect establishes an SSH session using password or key authentication.
func connect(db *gorm.DB, target *models.SSLDeployTarget) (*ssh.Client, error) {
	if target.Host == "" {
		return nil, fmt.Errorf("部署目标主机不能为空")
	}
	port := target.Port
	if port <= 0 {
		port = 22
	}

	auth, err := authMethod(target)
	if err != nil {
		return nil, err
	}

	hostKeyCallback, err := tofuHostKeyCallback(db, target)
	if err != nil {
		return nil, err
	}

	config := &ssh.ClientConfig{
		User:            target.Username,
		Auth:            []ssh.AuthMethod{auth},
		HostKeyCallback: hostKeyCallback,
		Timeout:         15 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", target.Host, port)
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return nil, fmt.Errorf("SSH 连接失败: %w", err)
	}
	return client, nil
}

func authMethod(target *models.SSLDeployTarget) (ssh.AuthMethod, error) {
	switch target.AuthType {
	case "key":
		if target.PrivateKey == "" {
			return nil, fmt.Errorf("SSH 私钥不能为空")
		}
		signer, err := ssh.ParsePrivateKey([]byte(target.PrivateKey))
		if err != nil {
			return nil, fmt.Errorf("解析 SSH 私钥失败: %w", err)
		}
		return ssh.PublicKeys(signer), nil
	case "password", "":
		return ssh.Password(target.Password), nil
	default:
		return nil, fmt.Errorf("不支持的认证类型: %s", target.AuthType)
	}
}

// writeFile writes content to a remote path by piping it into a shell command
// that atomically replaces the destination file. This avoids needing SFTP.
func writeFile(client *ssh.Client, remotePath, content, mode string) error {
	if remotePath == "" {
		return fmt.Errorf("远程路径不能为空")
	}
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()

	stdin, err := session.StdinPipe()
	if err != nil {
		return err
	}
	if err := session.Start(fmt.Sprintf("install -m %s /dev/stdin %s", mode, shellQuote(remotePath))); err != nil {
		return err
	}
	if _, err := io.WriteString(stdin, content); err != nil {
		return err
	}
	if err := stdin.Close(); err != nil {
		return err
	}
	return session.Wait()
}

// runCommand executes a remote command and returns its combined output.
func runCommand(client *ssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()
	out, err := session.CombinedOutput(cmd)
	return string(out), err
}

// allowedReloadCmds is a whitelist of permitted service reload commands.
// Any ReloadCmd value must match one of these prefixes to prevent arbitrary
// command execution on remote hosts.
var allowedReloadCmds = []string{
	"nginx -s reload",
	"nginx -s reopen",
	"systemctl reload nginx",
	"systemctl restart nginx",
	"service nginx reload",
	"service nginx restart",
	"apachectl graceful",
	"apachectl -k graceful",
	"systemctl reload apache2",
	"systemctl reload httpd",
	"caddy reload",
	"systemctl reload caddy",
	"supervisorctl restart",
	"docker restart",
	"podman restart",
}

// isReloadCmdAllowed checks whether cmd is a permitted reload command.
func isReloadCmdAllowed(cmd string) bool {
	trimmed := strings.TrimSpace(cmd)
	for _, allowed := range allowedReloadCmds {
		if strings.HasPrefix(trimmed, allowed) {
			// Only allow the command and optional arguments (no chaining).
			rest := strings.TrimPrefix(trimmed, allowed)
			if rest == "" || strings.HasPrefix(rest, " ") {
				// Disallow shell metacharacters in arguments.
				if !strings.ContainsAny(rest, ";&|`$(){}[]<>!\\\n") {
					return true
				}
			}
		}
	}
	return false
}

// tofuHostKeyCallback returns an SSH host key callback that implements
// Trust-On-First-Use (TOFU). On the first connection the host key fingerprint
// is persisted to the database; subsequent connections must present the same
// key or the connection is rejected.
func tofuHostKeyCallback(db *gorm.DB, target *models.SSLDeployTarget) (ssh.HostKeyCallback, error) {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		fp := hostKeyFingerprint(key)

		// First connection — store the fingerprint.
		if target.HostKeyFingerprint == "" {
			return db.Model(&models.SSLDeployTarget{}).
				Where("id = ?", target.ID).
				Update("host_key_fingerprint", fp).Error
		}

		// Subsequent connections — verify the fingerprint matches.
		if target.HostKeyFingerprint != fp {
			return fmt.Errorf(
				"SSH 主机密钥不匹配! 期望 SHA256:%s 实际 SHA256:%s —— 可能存在中间人攻击",
				target.HostKeyFingerprint, fp,
			)
		}
		return nil
	}, nil
}

// hostKeyFingerprint returns the SHA256 fingerprint of an SSH public key in
// the format used by ssh-keygen -lf (SHA256:base64).
func hostKeyFingerprint(key ssh.PublicKey) string {
	hash := sha256.Sum256(key.Marshal())
	return "SHA256:" + base64.StdEncoding.EncodeToString(hash[:])
}

// shellQuote wraps a path in single quotes for safe use inside a shell command.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
