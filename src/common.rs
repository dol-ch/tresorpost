//! Shared types, IDs, metrics helpers, and error responses.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::{http::StatusCode, Json};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::s3::S3Backend;

/// Alphabet for short share IDs (URL-safe, no look-alike separators).
pub(crate) const ID_ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
/// Short-ID length. 62^12 ≈ 3.2e21 (~71 bits): unguessable, collision-free at
/// any realistic volume, yet far shorter than a 36-char UUID.
pub(crate) const ID_LEN: usize = 12;

pub(crate) fn generate_id() -> String {
    let mut rng = rand::thread_rng();
    (0..ID_LEN)
        .map(|_| ID_ALPHABET[rng.gen_range(0..ID_ALPHABET.len())] as char)
        .collect()
}

/// Default maximum attachment size (MB) when `MAX_FILE_MB` is not set.
pub(crate) const DEFAULT_MAX_FILE_MB: u64 = 5;
/// Default maximum S3-backed file size (MB) when `MAX_S3_FILE_MB` is not set.
pub(crate) const DEFAULT_MAX_S3_FILE_MB: u64 = 5120; // ~5 GB
/// Smallest allowed lifetime (seconds). UI minimum is 1 minute.
pub(crate) const MIN_EXPIRES: i64 = 60;
/// Largest allowed lifetime (seconds). UI maximum is ~1 month (31 days).
pub(crate) const MAX_EXPIRES: i64 = 31 * 24 * 3600;

/// Derive the encrypted-payload limits from a raw file-size limit. A raw file
/// becomes base64 (~4/3) inside the JSON payload, is encrypted, and the
/// ciphertext is base64-encoded again — roughly ~1.8× overall — so we allow 2×
/// plus a fixed buffer for JSON framing and text/image payloads.
pub(crate) fn derive_limits(max_file_bytes: u64) -> (usize, usize) {
    let body = (max_file_bytes * 2 + 2 * 1024 * 1024) as usize; // request body cap
    let ciphertext = (max_file_bytes * 2 + 256 * 1024) as usize; // ciphertext char cap
    (body, ciphertext)
}


#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) pool: SqlitePool,
    pub(crate) db_path: String,
    pub(crate) admin_token: Option<String>,
    pub(crate) max_file_bytes: i64,
    pub(crate) max_ciphertext_chars: usize,
    pub(crate) s3: Option<S3Backend>,
}
#[derive(Deserialize)]
pub(crate) struct CreateReq {
    /// base64 ciphertext produced by the client (opaque to the server).
    pub(crate) ciphertext: String,
    /// base64 nonce used for the AEAD (opaque to the server).
    pub(crate) nonce: String,
    /// Lifetime in seconds.
    pub(crate) expires_in: i64,
    /// Optional maximum number of reads before the secret is destroyed.
    pub(crate) max_views: Option<i64>,
    /// Coarse content kind ("text" | "image" | "file"), stored for aggregate
    /// stats only. NOT the content — the payload itself stays encrypted.
    #[serde(default)]
    pub(crate) kind: Option<String>,
}

/// Normalize a client-provided kind to one of the known buckets.
pub(crate) fn normalize_kind(kind: &Option<String>) -> &'static str {
    match kind.as_deref() {
        Some("text") => "text",
        Some("image") => "image",
        Some("file") => "file",
        _ => "unknown",
    }
}

/// Increment a lifetime counter (creating it if absent).
pub(crate) async fn bump(pool: &SqlitePool, name: &str, delta: i64) {
    let _ = sqlx::query(
        "INSERT INTO metrics (name, value) VALUES (?, ?) \
         ON CONFLICT(name) DO UPDATE SET value = value + ?",
    )
    .bind(name)
    .bind(delta)
    .bind(delta)
    .execute(pool)
    .await;
}

#[derive(Serialize)]
pub(crate) struct CreateResp {
    pub(crate) id: String,
}

#[derive(Serialize)]
pub(crate) struct ApiError {
    error: String,
}

pub(crate) fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub(crate) fn err(status: StatusCode, msg: &str) -> (StatusCode, Json<ApiError>) {
    (
        status,
        Json(ApiError {
            error: msg.to_string(),
        }),
    )
}
