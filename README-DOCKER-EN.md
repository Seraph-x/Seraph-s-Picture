# Seraph's Pictures Docker Runtime Guide

The Docker runtime self-hosts Seraph's Pictures with a Node/Hono backend, static frontend pages, and local data storage. It is suitable for a VPS, NAS, or local development.

## Docker vs Cloudflare Pages

- Cloudflare Pages: current production-oriented deployment. The root legacy pages are the stable main flow.
- Docker runtime: includes the newer backend APIs used by Vue `/app/storage`, `/app/drive`, and `/app` upload flows.

## Start

```bash
npm run docker:init-env
docker compose up -d --build
```

Open:

```txt
http://localhost:8080/
http://localhost:8080/admin.html
http://localhost:8080/webdav.html
```

## Common Environment Variables

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

## Pages

```txt
/              upload home
/login.html    login
/admin.html    admin console
/gallery.html  image gallery
/webdav.html   WebDAV upload center
/app/status    Vue status page
/app/storage   Vue storage config
/app/drive     Vue Drive console
```

## Storage Recommendation

WebDAV is the recommended aggregation entry:

1. Deploy alist/openlist on the same host or another trusted node.
2. Configure a WebDAV backend in Seraph's Pictures.
3. Let alist/openlist aggregate upstream storage providers while Seraph's Pictures handles upload UX, direct links, auth, and administration.

## Verification

```bash
node scripts/docker-storage-doctor.js
node scripts/docker-ci-smoke.js
```

## Notes

- Docker static frontend no longer copies retired `admin-imgtc.html`, `admin-waterfall.html`, or `_nuxt/`.
- The root legacy pages remain the stable operation path.
- Vue `/app` pages are available for gradual migration and validation.
