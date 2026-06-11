# Seraph's Pictures Docker 运行指南

Docker runtime 用于自托管 Seraph's Pictures。它提供 Node/Hono 后端、静态前端和本地数据目录，适合 VPS、NAS 或本地调试。

## Docker 版和 Cloudflare 版的区别

- Cloudflare Pages：当前线上主流程，根路径 Legacy 页面最稳定。
- Docker runtime：包含更完整的新版后端接口，支持 Vue `/app/storage`、`/app/drive` 依赖的 `/api/storage/*`、`/api/drive/*`、`/api/share/*`。

## 启动

```bash
npm run docker:init-env
docker compose up -d --build
```

默认访问：

```txt
http://localhost:8080/
http://localhost:8080/admin.html
http://localhost:8080/webdav.html
```

## 常用环境变量

```txt
BASIC_USER
BASIC_PASS
TG_BOT_TOKEN
TG_CHAT_ID
DATA_DIR
DB_PATH
S3_*
WEBDAV_*
DISCORD_*
HUGGINGFACE_*
GITHUB_*
```

## 页面结构

```txt
/              上传首页
/login.html    登录页
/admin.html    管理后台
/gallery.html  图片浏览
/webdav.html   WebDAV 上传中心
/app/status    Vue 状态页
/app/storage   Vue 存储配置
/app/drive     Vue Drive 管理
```

## 存储建议

推荐把 WebDAV 作为聚合入口：

1. 在同机或独立节点部署 alist/openlist。
2. 在 Seraph's Pictures 中配置 WebDAV 后端。
3. 由 alist/openlist 聚合多个上游存储，Seraph's Pictures 负责上传体验、直链、认证和后台管理。

## 验证

```bash
node scripts/docker-storage-doctor.js
node scripts/docker-ci-smoke.js
```

## 注意事项

- Docker 静态前端不再复制旧 `admin-imgtc.html`、`admin-waterfall.html` 和 `_nuxt/`。
- 根路径 Legacy 页面仍然是最稳定的操作入口。
- Vue `/app` 页面适合逐步迁移和验证新版功能。
