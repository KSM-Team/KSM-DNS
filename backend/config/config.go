package config

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"os"
	"path/filepath"
	"strings"
)

var Cfg *Config

type Config struct {
	Port        string
	DBPath      string
	JWTSecret   string
	DataDir     string
	TLSCert     string
	TLSKey      string
	FrontendDir string
}

func Load() *Config {
	// Resolve dataDir relative to the executable so the binary can be started
	// from any working directory. Falls back to the original relative path when
	// os.Executable() fails (e.g. in tests).
	dataDir := filepath.Join("..", "data")
	if d := os.Getenv("KSM_DATA_DIR"); d != "" {
		dataDir = d
	} else if exe, err := os.Executable(); err == nil {
		dataDir = filepath.Join(filepath.Dir(exe), "..", "data")
	}

	jwtSecret := os.Getenv("KSM_JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = loadOrCreateJWTSecret(filepath.Join(dataDir, "jwt_secret"))
	}

	port := os.Getenv("KSM_PORT")
	if port == "" {
		port = "8910"
	}

	frontendDir := os.Getenv("KSM_FRONTEND_DIR")
	if frontendDir == "" {
		// Default: look for frontend/dist next to the backend directory.
		if exe, err := os.Executable(); err == nil {
			frontendDir = filepath.Join(filepath.Dir(exe), "..", "frontend", "dist")
		} else {
			frontendDir = filepath.Join("..", "frontend", "dist")
		}
	}

	Cfg = &Config{
		Port:        port,
		DBPath:      filepath.Join(dataDir, "ksm.db"),
		JWTSecret:   jwtSecret,
		DataDir:     dataDir,
		TLSCert:     os.Getenv("KSM_TLS_CERT"),
		TLSKey:      os.Getenv("KSM_TLS_KEY"),
		FrontendDir: frontendDir,
	}
	return Cfg
}

// loadOrCreateJWTSecret returns a stable JWT signing secret. If one was already
// persisted it is reused so tokens survive restarts; otherwise a random 32-byte
// secret is generated and stored. This removes the hardcoded fallback secret.
func loadOrCreateJWTSecret(path string) string {
	if b, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(b))) > 0 {
		return strings.TrimSpace(string(b))
	}

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		log.Fatal("生成 JWT 密钥失败:", err)
	}
	secret := hex.EncodeToString(buf)

	os.MkdirAll(filepath.Dir(path), 0755)
	if err := os.WriteFile(path, []byte(secret), 0600); err != nil {
		log.Fatal("写入 JWT 密钥失败:", err)
	}
	return secret
}
