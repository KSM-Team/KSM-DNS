package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RateLimiter implements a simple in-memory token-bucket rate limiter keyed by
// client IP. It is suitable for a single-instance deployment.
type RateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*bucket
	rate     int           // requests per window
	window   time.Duration
	cleanupInterval time.Duration
}

type bucket struct {
	tokens   int
	lastSeen time.Time
	resetAt  time.Time
}

// NewRateLimiter creates a rate limiter allowing at most `rate` requests per
// `window` duration. A background goroutine periodically cleans up stale
// entries.
func NewRateLimiter(rate int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		buckets:  make(map[string]*bucket),
		rate:     rate,
		window:   window,
		cleanupInterval: 10 * time.Minute,
	}
	go rl.cleanup()
	return rl
}

func (rl *RateLimiter) cleanup() {
	for {
		time.Sleep(rl.cleanupInterval)
		rl.mu.Lock()
		now := time.Now()
		for ip, b := range rl.buckets {
			if now.Sub(b.lastSeen) > rl.cleanupInterval {
				delete(rl.buckets, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// Allow reports whether the request from the given IP is allowed. Returns true
// on the first call from an IP, and false once the rate limit is exceeded.
func (rl *RateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, ok := rl.buckets[ip]
	if !ok || now.After(b.resetAt) {
		rl.buckets[ip] = &bucket{
			tokens:   rl.rate - 1,
			lastSeen: now,
			resetAt:  now.Add(rl.window),
		}
		return true
	}

	b.lastSeen = now
	if b.tokens > 0 {
		b.tokens--
		return true
	}
	return false
}

// LoginRateLimit returns a middleware that limits login attempts.
func LoginRateLimit() gin.HandlerFunc {
	limiter := NewRateLimiter(20, time.Minute)

	return func(c *gin.Context) {
		ip := c.ClientIP()
		if !limiter.Allow(ip) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "请求过于频繁，请稍后再试",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}