package middleware

import (
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// allowedOrigins returns the list of origins permitted to make cross-origin
// requests. Set KSM_CORS_ORIGINS to a comma-separated list of origins, or
// leave empty to allow the default local development origins.
func allowedOrigins() []string {
	if v := os.Getenv("KSM_CORS_ORIGINS"); v != "" {
		return strings.Split(v, ",")
	}
	return []string{
		"http://localhost:5173",
		"http://localhost:8910",
		"http://127.0.0.1:5173",
		"http://127.0.0.1:8910",
	}
}

func CORS() gin.HandlerFunc {
	origins := allowedOrigins()

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		allowed := false
		for _, o := range origins {
			if o == origin {
				allowed = true
				break
			}
		}
		if allowed {
			c.Header("Access-Control-Allow-Origin", origin)
		}

		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}