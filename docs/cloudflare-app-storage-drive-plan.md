# Plan: Bring `/app/storage` & `/app/drive` to Cloudflare (with dynamic upload routing)

> Status: PLANNED — not yet implemented. Captured for a future work session.

## Context

On the **Cloudflare Pages** deployment (the primary one), the Vue pages `/app/storage` and `/app/drive` render but have **no backend**: `functions/` has no `/api/storage`, `/api/drive`, or `/api/share/sign`. Those endpoints only exist in the Docker `server/` (Node/Hono + SQLite). This is unfinished upstream work from the original author (katelya). Result: dead UI on Cloudflare.

Goal: implement those APIs as Pages Functions, and (FULL scope) make uploads/downloads **dynamically routed** by the storage profile selected in the UI — not just env/wrangler vars.

Key feasibility findings:
- All **storage adapters already exist** on the CF side: `functions/utils/{telegram,s3client,webdav,discord,github,huggingface,storage}.js`.
- The **KV file/folder model already exists**: `functions/api/manage/list.js` has `buildFolderNodes`/`normalizeKey`/`listAllKeys`/`computeStats`; folders are `folder:<path>` KV keys or `metadata.folderMarker`.
- So **no D1 is needed** — KV (`img_url`) + R2 (`R2_BUCKET`) + Web Crypto suffice.
- Frontend transport (`frontend/src/api/client.js`): sends cookies + `X-Seraph-Client: app-v2`; on `{success:true,data}` it returns `data` (unwrapped); throws on `success:false` or non-2xx. **All new endpoints must return `{ "success": true, "data": {...} }`.**
- `/api/settings` is **not** called by the frontend — out of scope.

## Architecture decisions

- **KV-only.** Storage profiles live under a single KV key `storage_configs` (JSON array); each profile's `config` (secrets) is encrypted with **AES-GCM via `crypto.subtle`**, key = `SHA-256(env.CONFIG_ENCRYPTION_KEY || env.SESSION_SECRET)`. Mirrors Docker `server/lib/utils/crypto.js` so the two stores are independent but compatible in shape.
- **Reuse adapters unchanged** by feeding them an **env-overlay** built from a decrypted profile (`{...env, S3_ENDPOINT: cfg.endpoint, ...}`). No adapter rewrites.
- **Drive reuses the existing KV model** — extract the shared helpers from `functions/api/manage/list.js` into a util so both `manage` and `drive` use one source of truth.
- **Share-sign reuses the existing CF metadata-share** model in `functions/file/[id].js` (`verifyShareAccess` already enforces `shareExpiresAt`), rather than porting Docker's HMAC URL scheme.

## Phase A — Shared foundations (new utils)

- `functions/utils/storage-config.js` (NEW): KV-backed profile repo. `listProfiles(env,{includeSecrets})`, `getProfile(env,id,{includeSecrets})`, `createProfile`, `updateProfile` (drop incoming `'********'` to preserve stored secrets), `deleteProfile`, `setDefault`, `ensureBootstrap(env)` (seed from env, mirror Docker `ensureBootstrapStorage`). Profile shape `{id:"sc_"+16hex, name, type, enabled, isDefault, metadata, createdAt, updatedAt, config}`; `id` via `crypto.getRandomValues`. AES-GCM encrypt/decrypt + `maskSecrets(type,config)` (secret fields per type: telegram=`botToken`; r2/s3=`accessKeyId,secretAccessKey`; discord=`botToken,webhookUrl`; huggingface=`token`; webdav=`password,bearerToken,token`; github=`token`). Reuse the KV-binding resolver pattern from `functions/api/ui-config.js`.
- `functions/utils/storage-dispatch.js` (NEW): `profileToEnvOverlay(env, profile)` → maps profile.config → the env var names each adapter expects; `testConnection(env, profile)` per type (telegram getMe, s3 `S3Client.checkConnection`, discord `checkDiscordConnection`, webdav PROPFIND/`hasWebDAVConfig`, etc.) → `{connected, status?, detail?}`.
- `functions/utils/kv-files.js` (NEW): move/share `listAllKeys`, `shouldIncludeKey`, `normalizeKey`, `normalizeFolderPath`, `buildFolderNodes`, `computeStats` out of `functions/api/manage/list.js` (then have `list.js` import them — no behavior change).
- `functions/utils/delete-file.js` (NEW): extract the per-type adapter delete dispatch from `functions/api/manage/delete/[id].js:42-194` so Drive batch-delete reuses it.

## Phase B — Storage config API (`/api/storage/*`)

Pages-Functions files (each returns the v2 envelope). Auth via a copied middleware.
- `functions/api/storage/_middleware.js` — copy of `functions/api/admin/_middleware.js`.
- `functions/api/storage/list.js` GET → `{success,data:{items}}` (masked).
- `functions/api/storage/index.js` POST create → `{data:{item}}`.
- `functions/api/storage/[id].js` PUT update / DELETE.
- `functions/api/storage/test.js` POST `{type,config}` → `{data:{result}}` (static route wins over `[id]`).
- `functions/api/storage/[id]/test.js` POST → test stored profile.
- `functions/api/storage/default/[id].js` POST setDefault.
- `functions/api/storage/bootstrap/sync.js` POST → `ensureBootstrap`.

## Phase C — Drive API (`/api/drive/*`)

- `functions/api/drive/_middleware.js` — copy admin middleware.
- `functions/api/drive/tree.js` GET `?storage=` → `{data:{nodes}}` via `buildFolderNodes`.
- `functions/api/drive/explorer.js` GET `?path=&storage=&search=&listType=&limit=&cursor=&includeStats=1` → `{data:{folders,breadcrumbs,files,cursor,list_complete}}` (offset pagination as in `list.js`; breadcrumbs from the path parts).
- `functions/api/drive/folders.js` POST `{path}` (create `folder:<path>` marker, reuse `functions/api/manage/folders.js`); DELETE `?path=&recursive=1` (refuse non-empty unless `recursive`, returning an error message containing "not empty").
- `functions/api/drive/folders/move.js` POST `{sourcePath,targetPath}` (rewrite folder marker + children `metadata.folderPath`).
- `functions/api/drive/files/move.js` POST `{ids,targetFolderPath}` (reuse `functions/api/manage/files/move-folder.js`).
- `functions/api/drive/files/rename.js` POST `{id,fileName}` (update `metadata.fileName`, re-put KV).
- `functions/api/drive/files/delete-batch.js` POST `{ids}` (loop `functions/utils/delete-file.js`).

## Phase D — Share sign (`/api/share/sign`)

- `functions/api/share/sign.js` POST `{fileId, ttlSeconds}` → set `metadata.shareExpiresAt = Date.now()+ttl*1000` (clamp 60s–365d, default 7d) on the file's KV record, return `{success,data:{shareUrl:"/file/<id>", expiresAt, permission:"public-read-signed"}}`. Reuses the existing expiry enforcement in `functions/file/[id].js` `verifyShareAccess` — no new verify route needed.

## Phase E — Dynamic upload + download routing (invasive)

Today `functions/upload.js` picks a backend from the per-request `storageMode` form field and reads creds from `env.*`. Change to resolve a **profile**:
- **Upload** (`functions/upload.js`, `functions/api/chunked-upload/complete.js`, `functions/api/upload-from-url.js`): resolve the profile by `storageId` form field, else the **default** profile; build env-overlay via `storage-dispatch.js`; pass the overlay to the existing per-type upload branches; persist `metadata.storageProfileId` on the KV record. Admin default backend becomes the default profile's type (not hardcoded `telegram`). Guest uploads stay forced to the guest Telegram channel (unchanged).
- **Download** (`functions/file/[id].js`): when `metadata.storageProfileId` is present, load+decrypt that profile and build the env-overlay before calling the per-type handler (so files stored under a dynamic profile can be fetched).
- **R2 caveat:** R2 uses the static `env.R2_BUCKET` binding (can't be per-profile). Treat the single bound bucket as the only R2 target; route any *additional* object-store profiles through the **S3-compatible** path (R2 supports the S3 API) using `s3client.js` with the profile's endpoint/keys. Document this.

## Critical files

- **New:** `functions/utils/{storage-config,storage-dispatch,kv-files,delete-file}.js`; `functions/api/storage/*` (8 files); `functions/api/drive/*` (8 files); `functions/api/share/sign.js`.
- **Modified:** `functions/upload.js`, `functions/api/chunked-upload/complete.js`, `functions/api/upload-from-url.js`, `functions/file/[id].js`; `functions/api/manage/list.js` (+ `folders.js`, `files/move-folder.js`, `delete/[id].js`) to import the extracted helpers.
- **Reuse (do not rewrite):** `functions/utils/{auth,telegram,s3client,webdav,discord,github,huggingface,storage}.js`; `functions/api/admin/_middleware.js` (template); `functions/api/ui-config.js` (KV JSON pattern).
- **Config:** no new `wrangler.jsonc` bindings; ensure `CONFIG_ENCRYPTION_KEY` (and `SESSION_SECRET`) are set as Pages **secrets** (needed for config encryption).

## Verification

- **Local:** `npm start` (wrangler pages dev with KV + R2). For backend connectivity, configure at least one real profile (e.g. an S3/WebDAV test target) since adapters need real creds.
- **Unit/contract (mocha, mirror `test/*.js`):** AES-GCM encrypt→decrypt→mask round-trip for `storage-config`; `drive/explorer` + `tree` response-shape tests over seeded KV metadata; envelope shape (`{success,data}`).
- **E2E (Playwright against `npm start`):** log in → `/app/storage`: add profile, "test connection", set default, edit (secret preserved), delete. `/app/drive`: create folder, upload into it, move/rename/batch-delete, verify tree+explorer+breadcrumbs+pagination. Sign a share link and open it (expiry enforced). Upload with a non-default profile selected and confirm the file is stored on and served from that backend.
- **Regression:** legacy `/upload` (admin + guest) still works; existing `/api/manage/*` unaffected by the helper extraction; `git grep` for old imports after moving helpers.

## Risks / notes

- Phase E is the riskiest (touches the upload+download core). Recommend implementing **A→D first** (UI becomes functional), then E behind careful testing.
- KV is eventually consistent — folder/file ops may briefly lag (same as existing `manage`).
- R2 dynamic-routing caveat above.
- Effort: substantial, multi-session. Sequence the phases; verify each before the next.
