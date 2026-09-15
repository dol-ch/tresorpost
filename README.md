# Tresorpost — end-to-end encrypted, quantum-safe

_Tresorpost_ (German: "vault mail") — send encrypted text, images and files.

Create a fully **end-to-end encrypted** link containing **text**, an **image**, or a
**file**, then share the link with anyone. The content is encrypted in the
browser and decrypted in the recipient's browser — the server only ever stores
opaque ciphertext and can never read it.

This is an **open-core** project: the whole application — including the
cryptography — is public so it can be **audited, not just trusted**. Visual
branding (logos, fonts) lives in a swappable theme layer; see
[docs/BRANDING.md](docs/BRANDING.md).

## Highlights

- **Zero-knowledge server.** Encryption/decryption happen entirely client-side.
  The 256-bit key is generated in the browser and placed in the URL *fragment*
  (`#…`), which browsers never send to the server.
- **Quantum-resistant cipher.** Payloads are sealed with **XChaCha20-Poly1305**
  using a 256-bit key. Symmetric ciphers at 256 bits retain ~128-bit security
  even against Grover's algorithm, so they are considered quantum-safe.
- **Four content types** via a dropdown: **Text** (ProseMirror rich text, no
  attachments), **Image**, **Video** (in-browser player when the codec allows,
  otherwise download), and **File**.
- **Self-destruct timer:** 1, 5, 15, 30 minutes · 1, 3, 6, 12 hours · 1, 3, 7
  days · 1 month. The view page shows remaining opens and expiry.
- **Optional open limit:** burn the secret after _N_ opens (numeric input, 1…∞).
- **Creator delete link:** optional private `#/d/<id>/<token>` URL so you can
  destroy a note before anyone opens it. The server stores only a SHA-256 hash
  of the token.
- **Recipient delete:** optional. Embeds a destroy token in the share URL
  (`#/v/<id>/<key>/<token>`) so the recipient can wipe ciphertext from the
  server after opening.
- **Short share links + QR code.** Compact `#/v/<id>/<key>` links (12-char IDs)
  with a scannable QR on the result screen. Legacy `#/s/…` links still open.
- **Light/dark theme**, syntax highlighting, and copy-all / per-code-block copy
  on decrypted text.
- **Admin dashboard** at `#/admin` (token-protected): creations chart, active
  links, purge expired.
- **Per-IP create rate limit** (default 60 notes / hour; `CREATE_RATE_LIMIT` /
  `CREATE_RATE_WINDOW_SECS`). Applies to `POST /api/secrets` and
  `POST /api/uploads/init`. `429` when exceeded.
- **Per-IP read/delete rate limit** (default 300 / hour; `READ_RATE_LIMIT` /
  `READ_RATE_WINDOW_SECS`) on `GET`/`DELETE /api/secrets/{id}`. `429` when exceeded.
- **Admin auth failure limit** (default 10 failed tokens / IP / hour;
  `ADMIN_AUTH_MAX_FAILURES` / `ADMIN_AUTH_WINDOW_SECS`). Only mismatches count.
- **HTTP security headers** on every response (CSP, nosniff, no-referrer, DENY
  framing, Permissions-Policy, HSTS). CSP `connect-src` includes `S3_ENDPOINT`
  when S3 is configured.
- **Durable links** backed by SQLite. Optional **S3** path for large files
  (up to ~5 GB).

## Architecture

| Layer      | Stack                                                            |
| ---------- | --------------------------------------------------------------- |
| Backend    | Rust · [Axum](https://github.com/tokio-rs/axum) · SQLite (sqlx) |
| Frontend   | Vite · React · TypeScript · ProseMirror · @noble/ciphers        |
| Crypto     | XChaCha20-Poly1305 (256-bit, quantum-safe), key in URL fragment |

The server exposes a tiny API and, in production, serves the built SPA:

- `POST /api/secrets` — store `{ ciphertext, nonce, expires_in, max_views, kind, allow_delete, allow_recipient_delete }`, returns `{ id, delete_token?, recipient_delete_token? }`. `429` if the per-IP create limit is exceeded. `507` if the SQLite file would exceed `MAX_SQLITE_MB`.
- `GET  /api/secrets/{id}` — atomically consumes one view; returns ciphertext (SQLite) **or** a presigned download URL (S3), or `404` when expired/exhausted. `429` if the per-IP read limit is exceeded.
- `DELETE /api/secrets/{id}` — destroy with `{ delete_token }` (creator **or** recipient token). Same `404` for unknown id or wrong token. `503` if the S3 object could not be deleted (row is kept so a retry can finish). `429` if the per-IP read limit is exceeded.
- `GET  /api/secrets/{id}` — atomically consumes one view; returns ciphertext (SQLite) **or** a presigned download URL (S3), or `404` when expired/exhausted.
- `DELETE /api/secrets/{id}` — destroy with `{ delete_token }` (creator **or** recipient token). Same `404` for unknown id or wrong token.
- `GET  /api/config` — `{ max_file_bytes, s3_enabled, max_s3_file_bytes, email_enabled }`.
- `POST /api/share-email` — `{ to, url, expires_in, max_views }` sends the share link over SMTP. `429` if the per-IP email limit is exceeded. `503` if SMTP is not configured.
- `GET  /api/health` — liveness.
- `POST /api/uploads/init` — begin an S3 multipart upload (large files). `429` if the create rate limit is exceeded; `507` if `MAX_S3_GB` (or SQLite cap) would be exceeded.
- `POST /api/uploads/{id}/part-url` — presigned PUT URL for one encrypted chunk.
- `POST /api/uploads/{id}/complete` — finish the multipart upload.
- `GET  /api/admin/stats` · `GET /api/admin/active` · `POST /api/admin/purge` — admin (requires `ADMIN_TOKEN`).

Ciphertext, nonce, filename, MIME type and content kind are **all inside the
encrypted blob**. For the default SQLite path the database only stores the
ciphertext, a nonce, timestamps, coarse kind metadata for stats, and the view
counter. When S3 is enabled, large-file ciphertext lives in the object store;
the database keeps only orchestration metadata.

## Large files (S3-backed, up to ~5 GB)

When the `S3_*` environment variables are set, **file** and **video** uploads stream
directly from the browser to S3 via presigned multipart URLs. The server never
handles the bytes. Encryption stays end-to-end: S3 only stores ciphertext
chunks sealed with XChaCha20-Poly1305 (chunk index + final flag in AAD).

A random 256-bit key (URL fragment only) and a random 20-byte base nonce are
generated per file. The file is sliced into fixed 8 MiB plaintext chunks; each
chunk is sealed independently. Uploads and downloads never buffer the whole
file. Downloads stream to disk via the File System Access API (with a
size-capped in-memory Blob fallback).

Objects are deleted on expiry, burn (after the presigned-URL grace window),
explicit delete, and by an orphan reaper that lists `tresorpost/` keys not
referenced by SQLite. The sweeper **does not drop a SQLite row until the S3
object or multipart upload is gone**, then checkpoints the WAL and runs
incremental vacuum so the database file can shrink.

Abandoned multipart uploads are reaped after `PENDING_UPLOAD_TTL_SECS`
(default 6 hours), not the secret's full TTL (up to 31 days). Last-view S3
burns set `purge_after = now + S3_URL_TTL_SECS` on the row instead of a
fire-and-forget task, so a restart still deletes the object.

### Bucket CORS (required for browser → S3)

Direct browser uploads/downloads require the bucket to allow the app origin and
to **expose the `ETag` header**. Example CORS:

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

As belt-and-suspenders against orphaned objects and incomplete multipart
uploads, configure an S3 lifecycle rule on prefix `tresorpost/`:

- Expire objects after a period longer than the maximum secret TTL (31 days)
  plus the presigned-URL grace window (for example 40 days).
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
2. Only the ciphertext + nonce are uploaded; the server returns a short id.
3. The share link is `…/#/v/<id>/<base64url-key>` — the key lives in the
   fragment and is never transmitted.
4. The recipient's browser reads the key from the fragment, fetches the
   ciphertext by id, and decrypts locally.
5. The secret self-destructs once it expires or its open limit is reached.

## Configuration

The server reads configuration from the environment (and from a `.env` file if
present — copy `.env.example` to `.env`):

| Variable                | Default        | Purpose                                                        |
| ----------------------- | -------------- | -------------------------------------------------------------- |
| `MAX_FILE_MB`           | `5`            | Max attachment size (MB) for the SQLite (small-file) path.     |
| `CREATE_RATE_LIMIT`     | `60`           | Max creates per IP per window. `0` disables.                   |
| `CREATE_RATE_WINDOW_SECS` | `3600`       | Create rate-limit window in seconds.                           |
| `READ_RATE_LIMIT`       | `300`          | Max GET/DELETE `/api/secrets/{id}` per IP per window. `0` disables. |
| `READ_RATE_WINDOW_SECS` | `3600`         | Read/delete rate-limit window in seconds.                      |
| `TRUST_PROXY`           | `false`        | Honour `X-Forwarded-For` / `X-Real-IP` (only behind a proxy).  |
| `ADMIN_TOKEN`           | _(unset)_      | Enables `#/admin` and `/api/admin/*`. Generate with `openssl rand -hex 32`. |
| `ADMIN_AUTH_MAX_FAILURES` | `10`         | Failed admin logins per IP per window. `0` disables.           |
| `ADMIN_AUTH_WINDOW_SECS` | `3600`        | Admin-auth failure window in seconds.                          |
| `SMTP_HOST`               | `smtp.mailgun.org` | SMTP server for optional “email this link”.                |
| `SMTP_PORT`               | `2525`         | SMTP port (Mailgun STARTTLS).                                  |
| `SMTP_USERNAME`           | _(unset)_      | SMTP user (`MAILGUN_SMTP_LOGIN` also works). Empty = email UI off. |
| `SMTP_PASSWORD`           | _(unset)_      | SMTP password (`MAILGUN_SMTP_PASSWORD` also works).            |
| `SMTP_FROM`               | _(unset)_      | From mailbox, e.g. `Tresorpost <noreply@mg.example.com>`.      |
| `PUBLIC_URL`              | _(unset)_      | Canonical site origin; share emails must use this host.        |
| `EMAIL_RATE_LIMIT`        | `3`            | Max share emails per IP per window. `0` disables.              |
| `EMAIL_RATE_WINDOW_SECS`  | `60`           | Share-email rate-limit window (default 1 minute).              |
| `PORT`                  | `3000`         | HTTP port.                                                     |
| `DATABASE_PATH`         | `db/data.db`   | SQLite database file path.                                     |
| `STATIC_DIR`            | `frontend/dist`| Built frontend directory to serve.                             |
| `S3_ENDPOINT`           | _(unset)_      | S3 endpoint URL. **Empty = S3 disabled** (default behavior).   |
| `S3_REGION`             | `us-east-1`    | S3 region.                                                     |
| `S3_BUCKET`             | _(unset)_      | Bucket for large-file objects (required when S3 enabled).      |
| `S3_ACCESS_KEY_ID`      | _(unset)_      | S3 access key (required when S3 enabled).                      |
| `S3_SECRET_ACCESS_KEY`  | _(unset)_      | S3 secret key (required when S3 enabled).                      |
| `S3_FORCE_PATH_STYLE`   | `false`        | Use path-style addressing (set `true` for MinIO).              |
| `MAX_S3_FILE_MB`        | `5120`         | Max raw file size (MB) for the S3 large-file path (~5 GB).     |
| `S3_URL_TTL_SECS`       | `3600`         | Lifetime of presigned upload/download URLs and the burn grace. |
| `MAX_SQLITE_MB`         | `2048`         | Max on-disk SQLite size (MB, including WAL/SHM). `0` = unlimited. Creates return `507` when exceeded. |
| `MAX_S3_GB`             | `50`           | Max live S3 usage (GB): `SUM(size)` of rows with `s3_key`, including pending. `0` = unlimited. `uploads/init` returns `507` when exceeded. |
| `PENDING_UPLOAD_TTL_SECS` | `21600`      | Max age of an abandoned multipart upload (default 6 hours). |

`MAX_FILE_MB` is the single source of truth: the server derives its request-body
and ciphertext limits from it and exposes the value at `GET /api/config`, which
the frontend fetches at runtime.

## Admin dashboard

A lightweight admin dashboard lives at `#/admin` and shows on-disk storage, the
number of active links, a 14-day creations chart, and lifetime totals with a
breakdown by type. It is protected by an `ADMIN_TOKEN`:

```bash
ADMIN_TOKEN=your-secret cargo run
```

When `ADMIN_TOKEN` is unset the admin endpoints are disabled entirely. Only
aggregate metadata is exposed — never any ciphertext or keys.

Failed `x-admin-token` values are counted per client IP. After
`ADMIN_AUTH_MAX_FAILURES` (default 10) in `ADMIN_AUTH_WINDOW_SECS` (default 1
hour) the endpoints return `429` until the window slides. Successful auth does
not consume that budget. Set either env var to `0` to disable the limiter.

## Security

Defense-in-depth around the zero-knowledge model. **None of this changes
client-side encryption** (XChaCha20-Poly1305, key in the URL fragment).

**TLS and reverse proxy.** The binary serves plain HTTP. Terminate TLS at
nginx, Caddy, or a load balancer in production. Set `TRUST_PROXY=true` only
when that proxy **overwrites** `X-Forwarded-For` / `X-Real-IP`; otherwise
clients can spoof IPs and bypass per-IP limits. Responses include
`Strict-Transport-Security: max-age=63072000; includeSubDomains` so browsers
stick to HTTPS after the first secure visit.

**Admin token.** Generate a long random secret, for example:

```bash
openssl rand -hex 32
```

Put it in `ADMIN_TOKEN` (environment or `.env`). Do not commit it or put it in
the image.

**In-memory limiters × replicas.** Create, read/delete, and admin-auth
limiters keep counters **in process memory**. Each replica has its own map, so
N replicas allow roughly N× the configured budget per IP. Use a single replica
or a shared limiter if you need a global cap.

**HTTP headers.** Every response (API and static files) sets:

- `Content-Security-Policy` — `default-src 'none'`; scripts from `'self'`;
  styles `'self' 'unsafe-inline'` (progress UI); images `'self' blob: data:`;
  media `'self' blob:`; `connect-src 'self'` plus `S3_ENDPOINT` when set
  (browser → S3 presigned URLs); `base-uri 'none'`; `form-action 'self'`;
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

The image is also published to GHCR on version tags (`v*`) via
`.github/workflows/release.yml`.

## Branding / white-labeling

The default build uses system fonts and an original MIT mark. To apply a private
theme (proprietary logos and licensed fonts) without touching the code, drop a
`frontend/src/brand/private/` overlay — it is git-ignored and picked up
automatically. Full instructions in [docs/BRANDING.md](docs/BRANDING.md).

## License

Source code is [MIT](LICENSE). Brand assets (proprietary logos, licensed fonts)
are **not** covered and **not** included in this repository.
