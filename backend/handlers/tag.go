package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ksm-dns/models"
)

type TagHandler struct {
	DB *gorm.DB
}

func (h *TagHandler) ListTags(c *gin.Context) {
	var tags []models.Tag
	h.DB.Order("id asc").Find(&tags)
	c.JSON(http.StatusOK, gin.H{"data": tags})
}

func (h *TagHandler) CreateTag(c *gin.Context) {
	var req struct {
		Name  string `json:"name" binding:"required"`
		Color string `json:"color"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if req.Color == "" {
		req.Color = "arcoblue"
	}
	tag := models.Tag{Name: req.Name, Color: req.Color}
	if err := h.DB.Create(&tag).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建标签失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tag})
}

func (h *TagHandler) UpdateTag(c *gin.Context) {
	id, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var tag models.Tag
	if err := h.DB.First(&tag, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "标签不存在"})
		return
	}

	var req struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if req.Name != "" {
		tag.Name = req.Name
	}
	if req.Color != "" {
		tag.Color = req.Color
	}
	if err := h.DB.Save(&tag).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新标签失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tag})
}

func (h *TagHandler) DeleteTag(c *gin.Context) {
	id, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	// Remove all domain-tag relations first
	h.DB.Where("tag_id = ?", id).Delete(&models.DomainTag{})
	h.DB.Delete(&models.Tag{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// SetDomainTags replaces all tags for a domain with the given tag IDs.
func (h *TagHandler) SetDomainTags(c *gin.Context) {
	domainID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		TagIDs []uint `json:"tag_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	// Remove existing tags for this domain
	h.DB.Where("domain_id = ?", domainID).Delete(&models.DomainTag{})

	// Add new tags
	for _, tagID := range req.TagIDs {
		h.DB.Create(&models.DomainTag{DomainID: uint(domainID), TagID: tagID})
	}

	c.JSON(http.StatusOK, gin.H{"message": "已更新"})
}