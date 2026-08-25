package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/robfig/cron/v3"
	"gorm.io/gorm"

	"ksm-dns/models"
	"ksm-dns/services/scheduler"
)

type SchedulerHandler struct {
	DB      *gorm.DB
	Manager *scheduler.Manager
}

func (h *SchedulerHandler) List(c *gin.Context) {
	var tasks []models.SchedulerTask
	query := h.DB.Preload("Domain").Preload("Record").Order("id desc")
	if domainIDs, isAdmin := allowedDomainIDs(h.DB, c); !isAdmin {
		query = query.Where("domain_id IN ?", domainIDs)
	}
	p := parsePagination(c, 20)
	var total int64
	query.Model(&models.SchedulerTask{}).Count(&total)
	query.Limit(p.PageSize).Offset(p.Offset).Find(&tasks)
	c.JSON(http.StatusOK, paginatedResult(tasks, total, p))
}

func (h *SchedulerHandler) Get(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var task models.SchedulerTask
	if err := h.DB.Preload("Domain").Preload("Record").First(&task, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "定时任务不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": task})
}

func (h *SchedulerHandler) Create(c *gin.Context) {
	var req struct {
		Name           string   `json:"name" binding:"required"`
		DomainID       uint     `json:"domain_id" binding:"required"`
		RecordID       uint     `json:"record_id" binding:"required"`
		TaskType       string   `json:"task_type" binding:"required"`
		CronExpr       string   `json:"cron_expr"`
		ExecuteAt      string   `json:"execute_at"`
		ActionType     string   `json:"action_type" binding:"required"`
		ActionValue    string   `json:"action_value"`
		NotifyChannels []uint   `json:"notify_channels"`
		Enabled        *bool    `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	// Validate record belongs to domain.
	var record models.DNSRecord
	if err := h.DB.First(&record, req.RecordID).Error; err != nil || record.DomainID != req.DomainID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "记录不存在或不属于该域名"})
		return
	}

	if req.TaskType != "once" && req.TaskType != "cron" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的任务类型"})
		return
	}
	if !validAction(req.ActionType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的操作类型"})
		return
	}

	var executeAt *time.Time
	var nextRunAt *time.Time
	if req.TaskType == "cron" {
		if req.CronExpr == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Cron 表达式不能为空"})
			return
		}
		sched, err := cron.ParseStandard(req.CronExpr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Cron 表达式无效: " + err.Error()})
			return
		}
		next := sched.Next(time.Now())
		nextRunAt = &next
	} else {
		if req.ExecuteAt == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "执行时间不能为空"})
			return
		}
		t, err := time.Parse("2006-01-02T15:04:05", req.ExecuteAt)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "执行时间格式无效，请使用 YYYY-MM-DDTHH:mm:ss"})
			return
		}
		executeAt = &t
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	task := models.SchedulerTask{
		Name:           req.Name,
		DomainID:       req.DomainID,
		RecordID:       req.RecordID,
		TaskType:       req.TaskType,
		CronExpr:       req.CronExpr,
		ExecuteAt:      executeAt,
		NextRunAt:      nextRunAt,
		ActionType:     req.ActionType,
		ActionValue:    req.ActionValue,
		NotifyChannels: encodeChannelIDs(req.NotifyChannels),
		Enabled:        enabled,
	}
	if err := h.DB.Create(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	h.Manager.Wake()
	c.JSON(http.StatusOK, gin.H{"data": task})
}

func (h *SchedulerHandler) Update(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var task models.SchedulerTask
	if err := h.DB.First(&task, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "定时任务不存在"})
		return
	}

	var req struct {
		Name           string  `json:"name"`
		CronExpr       string  `json:"cron_expr"`
		ExecuteAt      string  `json:"execute_at"`
		ActionType     string  `json:"action_type"`
		ActionValue    string  `json:"action_value"`
		NotifyChannels *[]uint `json:"notify_channels"`
		Enabled        *bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	if req.Name != "" {
		task.Name = req.Name
	}
	if req.ActionType != "" {
		if !validAction(req.ActionType) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的操作类型"})
			return
		}
		task.ActionType = req.ActionType
	}
	if req.ActionValue != "" {
		task.ActionValue = req.ActionValue
	}
	if req.NotifyChannels != nil {
		task.NotifyChannels = encodeChannelIDs(*req.NotifyChannels)
	}
	if req.Enabled != nil {
		task.Enabled = *req.Enabled
	}

	if task.TaskType == "cron" {
		if req.CronExpr != "" {
			sched, err := cron.ParseStandard(req.CronExpr)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Cron 表达式无效: " + err.Error()})
				return
			}
			task.CronExpr = req.CronExpr
			next := sched.Next(time.Now())
			task.NextRunAt = &next
		}
	} else {
		if req.ExecuteAt != "" {
			t, err := time.Parse("2006-01-02T15:04:05", req.ExecuteAt)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "执行时间格式无效"})
				return
			}
			task.ExecuteAt = &t
		}
	}

	if err := h.DB.Save(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}
	h.Manager.Wake()
	c.JSON(http.StatusOK, gin.H{"data": task})
}

func (h *SchedulerHandler) Delete(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	h.DB.Delete(&models.SchedulerTask{}, id)
	h.DB.Where("task_id = ?", id).Delete(&models.SchedulerLog{})
	h.Manager.Wake()
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// RunNow executes a task immediately regardless of its schedule.
func (h *SchedulerHandler) RunNow(c *gin.Context) {
	id, ok := parseUintParam(c, "id"); if !ok { return }
	var task models.SchedulerTask
	if err := h.DB.First(&task, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "定时任务不存在"})
		return
	}
	h.Manager.RunTask(&task)
	c.JSON(http.StatusOK, gin.H{"message": "已执行"})
}

func (h *SchedulerHandler) ListLogs(c *gin.Context) {
	var logs []models.SchedulerLog
	query := h.DB.Order("id desc")
	if domainIDs, isAdmin := allowedDomainIDs(h.DB, c); !isAdmin {
		query = query.Where("task_id IN (SELECT id FROM scheduler_tasks WHERE domain_id IN ?)", domainIDs)
	}
	if tid := c.Query("task_id"); tid != "" {
		query = query.Where("task_id = ?", tid)
	}
	p := parsePagination(c, 20)
	var total int64
	query.Model(&models.SchedulerLog{}).Count(&total)
	query.Limit(p.PageSize).Offset(p.Offset).Find(&logs)
	c.JSON(http.StatusOK, paginatedResult(logs, total, p))
}

func validAction(a string) bool {
	return a == "modify" || a == "enable" || a == "pause" || a == "delete"
}
