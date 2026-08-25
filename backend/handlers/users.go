package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"ksm-dns/models"
)

type UsersHandler struct {
	DB *gorm.DB
}

type createUserRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required,min=8"`
}

type updateUserRequest struct {
	Password string `json:"password" binding:"omitempty,min=8"`
}

// ListUsers returns all users. Passwords are never exposed.
func (h *UsersHandler) ListUsers(c *gin.Context) {
	var users []models.User
	query := h.DB.Model(&models.User{}).Order("id asc")
	p := parsePagination(c, 20)
	var total int64
	query.Count(&total)
	query.Limit(p.PageSize).Offset(p.Offset).Find(&users)
	c.JSON(http.StatusOK, paginatedResult(users, total, p))
}

// GetUser returns a single user together with its domain permissions.
func (h *UsersHandler) GetUser(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var user models.User
	if err := h.DB.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}
	var perms []models.SubUserPermission
	h.DB.Preload("Domain").Where("user_id = ?", user.ID).Find(&perms)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"user": user, "permissions": perms}})
}

// CreateUser creates a new sub-user account.
func (h *UsersHandler) CreateUser(c *gin.Context) {
	var req createUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误，密码至少8位且需包含大小写字母和数字"})
		return
	}
	if !isValidPassword(req.Password) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "密码必须至少8位且包含大写字母、小写字母和数字"})
		return
	}

	var existing models.User
	if err := h.DB.Where("username = ?", req.Username).First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "用户名已存在"})
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}

	user := models.User{
		Username: req.Username,
		Password: string(hashed),
		Role:     "subuser",
	}
	if err := h.DB.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": user})
}

// UpdateUser resets a user's password.
func (h *UsersHandler) UpdateUser(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var user models.User
	if err := h.DB.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}

	var req updateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误，密码至少8位且需包含大小写字母和数字"})
		return
	}

	if req.Password != "" {
		if !isValidPassword(req.Password) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "密码必须至少8位且包含大写字母、小写字母和数字"})
			return
		}
		hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
			return
		}
		user.Password = string(hashed)
		if err := h.DB.Save(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": user})
}

// DeleteUser removes a sub-user and all of its domain permissions. The admin
// account (role == "admin") cannot be deleted.
func (h *UsersHandler) DeleteUser(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var user models.User
	if err := h.DB.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}
	if user.Role == "admin" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能删除管理员账号"})
		return
	}
	h.DB.Where("user_id = ?", user.ID).Delete(&models.SubUserPermission{})
	h.DB.Delete(&user)
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// SetPermissions replaces a sub-user's domain permissions with the provided set.
func (h *UsersHandler) SetPermissions(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var user models.User
	if err := h.DB.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}
	if user.Role == "admin" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "管理员拥有全部权限，无需分配"})
		return
	}

	var req struct {
		Permissions []struct {
			DomainID   uint   `json:"domain_id" binding:"required"`
			Permission string `json:"permission" binding:"required"`
		} `json:"permissions" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	for _, p := range req.Permissions {
		if p.Permission != "read" && p.Permission != "write" && p.Permission != "manage" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "权限级别只能是 read、write 或 manage"})
			return
		}
		var domain models.Domain
		if err := h.DB.First(&domain, p.DomainID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "域名不存在"})
			return
		}
	}

	// Replace existing permissions atomically.
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", user.ID).Delete(&models.SubUserPermission{}).Error; err != nil {
			return err
		}
		for _, p := range req.Permissions {
			perm := models.SubUserPermission{
				UserID:     user.ID,
				DomainID:   p.DomainID,
				Permission: p.Permission,
			}
			if err := tx.Create(&perm).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存权限失败"})
		return
	}

	var perms []models.SubUserPermission
	h.DB.Preload("Domain").Where("user_id = ?", user.ID).Find(&perms)
	c.JSON(http.StatusOK, gin.H{"data": perms})
}
