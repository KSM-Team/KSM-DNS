package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ksm-dns/models"
)

// MustChangePassword blocks requests from users whose MustChangePassword flag is
// set, except for the /change-password endpoint. This forces users to change
// their password on first login.
func MustChangePassword(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("user_id")
		if userID == 0 {
			c.Next()
			return
		}

		// Allow password-change and skip endpoints through.
		path := c.Request.URL.Path
		if path == "/api/change-password" || path == "/api/admin/change-user-password" || path == "/api/skip-change-password" {
			c.Next()
			return
		}

		var user models.User
		if err := db.Select("must_change_password").First(&user, userID).Error; err == nil {
			if user.MustChangePassword {
				c.JSON(http.StatusForbidden, gin.H{
					"error":                 "请先修改默认密码",
					"must_change_password": true,
				})
				c.Abort()
				return
			}
		}
		c.Next()
	}
}