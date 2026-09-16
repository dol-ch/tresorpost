//! Shared types, IDs, metrics helpers, error responses, and HTTP security headers.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    Json, Router,
    http::{HeaderName, HeaderValue, StatusCode, header},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use subtle::ConstantTimeEq;
use tower_http::set_header::SetResponseHeaderLayer;

use crate::s3::S3Backend;

pub(crate) const ID_ALPHABET: &[u8] =
    b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
pub(crate) const ID_LEN: usize = 12;

pub(crate) fn generate_id() -> String {
    let mut rng = rand::rng();
    (0..ID_LEN)
        .map(|_| ID_ALPHABET[rng.random_range(0..ID_ALPHABET.len())] as char)
        .collect()
}

pub(crate) fn generate_delete_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn hash_delete_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    hex_encode(&digest)
}

pub(crate) fn delete_token_matches(stored_hash: &str, presented: &str) -> bool {
    if stored_hash.len() != 64 {
        return false;
    }
    let got = hash_delete_token(presented);
    bool::from(got.as_bytes().ct_eq(stored_hash.as_bytes()))
}

pub(crate) fn constant_time_eq_str(a: &str, b: &str) -> bool {
    let ha = Sha256::digest(a.as_bytes());
    let hb = Sha256::digest(b.as_bytes());
    bool::from(ha.ct_eq(&hb))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn default_allow_delete() -> bool {
    true
}

fn default_allow_recipient_delete() -> bool {
    false
}

/// Default maximum attachment size (MB) when `MAX_FILE_MB` is not set.
pub(crate) const DEFAULT_MAX_FILE_MB: u64 = 5;
/// Default maximum S3-backed file size (MB) when `MAX_S3_FILE_MB` is not set.
pub(crate) const DEFAULT_MAX_S3_FILE_MB: u64 = 5120; // ~5 GB
/// Default SQLite database size cap (MB). `MAX_SQLITE_MB=0` disables the cap.
pub(crate) const DEFAULT_MAX_SQLITE_MB: u64 = 2048;
/// Default live S3 usage cap (GB). `MAX_S3_GB=0` disables the cap.
pub(crate) const DEFAULT_MAX_S3_GB: u64 = 50;
/// Abandoned multipart uploads are reaped after this many seconds.
pub(crate) const DEFAULT_PENDING_UPLOAD_TTL_SECS: i64 = 6 * 3600;
/// Smallest allowed lifetime (seconds). UI minimum is 1 minute.
pub(crate) const MIN_EXPIRES: i64 = 60;
/// Largest allowed lifetime (seconds). UI maximum is ~1 month (31 days).
pub(crate) const MAX_EXPIRES: i64 = 31 * 24 * 3600;

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
    pub(crate) create_limiter: crate::rate::CreateLimiter,
    pub(crate) read_limiter: crate::rate::ReadLimiter,
    pub(crate) email_limiter: crate::rate::EmailLimiter,
    pub(crate) mailer: Option<crate::mail::Mailer>,
    /// Inbox that receives abuse reports (`ADMIN_REPORT_URL`). Email address,
    /// optionally `mailto:`. None = report UI off.
    pub(crate) admin_report_to: Option<String>,
    pub(crate) admin_auth_limiter: crate::rate::AdminAuthLimiter,
    /// 0 = unlimited.
    pub(crate) max_sqlite_bytes: u64,
    /// 0 = unlimited. Compared to SUM(size) of rows that have an s3_key.
    pub(crate) max_s3_bytes: u64,
    pub(crate) pending_upload_ttl_secs: i64,
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
    /// Coarse content kind ("text" | "image" | "file" | "video"), stored for aggregate
    /// stats only. NOT the content — the payload itself stays encrypted.
    #[serde(default)]
    pub(crate) kind: Option<String>,
    /// When true (the default), the response includes a one-time `delete_token`
    /// the creator can use to destroy the secret. The server stores only a hash.
    #[serde(default = "default_allow_delete")]
    pub(crate) allow_delete: bool,
    /// When true, a second delete token is embedded in the share URL so the
    /// recipient can permanently destroy ciphertext after opening.
    #[serde(default = "default_allow_recipient_delete")]
    pub(crate) allow_recipient_delete: bool,
}

/// Normalize a client-provided kind to one of the known buckets.
pub(crate) fn normalize_kind(kind: &Option<String>) -> &'static str {
    match kind.as_deref() {
        Some("text") => "text",
        Some("image") => "image",
        Some("file") => "file",
        Some("video") => "video",
        _ => "unknown",
    }
}

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
    /// Present only when `allow_delete` was true. Keep private — not the share key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) delete_token: Option<String>,
    /// Present when `allow_recipient_delete` was true. Goes in the share URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) recipient_delete_token: Option<String>,
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

/// Origin (`scheme://host[:port]`) for CSP `connect-src` from `S3_ENDPOINT`.
pub(crate) fn s3_connect_origin(endpoint: &str) -> String {
    let s = endpoint.trim();
    if let Some(scheme_end) = s.find("://") {
        let after = &s[scheme_end + 3..];
        if let Some(slash) = after.find('/') {
            return s[..scheme_end + 3 + slash]
                .trim_end_matches('/')
                .to_string();
        }
    }
    s.trim_end_matches('/').to_string()
}

/// Build CSP. `connect-src` is `'self'` plus the S3 origin when configured.
pub(crate) fn build_content_security_policy(s3_endpoint: Option<&str>) -> String {
    let connect = match s3_endpoint.map(str::trim).filter(|s| !s.is_empty()) {
        Some(ep) => format!("'self' {}", s3_connect_origin(ep)),
        None => "'self'".to_string(),
    };
    format!(
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
         font-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; \
         connect-src {connect}; base-uri 'none'; form-action 'self'; \
         frame-ancestors 'none'"
    )
}

fn csp_from_env() -> String {
    build_content_security_policy(std::env::var("S3_ENDPOINT").ok().as_deref())
}

fn header_value(s: &str) -> HeaderValue {
    HeaderValue::from_str(s).unwrap_or_else(|_| HeaderValue::from_static("invalid"))
}

/// Apply defense-in-depth HTTP headers to the whole app (API + `ServeDir`).
pub(crate) fn security_headers_layer<S>(router: Router<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    let csp = header_value(&csp_from_env());
    router
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("content-security-policy"),
            csp,
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("permissions-policy"),
            HeaderValue::from_static("geolocation=(), camera=(), microphone=(), payment=()"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=63072000; includeSubDomains"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cross-origin-opener-policy"),
            HeaderValue::from_static("same-origin"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cross-origin-resource-policy"),
            HeaderValue::from_static("same-origin"),
        ))
}

/// `Cache-Control: no-store` for the whole `/api` router. Read/delete
/// responses carry ciphertext for a one-time view; nothing under `/api`
/// should ever be served from a shared cache.
pub(crate) fn no_store_layer<S>(router: Router<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    router.layer(SetResponseHeaderLayer::overriding(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    ))
}

#[cfg(test)]
mod security_header_tests {
    use super::*;

    #[test]
    fn csp_without_s3_is_self_only() {
        let csp = build_content_security_policy(None);
        assert!(csp.contains("script-src 'self'"));
        assert!(csp.contains("style-src 'self' 'unsafe-inline'"));
        assert!(csp.contains("font-src 'self'"));
        assert!(csp.contains("img-src 'self' blob: data:"));
        assert!(csp.contains("media-src 'self' blob:"));
        assert!(csp.contains("connect-src 'self'"));
        assert!(!csp.contains("connect-src 'self' http"));
        assert!(csp.contains("default-src 'none'"));
        assert!(csp.contains("frame-ancestors 'none'"));
    }

    #[test]
    fn csp_includes_s3_origin_not_path() {
        let csp = build_content_security_policy(Some("https://s3.example.com/bucket"));
        assert!(csp.contains("connect-src 'self' https://s3.example.com"));
        assert!(!csp.contains("/bucket"));
    }

    #[test]
    fn s3_origin_keeps_port() {
        assert_eq!(
            s3_connect_origin("http://localhost:9000"),
            "http://localhost:9000"
        );
    }
}
