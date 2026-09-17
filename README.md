# Tresorpost - https://tresorpost.ch

End-to-end encrypted, quantum-safe link sharing for text, images and files.

I built this because I kept running into the same annoyance. I needed to
send a password or a file to family or a friend, and the usual options were
all bad. Make them create an account somewhere. Or send it over a channel
where it just sits forever afterward, and I have no real idea who still has
a copy of it. I wanted the opposite of that. Paste it in, get a link, send
the link, and once someone opens it, the copy is gone.

_Tresorpost_ is German for "vault mail". Create a link, share it, whoever
opens it decrypts it in their own browser. The key never reaches the server,
so the server only ever stores ciphertext it can't read.

The project is open-core. The whole application, cryptography included, is
public so it can be audited, not just trusted. Visual branding (logos, fonts)
sits in a swappable theme layer, see [docs/BRANDING.md](docs/BRANDING.md).

## How this got built

The first version came together fast, with a lot of help from a few
different LLMs. I'm not hiding that. I read through what got written, I
understand it, and I'm the one who maintains it. Using AI to move faster
doesn't change whose project this is.

## Highlights

- Encryption and decryption happen entirely in the browser. The 256-bit key
  is generated client-side and placed in the URL fragment (`#…`), which
  browsers never send to the server.
- Cipher is XChaCha20-Poly1305 with a 256-bit key. Grover's algorithm only
  halves the effective key strength against a quantum attacker, leaving about
  128 bits of security, which is why a 256-bit symmetric key still counts as
  quantum-safe.
- Four content types from a dropdown: text (ProseMirror rich text, no
  attachments), image, video (plays in-browser when the codec allows,
  otherwise downloads), and file.
- Self-destruct timer. 1, 5, 15, 30 minutes, 1, 3, 6, 12 hours, 1, 3, 7 days,
  or 1 month. The view page shows remaining opens and expiry.
- Optional open limit, burns the secret after N opens.
- Creator delete link (optional). A private `#/d/<id>/<token>` URL to destroy
  a note before anyone opens it. The server only stores a SHA-256 hash of the
  token, never the token itself.
- Recipient delete (optional). Embeds a destroy token in the share URL
  (`#/v/<id>/<key>/<token>`) so the recipient can wipe the ciphertext after
  opening.
- Short share links with a QR code. Compact `#/v/<id>/<key>` links (12-char
  IDs) with a scannable QR on the result screen. Legacy `#/s/…` links still
  open.
- Light/dark theme, syntax highlighting, copy-all and per-code-block copy on
  decrypted text.
- Admin dashboard at `/admin`, token-protected. Creations chart, active
  links, purge expired.
- Per-IP rate limits on create (default 60/hour, `CREATE_RATE_LIMIT` /
  `CREATE_RATE_WINDOW_SECS`, applies to `POST /api/secrets` and
  `POST /api/uploads/init`) and on read/delete (default 300/hour,
  `READ_RATE_LIMIT` / `READ_RATE_WINDOW_SECS` on `GET`/`DELETE
  /api/secrets/{id}`). Both return `429` when exceeded.
- Admin auth failure limit (default 10 failed tokens/IP/hour,
  `ADMIN_AUTH_MAX_FAILURES` / `ADMIN_AUTH_WINDOW_SECS`). Only mismatches
  count.
- HTTP security headers on every response. CSP, nosniff, no-referrer, DENY
  framing, Permissions-Policy, HSTS. CSP `connect-src` includes `S3_ENDPOINT`
  when S3 is configured.
- Durable links backed by SQLite, with an optional S3 path for large files
  (up to ~5 GB).

## Architecture

| Layer      | Stack                                                            |
| ---------- | --------------------------------------------------------------- |
| Backend    | Rust · [Axum](https://github.com/tokio-rs/axum) · SQLite (sqlx) |
| Frontend   | Vite · React · TypeScript · ProseMirror · @noble/ciphers        |
| Crypto     | XChaCha20-Poly1305 (256-bit, quantum-safe), key in URL fragment |

The server exposes a small API and, in production, serves the built SPA:

- `POST /api/secrets`: store `{ ciphertext, nonce, expires_in, max_views, kind, allow_delete, allow_recipient_delete }`, returns `{ id, delete_token?, recipient_delete_token? }`. `429` if the per-IP create limit is exceeded. `507` if the SQLite file would exceed `MAX_SQLITE_MB`.
- `GET  /api/secrets/{id}`: atomically consumes one view, returns ciphertext (SQLite) or a presigned download URL (S3), or `404` when expired/exhausted. `429` if the per-IP read limit is exceeded.
- `DELETE /api/secrets/{id}`: destroy with `{ delete_token }` (creator or recipient token). Same `404` for unknown id or wrong token. `503` if the S3 object could not be deleted (the row is kept so a retry can finish). `429` if the per-IP read limit is exceeded.
- `GET  /api/config`: `{ max_file_bytes, s3_enabled, max_s3_file_bytes, email_enabled, report_enabled }`.
- `POST /api/share-email`: `{ to, url, expires_in, max_views }` sends the share link over SMTP. `429` if the per-IP email limit is exceeded. `503` if SMTP is not configured.
- `POST /api/report`: `{ view_url, message?, kind }` emails the view (and recipient-delete) link to `ADMIN_REPORT_URL`. Same email rate limit. `503` if SMTP or `ADMIN_REPORT_URL` is missing.
- `GET  /api/health`: liveness.
- `POST /api/uploads/init`: begin an S3 multipart upload (large files). `429` if the create rate limit is exceeded. `507` if `MAX_S3_GB` (or the SQLite cap) would be exceeded.
- `POST /api/uploads/{id}/part-url`: presigned PUT URL for one encrypted chunk.
- `POST /api/uploads/{id}/complete`: finish the multipart upload.
- `GET  /api/admin/stats` · `GET /api/admin/active` · `POST /api/admin/purge`: admin (requires `ADMIN_TOKEN`).

Ciphertext, nonce, filename, MIME type and content kind are all inside the
encrypted blob. For the default SQLite path the database only stores the
ciphertext, a nonce, timestamps, coarse kind metadata for stats, and the view
counter. When S3 is enabled, large-file ciphertext lives in the object store
and the database keeps only orchestration metadata.

## Large files (S3-backed, up to ~5 GB)

When the `S3_*` environment variables are set, file and video uploads stream
directly from the browser to S3 via presigned multipart URLs. The server
never handles the bytes. Encryption stays end-to-end, S3 only stores
ciphertext chunks sealed with XChaCha20-Poly1305 (chunk index and final flag
in AAD).

A random 256-bit key (URL fragment only) and a random 20-byte base nonce are
generated per file. The file is sliced into fixed 8 MiB plaintext chunks and
each chunk is sealed independently. Uploads and downloads never buffer the
whole file. Downloads stream to disk via the File System Access API, with a
size-capped in-memory Blob fallback.

Objects are deleted on expiry, burn (after the presigned-URL grace window),
explicit delete, and by an orphan reaper that lists `tresorpost/` keys not
referenced by SQLite. The sweeper won't drop a SQLite row until the S3 object
or multipart upload is gone, then checkpoints the WAL and runs incremental
vacuum so the database file can shrink.

Abandoned multipart uploads are reaped after `PENDING_UPLOAD_TTL_SECS`
(default 6 hours), not the secret's full TTL (up to 31 days). Last-view S3
burns set `purge_after = now + S3_URL_TTL_SECS` on the row instead of a
fire-and-forget task, so a restart still deletes the object.

### Bucket CORS (required for browser → S3)

Direct browser uploads/downloads require the bucket to allow the app origin
and to expose the `ETag` header. Example CORS:

```json
[
  {
    "AllowedOrigins": ["https://your-app.example"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

| Provider | `S3_ENDPOINT` | `S3_FORCE_PATH_STYLE` |
| -------- | ------------- | --------------------- |
| MinIO (local) | `http://localhost:9000` | `true` |
| AWS S3 | *(AWS default)* | `false` |
| Cloudflare R2 | `https://<account>.r2.cloudflarestorage.com` | `false` |
| Infomaniak | `https://s3.<region>.io.cloud.infomaniak.com` | `false` |

Set at least `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY`. Leave them unset to keep the SQLite-only path.

### Bucket lifecycle (recommended)

As a second line of defence against orphaned objects and incomplete
multipart uploads, configure an S3 lifecycle rule on prefix `tresorpost/`:

- Expire objects after a period longer than the maximum secret TTL (31 days)
  plus the presigned-URL grace window, for example 40 days.
- Abort incomplete multipart uploads after 1 day.

Example (AWS CLI JSON):

```json
{
  "Rules": [
    {
      "ID": "tresorpost-expire",
      "Status": "Enabled",
      "Filter": { "Prefix": "tresorpost/" },
      "Expiration": { "Days": 40 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    }
  ]
}
```

## Local development

Prerequisites: Rust (stable) and Node 20+.

```bash
# Backend (API + serves built frontend) on :3000
cargo run

# Frontend dev server with HMR on :5173 (proxies /api to :3000)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 during development, or build the frontend
(`npm run build`) and use http://localhost:3000 to serve everything from the
single Rust binary.

## How the encryption flow works

1. The browser generates a random 256-bit (quantum-safe) key and encrypts the
   payload with XChaCha20-Poly1305.
2. Only the ciphertext and nonce are uploaded, the server returns a short id.
3. The share link is `…/#/v/<id>/<base64url-key>`. The key lives in the
   fragment and is never transmitted.
4. The recipient's browser reads the key from the fragment, fetches the
   ciphertext by id, and decrypts locally.
5. The secret self-destructs once it expires or its open limit is reached.

## Configuration

The server reads configuration from the environment, and from a `.env` file
if present (copy `.env.example` to `.env`):

| Variable                | Default        | Purpose                                                        |
| ----------------------- | -------------- | -------------------------------------------------------------- |
| `MAX_FILE_MB`           | `5`            | Max attachment size (MB) for the SQLite (small-file) path.     |
| `CREATE_RATE_LIMIT`     | `60`           | Max creates per IP per window. `0` disables.                   |
| `CREATE_RATE_WINDOW_SECS` | `3600`       | Create rate-limit window in seconds.                           |
| `READ_RATE_LIMIT`       | `300`          | Max GET/DELETE `/api/secrets/{id}` per IP per window. `0` disables. |
| `READ_RATE_WINDOW_SECS` | `3600`         | Read/delete rate-limit window in seconds.                      |
| `TRUST_PROXY`           | `false`        | Honour `X-Forwarded-For` / `X-Real-IP` (only behind a proxy).  |
| `ADMIN_TOKEN`           | _(unset)_      | Enables `/admin` and `/api/admin/*`. Generate with `openssl rand -hex 32`. |
| `ADMIN_AUTH_MAX_FAILURES` | `10`         | Failed admin logins per IP per window. `0` disables.           |
| `ADMIN_AUTH_WINDOW_SECS` | `3600`        | Admin-auth failure window in seconds.                          |
| `SMTP_HOST`               | `smtp.mailgun.org` | SMTP server for optional "email this link".                |
| `SMTP_PORT`               | `2525`         | SMTP port (Mailgun STARTTLS).                                  |
| `SMTP_USERNAME`           | _(unset)_      | SMTP user (`MAILGUN_SMTP_LOGIN` also works). Empty = email UI off. |
| `SMTP_PASSWORD`           | _(unset)_      | SMTP password (`MAILGUN_SMTP_PASSWORD` also works).            |
| `SMTP_FROM`               | _(unset)_      | From mailbox, e.g. `Tresorpost <noreply@mg.example.com>`.      |
| `PUBLIC_URL`              | _(unset)_      | Canonical origin (`https://tresorpost.ch`). Target of `SHORT_DOMAIN` redirects. Share emails may use this host. New share/delete links use the browser origin, not this value. |
| `SHORT_DOMAIN`            | _(unset)_      | Optional legacy short host (`tpst.ch`). Requests on that host 301 to `PUBLIC_URL` (path + query copied, `#` kept by the browser). New links are not minted on this host. |
| `EMAIL_RATE_LIMIT`        | `3`            | Max share emails / content reports per IP per window. `0` disables. |
| `EMAIL_RATE_WINDOW_SECS`  | `60`           | Share-email / report rate-limit window (default 1 minute).     |
| `ADMIN_REPORT_URL`        | _(unset)_      | Mailbox that receives abuse reports (`reports@…`, `mailto:…`, or `Name <email>`). Needs SMTP. Hides the Report button when unset. |
| `PORT`                  | `3000`         | HTTP port.                                                     |
| `DATABASE_PATH`         | `db/data.db`   | SQLite database file path.                                     |
| `STATIC_DIR`            | `frontend/dist`| Built frontend directory to serve.                             |
| `S3_ENDPOINT`           | _(unset)_      | S3 endpoint URL. Empty means S3 is disabled (default).         |
| `S3_REGION`             | `us-east-1`    | S3 region.                                                     |
| `S3_BUCKET`             | _(unset)_      | Bucket for large-file objects (required when S3 enabled).      |
| `S3_ACCESS_KEY_ID`      | _(unset)_      | S3 access key (required when S3 enabled).                      |
| `S3_SECRET_ACCESS_KEY`  | _(unset)_      | S3 secret key (required when S3 enabled).                      |
| `S3_FORCE_PATH_STYLE`   | `false`        | Use path-style addressing (set `true` for MinIO).              |
| `MAX_S3_FILE_MB`        | `5120`         | Max raw file size (MB) for the S3 large-file path (~5 GB).     |
| `S3_URL_TTL_SECS`       | `3600`         | Lifetime of presigned upload/download URLs and the burn grace. |
| `MAX_SQLITE_MB`         | `2048`         | Max on-disk SQLite size (MB, including WAL/SHM). `0` = unlimited. Creates return `507` when exceeded. |
| `MAX_S3_GB`             | `50`           | Max live S3 usage (GB), `SUM(size)` of rows with `s3_key`, including pending. `0` = unlimited. `uploads/init` returns `507` when exceeded. |
| `PENDING_UPLOAD_TTL_SECS` | `21600`      | Max age of an abandoned multipart upload (default 6 hours). |

`MAX_FILE_MB` is the single source of truth. The server derives its
request-body and ciphertext limits from it and exposes the value at
`GET /api/config`, which the frontend fetches at runtime.

## Admin dashboard

A lightweight admin dashboard lives at `/admin` and shows on-disk storage,
the number of active links, a 14-day creations chart, and lifetime totals
with a breakdown by type. It's protected by an `ADMIN_TOKEN`:

```bash
ADMIN_TOKEN=your-secret cargo run
```

When `ADMIN_TOKEN` is unset the admin endpoints are disabled entirely. Only
aggregate metadata is exposed, never any ciphertext or keys.

Failed `x-admin-token` values are counted per client IP. After
`ADMIN_AUTH_MAX_FAILURES` (default 10) in `ADMIN_AUTH_WINDOW_SECS` (default 1
hour) the endpoints return `429` until the window slides. Successful auth
doesn't consume that budget. Set either env var to `0` to disable the
limiter.

## Indexing (no trackers)

No analytics. Indexing is done with crawlable URLs, not Google Analytics or
similar.

- `GET /robots.txt` and `GET /sitemap.xml` (`/`, `/faq`, `/privacy`).
- Unique `<title>`, description, canonical and Open Graph tags on those paths
  (the binary rewrites `index.html` for `/faq` and `/privacy` so chat
  previews aren't the homepage card).
- JSON-LD `WebApplication` and `Organization` on every page, `FAQPage` on
  `/faq`.
- Secret links stay in the URL fragment (`#/v/…`) and are `noindex`.

For Google Search Console, add `https://tresorpost.ch` and submit
`https://tresorpost.ch/sitemap.xml`.

## Security

None of what's below changes the client-side encryption itself
(XChaCha20-Poly1305, key in the URL fragment). It's what sits around it.

**TLS and reverse proxy.** The binary serves plain HTTP. Terminate TLS at
nginx, Caddy, or a load balancer in production. Set `TRUST_PROXY=true` only
when that proxy overwrites `X-Forwarded-For` / `X-Real-IP`, otherwise clients
can spoof IPs and bypass the per-IP limits. Responses include
`Strict-Transport-Security: max-age=63072000; includeSubDomains` so browsers
stick to HTTPS after the first secure visit.

**Admin token.** Generate a long random secret, for example:

```bash
openssl rand -hex 32
```

Put it in `ADMIN_TOKEN` (environment or `.env`). Don't commit it or bake it
into the image.

**In-memory limiters, per replica.** Create, read/delete, and admin-auth
limiters keep their counters in process memory. Each replica has its own
map, so N replicas allow roughly N times the configured budget per IP. Run a
single replica, or put a shared limiter in front, if you need a real global
cap.

**HTTP headers.** Every response, API and static files, sets:

- `Content-Security-Policy`: `default-src 'none'`, scripts from `'self'`,
  styles `'self' 'unsafe-inline'` (progress UI), images `'self' blob: data:`,
  media `'self' blob:`, `connect-src 'self'` plus `S3_ENDPOINT` when set
  (browser → S3 presigned URLs), `base-uri 'none'`, `form-action 'self'`,
  `frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY`
- `Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()`
- `Strict-Transport-Security` as above

## Docker

```bash
docker compose up --build
```

builds and runs the image from the local `Dockerfile`.

A pre-built image is published to GHCR once a `vX.Y.Z` tag is pushed, via
`.github/workflows/release.yml` — after that, `docker-compose.yml` can point
at `ghcr.io/dol-ch/tresorpost:latest` (or a pinned version) instead of
building locally.

## Branding / white-labeling

The default build uses system fonts and an original MIT mark. To apply a
private theme (proprietary logos and licensed fonts) without touching the
code, drop a `frontend/src/brand/private/` overlay, it's git-ignored and
picked up automatically. Full instructions in
[docs/BRANDING.md](docs/BRANDING.md).

## License

Source code is [MIT](LICENSE). Brand assets (proprietary logos, licensed
fonts) aren't covered and aren't included in this repository.
