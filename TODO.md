# TODO

Backlog from the 2026-06-13 code review. CRITICAL/HIGH items were fixed in
`f46084a` (fix: harden auth and file serving from security review).
Remaining MEDIUM items below, roughly in recommended order.

## 1. Parallelize KV prefix probing in file route ([#1](https://github.com/Seraph-x/Seraph-s-Picture/issues/1))

`functions/file/[id].js` — `getRecordWithKey` probes up to 11
`STORAGE_PREFIXES` with sequential KV reads per unprefixed file request.

- Parallelize with `Promise.all` (first metadata hit wins, prefer prefix order)
- Or encode the storage type in newly generated file IDs

Effort: small. Pure latency win, low risk.

## 2. Fix KV counter races (guest limit / share downloads) ([#2](https://github.com/Seraph-x/Seraph-s-Picture/issues/2))

`functions/utils/guest.js` (guest daily limit) and `functions/file/[id].js`
(share download count) use read-modify-write on KV, which is eventually
consistent — concurrent requests can bypass limits.

- Bug: `incrementGuestCount` resets `expirationTtl: 86400` on every write,
  extending the 24h window indefinitely. Fix by storing the window start
  timestamp instead of relying on TTL renewal.
- The race itself: either document the limits as best-effort, or move
  counters to Durable Objects / D1 for real atomicity.

Effort: small (TTL fix) to medium (atomic counters).

## 3. Move share password from query string to header ([#3](https://github.com/Seraph-x/Seraph-s-Picture/issues/3))

`functions/file/[id].js` — `verifyShareAccess` reads `?password=` from the
query string, which leaks into access logs, browser history, and Referer
headers.

- Accept a header (e.g. `X-File-Password`) as the preferred channel
- Keep the query param for backward compatibility or deprecate it
- Update the frontend share-access UI accordingly

Effort: medium (touches frontend).

## 4. Split server/app.js into route modules ([#4](https://github.com/Seraph-x/Seraph-s-Picture/issues/4))

`server/app.js` is ~2,085 lines, far over the 800-line project limit.

- Extract route modules: auth, upload, share/file-serving, telegram webhook,
  admin/manage
- Keep `createApp` as the composition root
- Run the full mocha suite after each extraction

Effort: medium, mechanical refactor.

## 5. Consolidate legacy HTML pages vs Vue SPA ([#5](https://github.com/Seraph-x/Seraph-s-Picture/issues/5))

Legacy pages (`index.html` 5,301 lines, `admin.html` 5,030 lines,
`gallery.html`, `login.html`, `webdav.html`, `theme.js`, `i18n.js`) duplicate
the Vue SPA under `frontend/src`. Every UI change requires dual maintenance —
the recent transparency work had to touch both stacks.

- Decide which stack is canonical
- Determine whether legacy pages can be frozen or deleted
- Plan redirects / deploy changes (`frontend/scripts/copy-legacy.mjs`,
  Cloudflare Pages routing)

Effort: large. Architectural decision — plan before executing.

## Other notes from the review (LOW)

- ~25 screenshot PNGs (`admin-*.png`, `demo-*.png`, ...) committed at repo
  root — repo hygiene
- `functions/upload.js` and `functions/file/[id].js` lack direct unit tests
