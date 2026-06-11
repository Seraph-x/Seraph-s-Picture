<div align="center">
  <img src="logo.png" alt="Seraph's Pictures Logo" width="140">

# Seraph's Pictures

A private media workspace for Cloudflare Pages: file hosting, legacy-first upload UI, admin management, WebDAV upload, and multiple storage backends.

</div>

## Current Product Shape

Seraph's Pictures currently uses the legacy root UI as the default production surface:

- `/` — main upload page
- `/login.html` — login page
- `/admin.html` — primary admin console
- `/gallery.html` — image gallery
- `/webdav.html` — WebDAV upload center
- `/app/status` — Vue status page

The Vue app is kept under `/app/` for the newer experience. On Cloudflare Pages, the root legacy pages are the reliable main flow. `/app/storage` and `/app/drive` already have UI screens, but their Cloudflare Functions endpoints still need to be completed before they should replace the legacy console.

## Features

- Upload images, videos, audio, documents, and generic files
- Storage adapters for Telegram, R2, S3-compatible services, Discord, Hugging Face, GitHub, and WebDAV
- Admin console for listing, folders, detailed view, rename, delete, likes, allow/block lists, and API tokens
- Standalone WebDAV upload center
- Gallery view
- Basic Auth plus cookie-based sessions
- URL upload validation that blocks private/internal network targets
- Claude-inspired Seraph's Pictures theme with dark mode

## Frontend Map

```txt
Root legacy UI
├── index.html          # default upload page
├── login.html          # login
├── admin.html          # primary admin console
├── gallery.html        # image gallery
├── webdav.html         # WebDAV upload center
├── preview.html        # compatibility preview page
├── block-img.html      # blocked-file notice
└── whitelist-on.html   # allow-list notice

Optional Vue app
└── /app/
    ├── /app/           # Vue upload page
    ├── /app/login      # Vue login
    ├── /app/drive      # Vue Drive; Cloudflare API is incomplete
    ├── /app/storage    # Vue storage config; Cloudflare API is incomplete
    └── /app/status     # Vue status page
```

`frontend/scripts/copy-legacy.mjs` builds the Vue app into `frontend/dist/app/`, copies legacy pages into `frontend/dist/`, writes a compatibility copy under `frontend/dist/legacy/`, and adds `/app` SPA rewrites.

## Navigation

Default entry:

```txt
/ -> index.html
```

Root navigation:

```txt
/              -> upload home
/gallery.html  -> image gallery
/admin.html    -> admin console
/webdav.html   -> WebDAV upload
/app/storage   -> Vue storage config UI
```

Authentication flow:

```txt
Unauthenticated protected page -> /login.html?redirect=<original path>
Successful login               -> redirect target
Logout                         -> /login.html
```

Vue shell navigation:

```txt
/app/         -> Upload
/app/drive    -> Drive
/app/storage  -> Storage
/app/status   -> Status
/             -> Legacy
```

## Cloudflare Pages Deployment

```bash
npm install
npm --prefix frontend install
npm --prefix frontend run build
npx wrangler pages deploy frontend/dist --project-name <your-pages-project>
```

Use the actual project name from the Cloudflare Pages dashboard. The product-facing brand is Seraph's Pictures.

Common bindings and variables:

```txt
BASIC_USER
BASIC_PASS
TG_BOT_TOKEN
TG_CHAT_ID
img_url
R2_BUCKET
S3_*
WEBDAV_*
DISCORD_*
HUGGINGFACE_*
GITHUB_*
```

## Docker Runtime

The Docker backend includes the newer `/api/storage/*`, `/api/drive/*`, and `/api/share/*` APIs used by parts of the Vue app.

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

## Verification

```bash
perl -e 'alarm shift; exec @ARGV' 60 ./node_modules/.bin/mocha \
  test/claude-theme.test.js \
  test/claude-layout.test.js \
  test/frontend-entrypoint.test.js \
  test/security-regression.test.js \
  --timeout 60000

npm --prefix frontend run build
```

## Notes

- Root legacy pages are the current production path.
- `/app/status` is usable as a status view.
- `/app/storage` and `/app/drive` need Cloudflare Function endpoints before they become production replacements.
- `preview.html`, `block-img.html`, and `whitelist-on.html` remain as compatibility/notice pages.
- Retired `admin-imgtc.html`, `admin-waterfall.html`, and `_nuxt/` have been removed.
