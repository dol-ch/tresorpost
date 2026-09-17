# Changelog

All notable changes to Tresorpost are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project
doesn't yet follow strict semantic versioning (the `0.1.x` series has been
bumped on most merges), so version numbers here are informational, not a
compatibility promise.

## Unreleased

Add entries here as you go, under `Added` / `Changed` / `Fixed` /
`Security`, then fold them into a dated release section when you cut one.

## [0.1.33] — 2026-09-17

### Changed

- Republish container images after GHCR packages were removed.

## [0.1.32] — 2026-09-17

### Added

- Unit tests for S3 object-key shape and multipart upload validation
  (no live bucket).

## [0.1.31] — 2026-09-16

### Fixed

- No horizontal page scroll on narrow phones (viewport-fit, overflow clip,
  wrapping nav / expiry / attach row).

## [0.1.30] — 2026-09-16

### Changed

- Footer shows the crate/npm version (`v0.1.30` from `package.json` /
  `Cargo.toml`) instead of a git commit hash, which Docker builds never
  received.

## [0.1.27] and earlier — 2026-09-14 to 2026-09-16

The first two days of development. Summarized by theme rather than by the
individual `0.1.x` bumps, since most of those didn't correspond to a
release event.

### Added

- Core flow: client-side XChaCha20-Poly1305 encryption, key in the URL
  fragment, self-destruct timer, optional open limit.
- Creator and recipient delete tokens (SHA-256 hash stored, never the
  token itself).
- Short share links (`#/v/<id>/<key>`) with a QR code; legacy `#/s/…`
  links still open.
- S3-backed large-file uploads (up to ~5 GB) via presigned multipart
  URLs, fully end-to-end encrypted, with an orphan reaper and bucket
  lifecycle guidance.
- Admin dashboard (`/admin`, token-protected): creations chart, active
  links, storage usage, purge expired.
- Per-IP rate limits on create, read/delete, share-email, and admin-auth
  failures.
- HTTP security headers (CSP, HSTS, nosniff, no-referrer, frame-deny,
  permissions-policy) on every response.
- Crawlable `/faq` and `/privacy` with per-page OG/JSON-LD metadata, and
  a sitemap — no analytics or trackers.
- Optional "email this link" over SMTP (Mailgun-compatible) and an abuse
  report button.
- `SHORT_DOMAIN` → `PUBLIC_URL` redirect for a separate short domain.
- Unified compose UI (single payload, inferred content type), light/dark
  theme, syntax highlighting on decrypted code blocks.
- German / English / Ukrainian UI based on browser language.
- Swappable branding layer (`frontend/src/brand/private/`) for
  white-labeling without touching tracked code.
- CodeQL scanning and Dependabot (npm + Docker).

### Changed

- Moved off the deprecated `rustls 0.21` / `rustls-webpki 0.101` stack in
  the AWS S3 client to `rustls 0.23` + aws-lc.
- Various UI passes: idle compose without ProseMirror until focus, file
  drops on the whole compose well, toolbar and copy polish.

### Fixed

- Share-email sending behind a loopback reverse proxy.
- FAQ JSON embedded in the Rust crate so the Docker backend build doesn't
  depend on the frontend tree.
- Numbered lists and blockquote rendering in decrypted rich text.

[0.1.27]: https://github.com/dol-ch/tresorpost/commits/main
