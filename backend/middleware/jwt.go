package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"

	"ksm-dns/config"
	"ksm-dns/models"
)

func unauthorized(c *gin.Context, msg string) {
	c.JSON(http.StatusUnauthorized, gin.H{"error": msg})
	c.Abort()
}

func JWTAuth(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			unauthorized(c, "未提供认证令牌")
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			unauthorized(c, "认证格式错误")
			return
		}

		token, err := jwt.Parse(parts[1], func(token *jwt.Token) (interface{}, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(config.Cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			unauthorized(c, "令牌无效或已过期")
			return
		}

		// Reads on a nil map are fine, so failed claim extraction yields zeros.
		claims, ok := token.Claims.(jwt.MapClaims)
		userID, okUserID := claims["user_id"].(float64)
		username, okUsername := claims["username"].(string)
		if !ok || !okUserID || !okUsername {
			unauthorized(c, "令牌解析失败")
			return
		}

		role, ok := claims["role"].(string)
		if !ok {
			role = "subuser"
		}

		// Verify token version matches the current user's token version.
		// This invalidates all existing tokens when the password is changed.
		tokenVersion, _ := claims["token_version"].(float64)
		var user models.User
		if err := db.Select("token_version").First(&user, uint(userID)).Error; err == nil {
			if user.TokenVersion != int(tokenVersion) {
				unauthorized(c, "令牌已失效，请重新登录")
				return
			}
		}

		c.Set("user_id", uint(userID))
		c.Set("username", username)
		c.Set("role", role)
		c.Next()
	}
}
