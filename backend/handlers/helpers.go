package handlers

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ksm-dns/models"
)

// Pagination holds parsed page/page_size query params.
type Pagination struct {
	Page     int
	PageSize int
	Offset   int
}

// parsePagination reads `page` and `page_size` query params with sane bounds.
func parsePagination(c *gin.Context, defaultSize int) Pagination {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", strconv.Itoa(defaultSize)))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = defaultSize
	}
	if pageSize > 200 {
		pageSize = 200
	}
	return Pagination{Page: page, PageSize: pageSize, Offset: (page - 1) * pageSize}
}

// permissionRank maps a permission string to a comparable rank.
func permissionRank(p string) int {
	switch p {
	case "manage":
		return 3
	case "write":
		return 2
	case "read":
		return 1
	}
	return 0
}

// allowedDomainIDs returns the domain IDs a sub-user may access. When the
// second return value is true the caller is an admin with unrestricted access.
func allowedDomainIDs(db *gorm.DB, c *gin.Context) ([]uint, bool) {
	if c.GetString("role") == "admin" {
		return nil, true
	}
	userID := c.GetUint("user_id")
	var perms []models.SubUserPermission
	db.Where("user_id = ?", userID).Find(&perms)
	ids := make([]uint, 0, len(perms))
	for _, p := range perms {
		ids = append(ids, p.DomainID)
	}
	return ids, false
}

// hasDomainPermission reports whether the current user may perform an action of
// minPermission ("read"/"write"/"manage") on the given domain. Admins always pass.
func hasDomainPermission(db *gorm.DB, c *gin.Context, domainID uint, minPermission string) bool {
	if c.GetString("role") == "admin" {
		return true
	}
	userID := c.GetUint("user_id")
	var perm models.SubUserPermission
	if err := db.Where("user_id = ? AND domain_id = ?", userID, domainID).First(&perm).Error; err != nil {
		return false
	}
	return permissionRank(perm.Permission) >= permissionRank(minPermission)
}

// parseUintParam reads a named route parameter as uint, returning an error
// response and false when the value is missing or malformed. Callers should
// return immediately when ok is false.
func parseUintParam(c *gin.Context, name string) (uint, bool) {
	raw := c.Param(name)
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("缺少参数 %s", name)})
		return 0, false
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("参数 %s 格式无效: %s", name, raw)})
		return 0, false
	}
	return uint(v), true
}

// paginatedResult is the standard shape returned by paginated list endpoints.
func paginatedResult(data interface{}, total int64, p Pagination) gin.H {
	return gin.H{
		"data":      data,
		"total":     total,
		"page":      p.Page,
		"page_size": p.PageSize,
	}
}
