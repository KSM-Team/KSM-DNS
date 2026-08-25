package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// AdminOnly blocks non-admin users. It must run after JWTAuth.
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString("role") != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "无权限执行此操作"})
			c.Abort()
			return
		}
		c.Next()
	}
}
