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
	dataDir := resolveDataDir()

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
		frontendDir = resolveFrontendDir()
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

// resolveDataDir determines the data directory using the following precedence:
// 1. KSM_DATA_DIR environment variable
// 2. Relative to the current working directory (works with go run)
// 3. Relative to the executable path (works with compiled binaries)
// 4. Fallback to "../data"
func resolveDataDir() string {
	if d := os.Getenv("KSM_DATA_DIR"); d != "" {
		return d
	}
	if wd, err := os.Getwd(); err == nil {
		// Try ../data from working directory first (covers go run)
		dir := filepath.Join(wd, "..", "data")
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
		// Try ./data from working directory
		dir = filepath.Join(wd, "data")
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Join(filepath.Dir(exe), "..", "data")
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	return filepath.Join("..", "data")
}

// resolveFrontendDir determines the frontend directory using the same precedence
// as resolveDataDir but looking for "frontend/dist" instead of "data".
func resolveFrontendDir() string {
	if wd, err := os.Getwd(); err == nil {
		dir := filepath.Join(wd, "..", "frontend", "dist")
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
		dir = filepath.Join(wd, "frontend", "dist")
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Join(filepath.Dir(exe), "..", "frontend", "dist")
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	return filepath.Join("..", "frontend", "dist")
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
