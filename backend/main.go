package main

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/SherClockHolmes/webpush-go"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"ksm-dns/config"
	"ksm-dns/handlers"
	"ksm-dns/middleware"
	"ksm-dns/models"
	"ksm-dns/services/crypto"
	"ksm-dns/services/deploy"
	"ksm-dns/services/monitor"
	"ksm-dns/services/scheduler"
	"ksm-dns/services/ssl"
)

func main() {
	cfg := config.Load()

	// Initialize encryption for sensitive data at rest. Must be called before
	// any database operations so GORM hooks can encrypt/decrypt automatically.
	crypto.Init(cfg.DataDir)

	os.MkdirAll(cfg.DataDir, 0755)
	os.MkdirAll(cfg.DataDir+"/uploads", 0755)

	db, err := gorm.Open(sqlite.Open(cfg.DBPath), &gorm.Config{})
	if err != nil {
		log.Fatal("数据库连接失败:", err)
	}

	db.AutoMigrate(
		&models.User{},
		&models.SubUserPermission{},
		&models.Setting{},
		&models.DNSPlatform{},
		&models.Domain{},
		&models.DNSRecord{},
		&models.FailoverRule{},
		&models.FailoverLog{},
		&models.SchedulerTask{},
		&models.SchedulerLog{},
		&models.SSLCertificate{},
		&models.SSLDeployTarget{},
		&models.NotificationChannel{},
		&models.NotificationLog{},
		&models.PushSubscription{},
	)

	initDefaultUser(db)
	initDefaultSettings(db)

	r := gin.Default()
	r.Use(middleware.SecurityHeaders())
	r.Use(middleware.CORS())

	r.Static("/uploads", cfg.DataDir+"/uploads")

	authHandler := &handlers.AuthHandler{DB: db}
	usersHandler := &handlers.UsersHandler{DB: db}
	settingsHandler := &handlers.SettingsHandler{DB: db}
	dnsHandler := &handlers.DNSHandler{DB: db}
	notifyHandler := &handlers.NotifyHandler{DB: db}
	pushHandler := &handlers.PushHandler{DB: db}
	monitorManager := monitor.NewManager(db)
	monitorManager.Start()
	failoverHandler := &handlers.FailoverHandler{DB: db, Manager: monitorManager}
	schedulerManager := scheduler.NewManager(db)
	schedulerManager.Start()
	schedulerHandler := &handlers.SchedulerHandler{DB: db, Manager: schedulerManager}
	sslService := ssl.NewService(db)
	sslStop := make(chan struct{})
	go sslService.StartRenewLoop(sslStop)
	deployService := deploy.NewService(db)
	sslHandler := &handlers.SSLHandler{DB: db, SSL: sslService, Deploy: deployService}

	api := r.Group("/api")
	{
		api.POST("/login", middleware.LoginRateLimit(), authHandler.Login)
		api.GET("/settings/public", settingsHandler.GetPublicSettings)
		api.GET("/push/vapid-public-key", pushHandler.PublicKey)
	}

	protected := api.Group("")
	protected.Use(middleware.JWTAuth(db))
	protected.Use(middleware.MustChangePassword(db))
	{
		protected.GET("/profile", authHandler.GetProfile)
		protected.POST("/change-password", authHandler.ChangePassword)
		protected.POST("/skip-change-password", authHandler.SkipChangePassword)

		// Dashboard (any authenticated user)
		protected.GET("/dashboard/stats", dnsHandler.GetDashboardStats)

		// Domains (filtered by user permissions in handler)
		protected.GET("/domains", dnsHandler.ListDomains)

		// DNS Records (domain-scoped, permission checked in handler)
		protected.GET("/domains/:id/records", dnsHandler.ListRecords)
		protected.POST("/domains/:id/records", dnsHandler.CreateRecord)
		protected.PUT("/records/:recordId", dnsHandler.UpdateRecord)
		protected.DELETE("/records/:recordId", dnsHandler.DeleteRecord)

		// Failover (domain-scoped, permission checked in handler)
		protected.GET("/failover/rules", failoverHandler.List)
		protected.GET("/failover/rules/:id", failoverHandler.Get)
		protected.POST("/failover/rules", failoverHandler.Create)
		protected.PUT("/failover/rules/:id", failoverHandler.Update)
		protected.DELETE("/failover/rules/:id", failoverHandler.Delete)
		protected.POST("/failover/rules/:id/trigger", failoverHandler.Trigger)
		protected.POST("/failover/rules/:id/recover", failoverHandler.Recover)
		protected.GET("/failover/logs", failoverHandler.ListLogs)

		// Scheduler (domain-scoped, permission checked in handler)
		protected.GET("/scheduler/tasks", schedulerHandler.List)
		protected.GET("/scheduler/tasks/:id", schedulerHandler.Get)
		protected.POST("/scheduler/tasks", schedulerHandler.Create)
		protected.PUT("/scheduler/tasks/:id", schedulerHandler.Update)
		protected.DELETE("/scheduler/tasks/:id", schedulerHandler.Delete)
		protected.POST("/scheduler/tasks/:id/run", schedulerHandler.RunNow)
		protected.GET("/scheduler/logs", schedulerHandler.ListLogs)

		// SSL Certificates (domain-scoped, permission checked in handler)
		protected.GET("/ssl/certificates", sslHandler.ListCertificates)
		protected.GET("/ssl/certificates/:id", sslHandler.GetCertificate)
		protected.POST("/ssl/certificates", sslHandler.CreateCertificate)
		protected.POST("/ssl/certificates/:id/issue", sslHandler.IssueCertificate)
		protected.DELETE("/ssl/certificates/:id", sslHandler.DeleteCertificate)

		// SSL Deploy Targets (domain-scoped, permission checked in handler)
		protected.GET("/ssl/certificates/:id/targets", sslHandler.ListDeployTargets)
		protected.POST("/ssl/certificates/:id/targets", sslHandler.CreateDeployTarget)
		protected.PUT("/ssl/targets/:id", sslHandler.UpdateDeployTarget)
		protected.DELETE("/ssl/targets/:id", sslHandler.DeleteDeployTarget)
		protected.POST("/ssl/targets/:id/deploy", sslHandler.DeployTarget)

		// Web Push (PWA) — any authenticated user
		protected.POST("/push/subscribe", pushHandler.Subscribe)
		protected.POST("/push/unsubscribe", pushHandler.Unsubscribe)
		protected.POST("/push/test", pushHandler.SendTest)

		// Admin-only endpoints
		admin := protected.Group("")
		admin.Use(middleware.AdminOnly())
		{
			// User management
			admin.GET("/users", usersHandler.ListUsers)
			admin.GET("/users/:id", usersHandler.GetUser)
			admin.POST("/users", usersHandler.CreateUser)
			admin.PUT("/users/:id", usersHandler.UpdateUser)
			admin.DELETE("/users/:id", usersHandler.DeleteUser)
			admin.PUT("/users/:id/permissions", usersHandler.SetPermissions)

			// System settings
			admin.GET("/settings", settingsHandler.GetSettings)
			admin.POST("/settings", settingsHandler.UpdateSetting)
			admin.POST("/settings/logo", settingsHandler.UploadLogo)
			admin.POST("/settings/vapid/generate", settingsHandler.GenerateVAPIDKeys)
			admin.POST("/admin/change-user-password", authHandler.AdminChangePassword)

			// DNS Platforms (contain API credentials)
			admin.GET("/platforms", dnsHandler.ListPlatforms)
			admin.POST("/platforms", dnsHandler.CreatePlatform)
			admin.PUT("/platforms/:id", dnsHandler.UpdatePlatform)
			admin.DELETE("/platforms/:id", dnsHandler.DeletePlatform)
			admin.POST("/platforms/:id/sync", dnsHandler.SyncDomains)
				admin.POST("/platforms/sync-all", dnsHandler.SyncAllDomains)
				admin.DELETE("/domains/:id", dnsHandler.DeleteDomain)
			admin.POST("/domains/:id/sync-records", dnsHandler.SyncRecords)

			// Notification Channels (contain secrets, can send arbitrary notifications)
			admin.GET("/notifications/channels", notifyHandler.ListChannels)
			admin.POST("/notifications/channels", notifyHandler.CreateChannel)
			admin.PUT("/notifications/channels/:id", notifyHandler.UpdateChannel)
			admin.DELETE("/notifications/channels/:id", notifyHandler.DeleteChannel)
			admin.POST("/notifications/channels/:id/test", notifyHandler.TestChannel)
			admin.GET("/notifications/logs", notifyHandler.ListLogs)

			// Push subscriptions management
			admin.GET("/push/subscriptions", pushHandler.ListSubscriptions)

			// SSL certificate/key download (sensitive)
			admin.GET("/ssl/certificates/:id/download", sslHandler.DownloadCertificate)
			admin.GET("/ssl/certificates/:id/download-key", sslHandler.DownloadPrivateKey)
		}
	}

	// Serve frontend SPA: static files with fallback to index.html.
	if _, err := os.Stat(cfg.FrontendDir); err == nil {
		r.Use(func(c *gin.Context) {
			p := c.Request.URL.Path
			if strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/uploads/") {
				c.Next()
				return
			}
			fp := filepath.Join(cfg.FrontendDir, p)
			if info, err := os.Stat(fp); err == nil && !info.IsDir() {
				c.File(fp)
				c.Abort()
				return
			}
			// SPA fallback: any non-file route returns index.html (except API).
			idx := filepath.Join(cfg.FrontendDir, "index.html")
			c.File(idx)
			c.Abort()
		})
		log.Printf("前端静态文件服务已启用: %s", cfg.FrontendDir)
	}

	log.Printf("KSM For DNS 后端启动在端口 %s", cfg.Port)
	if cfg.TLSCert != "" && cfg.TLSKey != "" {
		log.Printf("已启用 TLS 加密")
		log.Fatal(r.RunTLS(":"+cfg.Port, cfg.TLSCert, cfg.TLSKey))
	} else {
		log.Fatal(r.Run(":" + cfg.Port))
	}
}

func initDefaultUser(db *gorm.DB) {
	var count int64
	db.Model(&models.User{}).Count(&count)
	if count == 0 {
		username := os.Getenv("KSM_ADMIN_USER")
		password := os.Getenv("KSM_ADMIN_PASSWORD")
		if username == "" {
			username = "ksm"
		}
		if password == "" {
			password = "ksm2026"
		}
		log.Printf("==============================================")
		log.Printf("  默认管理员账号: %s", username)
		log.Printf("  默认管理员密码: %s", password)
		log.Printf("  请立即登录并修改密码!")
		log.Printf("==============================================")
		hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			log.Fatal("生成默认管理员密码失败:", err)
		}
		db.Create(&models.User{
			Username:           username,
			Password:           string(hashed),
			Role:               "admin",
			MustChangePassword: true,
		})
		return
	}
	// Backfill any pre-existing users (from before roles were introduced) as admins.
	db.Model(&models.User{}).Where("role = ''").Update("role", "admin")
}


func initDefaultSettings(db *gorm.DB) {
	defaults := map[string]string{
		"site_name": "KSM For DNS",
		"logo_url":  "",
	}
	for k, v := range defaults {
		db.Where("key = ?", k).FirstOrCreate(&models.Setting{Key: k, Value: v})
	}

	// Lazily generate a VAPID key pair on first boot so Web Push works out of
	// the box. Admins can regenerate it later in System Settings.
	var count int64
	db.Model(&models.Setting{}).Where("key = ?", "vapid_public_key").Count(&count)
	if count == 0 {
		if privateKey, publicKey, err := webpush.GenerateVAPIDKeys(); err == nil {
			db.Create(&models.Setting{Key: "vapid_private_key", Value: privateKey})
			db.Create(&models.Setting{Key: "vapid_public_key", Value: publicKey})
		}
	}
}
