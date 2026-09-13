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
- `GET  /api/secrets/{id}` — atomically consumes one view; returns ciphertext (SQLite) **or** a presigned download URL (S3), or `404` when expired/exhausted.
- `DELETE /api/secrets/{id}` — destroy with `{ delete_token }` (creator **or** recipient token). Same `404` for unknown id or wrong token. `503` if the S3 object could not be deleted (row is kept so a retry can finish).
- `GET  /api/secrets/{id}` — atomically consumes one view; returns ciphertext (SQLite) **or** a presigned download URL (S3), or `404` when expired/exhausted.
- `DELETE /api/secrets/{id}` — destroy with `{ delete_token }` (creator **or** recipient token). Same `404` for unknown id or wrong token.
- `GET  /api/config` — `{ max_file_bytes, s3_enabled, max_s3_file_bytes }`.
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
| `CREATE_RATE_WINDOW_SECS` | `3600`       | Rate-limit window in seconds.                                  |
| `TRUST_PROXY`           | `false`        | Honour `X-Forwarded-For` / `X-Real-IP` (only behind a proxy).  |
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
