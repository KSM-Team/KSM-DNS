<p align="center">
  <img src="https://img.shields.io/github/stars/KSM-Team/KSM-DNS?style=for-the-badge&color=fbbf24" alt="Stars" />
  <img src="https://img.shields.io/badge/Docker%20Compose-Deploy-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
</p>

<h1 align="center">KSM-DNS</h1>

<p align="center">智能 DNS 与 SSL 证书管理平台</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/Go-1.25-00ADD8?logo=go" alt="Go" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite" alt="Vite" />
</p>

<p align="center">
  <a href="cn_readme.md">中文</a> · <a href="us_readme.md">English</a>
</p>

---

> ⚠️ **重要提示**  
> 本项目部分代码由 AI 辅助生成，目前处于实验性阶段，**请勿部署至生产环境**。开发团队对使用本项目所产生的任何直接或间接后果不承担法律责任。

---

## 📸 项目截图

<p align="center">
  <img src="user.png" alt="KSM-DNS Dashboard" width="100%" />
</p>

---

## ✨ 功能特性

- **多平台 DNS 管理** — 支持 Cloudflare、阿里云 DNS、腾讯云 DNSPod、Namesilo、Spaceship
- **DNS 记录管理** — 增删改查 A/AAAA/CNAME/MX/TXT/NS/SRV/CAA 记录，支持批量同步
- **智能故障转移** — 健康检查（TCP/HTTP/HTTPS/Ping）+ 自动切换备份记录
- **定时任务调度** — Cron 表达式定时修改/启用/暂停 DNS 记录
- **SSL 证书管理** — 基于 ACME 协议自动申请/续期 Let's Encrypt 证书
- **证书部署** — SSH 远程部署证书到服务器并自动 reload 服务
- **多用户权限** — 管理员 + 子用户，按域名粒度控制读写权限
- **通知渠道** — 邮件 / Telegram / Web Push 通知
- **PWA 支持** — 可安装到桌面，支持 Web Push 推送
- **安全加固** — AES-256-GCM 加密存储、SSH TOFU 验证、登录速率限制、账户锁定、密码复杂度策略

---

## 🚀 快速开始

### Docker Compose 部署（推荐）

```bash
# 克隆项目
git clone https://github.com/KSM-Team/KSM-DNS.git
cd KSM-DNS

# 一键启动
docker compose up -d

# 访问 http://localhost:8910
# 默认账号: ksm  密码: ksm2026
```

### 自定义管理员账号

```bash
KSM_ADMIN_USER=myadmin KSM_ADMIN_PASSWORD=MyPass123! docker compose up -d
```

### 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `KSM_ADMIN_USER` | 初始管理员账号 | `ksm` |
| `KSM_ADMIN_PASSWORD` | 初始管理员密码 | `ksm2026` |
| `KSM_JWT_SECRET` | JWT 签名密钥 | 自动生成 |
| `KSM_PORT` | 后端端口 | `8910` |
| `KSM_DATA_DIR` | 数据持久化目录 | `/app/data` |
| `KSM_TLS_CERT` | TLS 证书路径（可选） | — |
| `KSM_TLS_KEY` | TLS 私钥路径（可选） | — |

### 数据持久化

Docker 卷 `ksm-data` 挂载到 `/app/data`，包含：
- `ksm.db` — SQLite 数据库
- `encryption_key` — AES-256 加密密钥
- `jwt_secret` — JWT 签名密钥
- `uploads/` — 上传文件

---

## 🛠️ 本地开发

### 环境要求

- Go 1.25+
- Node.js 20+
- Docker（可选）

### 后端

```bash
cd backend
go mod download
go run .
# 后端启动在 :8910
```

### 前端

```bash
cd frontend
npm install
npm run dev
# 前端启动在 :5173，自动代理 API 到 :8910
```

---

## 📁 项目结构

```
KSM-DNS/
├── backend/
│   ├── config/          # 配置加载
│   ├── handlers/        # HTTP 处理器
│   ├── middleware/       # 中间件（JWT/CORS/安全头/速率限制/密码强制修改）
│   ├── models/          # 数据模型 + GORM 加密钩子
│   ├── services/
│   │   ├── crypto/      # AES-256-GCM 加密
│   │   ├── deploy/      # SSH 证书部署
│   │   ├── dns/         # DNS 提供商适配器
│   │   ├── monitor/     # 健康检查 + 故障转移
│   │   ├── notify/      # 通知服务（邮件/Telegram/WebPush）
│   │   ├── scheduler/   # 定时任务调度
│   │   └── ssl/         # ACME 证书管理
│   └── main.go
├── frontend/
│   ├── src/
│   │   ├── api/         # Axios 封装
│   │   ├── components/  # 通用组件
│   │   ├── pages/       # 页面组件
│   │   └── store/       # Zustand 状态管理
│   └── vite.config.ts
├── Dockerfile
├── docker-compose.yml
├── cn_readme.md
└── us_readme.md
```

---

## 📄 许可证

[Apache-2.0](LICENSE)

---

<p align="center">
  <a href="https://github.com/KSM-Team/KSM-DNS">github.com/KSM-Team/KSM-DNS</a>
</p>