package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
)

var encKey []byte

// Init loads or generates the encryption key. Call once at startup.
// If KSM_ENCRYPTION_KEY is set it is used directly (hex-encoded 32 bytes);
// otherwise a random key is generated and persisted to disk.
func Init(dataDir string) {
	if s := os.Getenv("KSM_ENCRYPTION_KEY"); s != "" {
		key, err := hex.DecodeString(s)
		if err != nil || len(key) != 32 {
			log.Fatal("KSM_ENCRYPTION_KEY 必须是 64 位十六进制字符串 (32 字节)")
		}
		encKey = key
		return
	}

	keyPath := filepath.Join(dataDir, "encryption_key")
	if b, err := os.ReadFile(keyPath); err == nil && len(strings.TrimSpace(string(b))) == 64 {
		key, err := hex.DecodeString(strings.TrimSpace(string(b)))
		if err == nil && len(key) == 32 {
			encKey = key
			return
		}
	}

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		log.Fatal("生成加密密钥失败:", err)
	}
	encKey = key

	os.MkdirAll(filepath.Dir(keyPath), 0755)
	if err := os.WriteFile(keyPath, []byte(hex.EncodeToString(key)), 0600); err != nil {
		log.Fatal("写入加密密钥失败:", err)
	}
	log.Println("已生成新的数据加密密钥")
}

// Encrypt encrypts plaintext with AES-256-GCM and returns a base64-encoded
// string containing the nonce followed by the ciphertext. An empty plaintext
// is returned as-is (no encryption).
func Encrypt(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	if encKey == nil {
		return plaintext, nil // Encryption not initialized, pass through.
	}

	block, err := aes.NewCipher(encKey)
	if err != nil {
		return "", fmt.Errorf("创建 AES cipher 失败: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("创建 GCM 失败: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("生成 nonce 失败: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt reverses Encrypt. An empty string is returned as-is.
func Decrypt(ciphertext string) (string, error) {
	if ciphertext == "" {
		return "", nil
	}
	if encKey == nil {
		return ciphertext, nil
	}

	// Fast path: if the value is valid JSON, it was likely stored before
	// encryption was enabled. Return as-is.
	if strings.HasPrefix(strings.TrimSpace(ciphertext), "{") {
		return ciphertext, nil
	}

	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		// Not valid base64, probably unencrypted data.
		return ciphertext, nil
	}

	block, err := aes.NewCipher(encKey)
	if err != nil {
		return "", fmt.Errorf("创建 AES cipher 失败: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("创建 GCM 失败: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		// Not enough data for nonce + ciphertext, probably unencrypted.
		return ciphertext, nil
	}

	nonce, ct := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		// Decryption failed, probably unencrypted legacy data.
		return ciphertext, nil
	}
	return string(plaintext), nil
}