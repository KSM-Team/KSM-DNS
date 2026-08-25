package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"ksm-dns/config"
	"ksm-dns/models"
)

type AuthHandler struct {
	DB *gorm.DB
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type ChangePasswordRequest struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required,min=8"`
}

// isValidPassword checks that the password meets minimum complexity requirements.
func isValidPassword(p string) bool {
	if len(p) < 8 {
		return false
	}
	hasUpper, hasLower, hasDigit := false, false, false
	for _, r := range p {
		switch {
		case r >= 'A' && r <= 'Z':
			hasUpper = true
		case r >= 'a' && r <= 'z':
			hasLower = true
		case r >= '0' && r <= '9':
			hasDigit = true
		}
	}
	return hasUpper && hasLower && hasDigit
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	var user models.User
	if err := h.DB.Where("username = ?", req.Username).First(&user).Error; err != nil {
		// Use a generic error to avoid username enumeration.
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	// Check if the account is locked due to too many failed attempts.
	if user.LockedUntil != nil && time.Now().Before(*user.LockedUntil) {
		remaining := user.LockedUntil.Sub(time.Now()).Round(time.Second)
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error":           "账户已被锁定，请稍后再试",
			"locked_seconds":  int(remaining.Seconds()),
		})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		// Increment failed login attempts and lock if threshold reached.
		attempts := user.FailedLoginAttempts + 1
		updates := map[string]interface{}{"failed_login_attempts": attempts}
		if attempts >= 5 {
			lockedUntil := time.Now().Add(15 * time.Minute)
			updates["locked_until"] = lockedUntil
		}
		h.DB.Model(&user).Updates(updates)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	// Successful login — reset failed attempts and lockout.
	h.DB.Model(&user).Updates(map[string]interface{}{
		"failed_login_attempts": 0,
		"locked_until":          nil,
	})

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":       user.ID,
		"username":      user.Username,
		"role":          user.Role,
		"token_version": user.TokenVersion,
		"exp":           time.Now().Add(24 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString([]byte(config.Cfg.JWTSecret))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成令牌失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":                tokenString,
		"username":             user.Username,
		"role":                 user.Role,
		"must_change_password": user.MustChangePassword,
	})
}

func (h *AuthHandler) ChangePassword(c *gin.Context) {
	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误，密码至少8位且需包含大小写字母和数字"})
		return
	}
	if !isValidPassword(req.NewPassword) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "密码必须至少8位且包含大写字母、小写字母和数字"})
		return
	}

	userID := c.GetUint("user_id")
	var user models.User
	if err := h.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.OldPassword)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "原密码错误"})
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}

	h.DB.Model(&user).Updates(map[string]interface{}{
		"password":             string(hashed),
		"must_change_password": false,
		"token_version":        user.TokenVersion + 1,
	})
	c.JSON(http.StatusOK, gin.H{"message": "密码修改成功，请重新登录"})
}

func (h *AuthHandler) GetProfile(c *gin.Context) {
	userID := c.GetUint("user_id")
	var user models.User
	if err := h.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":       user.ID,
		"username": user.Username,
		"role":     user.Role,
	})
}

// AdminChangePassword allows an admin to change any user's password without
// knowing the old password. It also clears the must_change_password flag.
func (h *AuthHandler) AdminChangePassword(c *gin.Context) {
	var req struct {
		Username    string `json:"username" binding:"required"`
		NewPassword string `json:"new_password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误，密码至少8位且需包含大小写字母和数字"})
		return
	}
	if !isValidPassword(req.NewPassword) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "密码必须至少8位且包含大写字母、小写字母和数字"})
		return
	}

	var user models.User
	if err := h.DB.Where("username = ?", req.Username).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}

	h.DB.Model(&user).Updates(map[string]interface{}{
		"password":             string(hashed),
		"must_change_password": false,
		"token_version":        user.TokenVersion + 1,
	})
	c.JSON(http.StatusOK, gin.H{"message": "密码修改成功，该用户需重新登录"})
}

// SkipChangePassword clears the must_change_password flag so the user can
// defer the password change. Only callable by the authenticated user themselves
// (not by an admin on behalf of another user).
func (h *AuthHandler) SkipChangePassword(c *gin.Context) {
	userID := c.GetUint("user_id")
	h.DB.Model(&models.User{}).Where("id = ?", userID).Update("must_change_password", false)
	c.JSON(http.StatusOK, gin.H{"message": "已跳过"})
}
