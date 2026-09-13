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
- **Three content types** via a dropdown: **Text** (ProseMirror rich text, no
  attachments), **Image**, and **File**.
- **Self-destruct timer:** 1, 5, 15, 30 minutes · 1, 3, 6, 12 hours · 1, 3, 7
  days · 1 month. The view page shows remaining opens and expiry.
- **Optional open limit:** burn the secret after _N_ opens (numeric input, 1…∞).
- **Creator delete link:** optional private `#/d/<id>/<token>` URL so you can
  destroy a note before anyone opens it. The server stores only a SHA-256 hash
  of the token.
- **Short share links + QR code.** Compact `#/v/<id>/<key>` links (12-char IDs)
  with a scannable QR on the result screen. Legacy `#/s/…` links still open.
- **Light/dark theme**, syntax highlighting, and copy-all / per-code-block copy
  on decrypted text.
- **Admin dashboard** at `#/admin` (token-protected): creations chart, active
  links, purge expired.
- **Durable links** backed by SQLite. Optional **S3** path for large files
  (up to ~5 GB).

## Architecture

| Layer      | Stack                                                            |
| ---------- | --------------------------------------------------------------- |
| Backend    | Rust · [Axum](https://github.com/tokio-rs/axum) · SQLite (sqlx) |
| Frontend   | Vite · React · TypeScript · ProseMirror · @noble/ciphers        |
| Crypto     | XChaCha20-Poly1305 (256-bit), key in URL fragment               |

The server exposes a tiny API and, in production, serves the built SPA:

- `POST /api/secrets` — store `{ ciphertext, nonce, expires_in, max_views, kind, allow_delete }`, returns `{ id, delete_token? }`.
- `GET  /api/secrets/{id}` — atomically consumes one view; returns ciphertext (SQLite) **or** a presigned download URL (S3), or `404` when expired/exhausted.
- `DELETE /api/secrets/{id}` — creator destroy with `{ delete_token }`. Same `404` for unknown id or wrong token.
- `GET  /api/config` — `{ max_file_bytes, s3_enabled, max_s3_file_bytes }`.
- `GET  /api/health` — liveness.
- `POST /api/uploads/init` — begin an S3 multipart upload (large files).
- `POST /api/uploads/{id}/part-url` — presigned PUT URL for one encrypted chunk.
- `POST /api/uploads/{id}/complete` — finish the multipart upload.
- `GET  /api/admin/stats` · `GET /api/admin/active` · `POST /api/admin/purge` — admin (requires `ADMIN_TOKEN`).

Ciphertext, nonce, filename, MIME type and content kind are **all inside the
encrypted blob**. For the default SQLite path the database only stores the
ciphertext, a nonce, timestamps, coarse kind metadata for stats, and the view
counter. When S3 is enabled, large-file ciphertext lives in the object store;
the database keeps only orchestration metadata.

## Large files (S3-backed, up to ~5 GB)

When the `S3_*` environment variables are set, **file** uploads stream
directly from the browser to S3 via presigned multipart URLs. The server never
handles the bytes. Encryption stays end-to-end: S3 only stores ciphertext
chunks sealed with XChaCha20-Poly1305 (chunk index + final flag in AAD).

A random 256-bit key (URL fragment only) and a random 20-byte base nonce are
generated per file. The file is sliced into fixed 8 MiB plaintext chunks; each
chunk is sealed independently. Uploads and downloads never buffer the whole
file. Downloads stream to disk via the File System Access API (with a
size-capped in-memory Blob fallback).

Objects are deleted on expiry (background sweep + admin “purge expired”). When
a link is burned it returns `404` immediately; the object is removed after the
presigned-URL grace window (`S3_URL_TTL_SECS`).

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

1. The browser generates a random 256-bit key and encrypts the payload with
   XChaCha20-Poly1305.
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
| `ADMIN_TOKEN`           | _(unset)_      | Enables the admin dashboard; disabled when unset.              |
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
