# Tresorpost — end-to-end encrypted, quantum-safe transfer

Create a fully **end-to-end encrypted** link containing **text**, an **image**, or a
**file** (≤ 5 MB ATM), then share the link with anyone. The content is encrypted in the
browser and decrypted in the recipient's browser — the server only ever stores
opaque ciphertext and can never read it.

## Highlights

- **Zero-knowledge server.** Encryption/decryption happen entirely client-side.
  The 256-bit key is generated in the browser and placed in the URL *fragment*
  (`#…`), which browsers never send to the server.
- **Quantum-resistant cipher.** Payloads are sealed with **XChaCha20-Poly1305**
  using a 256-bit key. Symmetric ciphers at 256 bits retain ~128-bit security
  even against Grover's algorithm, so they are considered quantum-safe.
- **Three content types** via a dropdown: **Text** (ProseMirror rich text, no
  attachments), **Image**, and **File** (max 5 MB).
- **Self-destruct timer:** 1, 5, 15, 30 minutes · 1, 3, 6, 12 hours · 1, 3, 7
  days · 1 month.
- **Optional open limit:** burn the secret after _N_ opens (numeric input, 1…∞).
- **Durable UUID links** backed by SQLite.

## Architecture

| Layer      | Stack                                                            |
| ---------- | --------------------------------------------------------------- |
| Backend    | Rust · [Axum](https://github.com/tokio-rs/axum) · SQLite (sqlx) |
| Frontend   | Vite · React · TypeScript · ProseMirror · @noble/ciphers        |
| Crypto     | XChaCha20-Poly1305 (256-bit), key in URL fragment               |

The server exposes a tiny API and, in production, serves the built SPA:

- `POST /api/secrets` — store `{ ciphertext, nonce, expires_in, max_views }`, returns `{ id }`.
- `GET  /api/secrets/:id` — atomically consumes one view; returns ciphertext or `404` when expired/exhausted.
- `GET  /api/health` — liveness.

Ciphertext, nonce, filename, MIME type and content kind are **all inside the
encrypted blob**. The database only stores the ciphertext, a nonce, timestamps,
and the view counter.


This may change in the future. I'm just brainstorming, so don't expect anything
to work yet.
