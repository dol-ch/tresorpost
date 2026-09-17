//! S3 multipart upload orchestration (presign, complete, abort).

use std::net::SocketAddr;

use axum::{
    Json,
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use crate::common::*;
use crate::s3::{PartRef, S3Backend};

#[derive(Deserialize)]
pub(crate) struct UploadInitReq {
    expires_in: i64,
    max_views: Option<i64>,
    #[serde(default)]
    kind: Option<String>,
    /// Total raw (plaintext) file size in bytes.
    total_size: i64,
    /// Plaintext chunk size in bytes (echoed back for the client's convenience).
    part_size: i64,
    /// Number of parts the client will upload.
    part_count: i64,
    /// Opaque client-side stream descriptor (base nonce, chunk size, encrypted
    /// header, …). The server stores it verbatim and never interprets it.
    meta: String,
    #[serde(default = "default_allow_delete_upload")]
    allow_delete: bool,
    #[serde(default)]
    allow_recipient_delete: bool,
}

fn default_allow_delete_upload() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub(crate) struct UploadInitResp {
    id: String,
    upload_id: String,
    part_size: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    delete_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recipient_delete_token: Option<String>,
}

pub(crate) async fn upload_init(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<UploadInitReq>,
) -> Result<(StatusCode, Json<UploadInitResp>), (StatusCode, Json<ApiError>)> {
    crate::rate::enforce_create_limit(&state, &headers, ConnectInfo(peer))?;
    let Some(s3) = state.s3.clone() else {
        return Err(err(StatusCode::SERVICE_UNAVAILABLE, "s3 not configured"));
    };
    if req.expires_in < MIN_EXPIRES || req.expires_in > MAX_EXPIRES {
        return Err(err(StatusCode::BAD_REQUEST, "expires_in out of range"));
    }
    if let Some(v) = req.max_views {
        if v < 1 {
            return Err(err(StatusCode::BAD_REQUEST, "max_views must be >= 1"));
        }
    }
    if req.total_size <= 0 || req.total_size > s3.max_file_bytes {
        return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "file too large"));
    }
    if req.part_count < 1 || req.part_count > 10_000 {
        return Err(err(StatusCode::BAD_REQUEST, "invalid part_count"));
    }
    if req.meta.is_empty() || req.meta.len() > 64 * 1024 {
        return Err(err(StatusCode::BAD_REQUEST, "invalid meta"));
    }

    crate::db::enforce_sqlite_quota(&state.db_path, state.max_sqlite_bytes, 0)?;
    crate::db::enforce_s3_quota(&state.pool, state.max_s3_bytes, req.total_size).await?;

    let now = now_secs();
    let secret_expires_at = now + req.expires_in;
    let expires_at =
        crate::db::pending_expires_at(now, req.expires_in, state.pending_upload_ttl_secs);
    let pending_purge_after = expires_at;
    let kind = normalize_kind(&req.kind);
    let s3_key = S3Backend::random_key();
    let delete_token = req.allow_delete.then(generate_delete_token);
    let delete_hash = delete_token.as_deref().map(hash_delete_token);
    let recipient_delete_token = req.allow_recipient_delete.then(generate_delete_token);
    let recipient_delete_hash = recipient_delete_token.as_deref().map(hash_delete_token);

    let upload_id = s3.create_multipart(&s3_key).await.map_err(|e| {
        tracing::error!("{e}");
        err(StatusCode::BAD_GATEWAY, "could not start upload")
    })?;

    for _ in 0..6 {
        let id = generate_id();
        let res = sqlx::query(
            "INSERT INTO secrets \
             (id, ciphertext, nonce, created_at, expires_at, max_views, views, kind, size, \
              storage, status, s3_key, upload_id, meta, delete_token_hash, recipient_delete_hash, purge_after) \
             VALUES (?, '', ?, ?, ?, ?, 0, ?, ?, 's3', 'pending', ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(secret_expires_at.to_string())
        .bind(now)
        .bind(expires_at)
        .bind(req.max_views)
        .bind(kind)
        .bind(req.total_size)
        .bind(&s3_key)
        .bind(&upload_id)
        .bind(&req.meta)
        .bind(&delete_hash)
        .bind(&recipient_delete_hash)
        .bind(pending_purge_after)
        .execute(&state.pool)
        .await;

        match res {
            Ok(_) => {
                return Ok((
                    StatusCode::CREATED,
                    Json(UploadInitResp {
                        id,
                        upload_id,
                        part_size: req.part_size,
                        delete_token,
                        recipient_delete_token,
                    }),
                ));
            }
            Err(sqlx::Error::Database(e)) if e.is_unique_violation() => continue,
            Err(e) => {
                tracing::error!("upload init insert failed: {e}");
                let _ = s3.abort_multipart(&s3_key, &upload_id).await;
                return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "storage error"));
            }
        }
    }

    let _ = s3.abort_multipart(&s3_key, &upload_id).await;
    Err(err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "could not allocate id",
    ))
}

#[derive(Deserialize)]
pub(crate) struct PartUrlReq {
    part_number: i32,
}

#[derive(Debug, Serialize)]
pub(crate) struct PartUrlResp {
    url: String,
}

/// Look up the s3 key + upload id for a *pending* upload owned by this id.
pub(crate) async fn pending_upload(
    pool: &SqlitePool,
    id: &str,
) -> Result<(String, String), (StatusCode, Json<ApiError>)> {
    let row = sqlx::query(
        "SELECT s3_key, upload_id FROM secrets \
         WHERE id = ? AND storage = 's3' AND status = 'pending'",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!("pending lookup failed: {e}");
        err(StatusCode::INTERNAL_SERVER_ERROR, "storage error")
    })?;
    let Some(row) = row else {
        return Err(err(StatusCode::NOT_FOUND, "no pending upload"));
    };
    let key: Option<String> = row.get("s3_key");
    let upload_id: Option<String> = row.get("upload_id");
    match (key, upload_id) {
        (Some(k), Some(u)) => Ok((k, u)),
        _ => Err(err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "missing upload state",
        )),
    }
}

pub(crate) async fn upload_part_url(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<PartUrlReq>,
) -> Result<Json<PartUrlResp>, (StatusCode, Json<ApiError>)> {
    let Some(s3) = state.s3.as_ref() else {
        return Err(err(StatusCode::SERVICE_UNAVAILABLE, "s3 not configured"));
    };
    if req.part_number < 1 || req.part_number > 10_000 {
        return Err(err(StatusCode::BAD_REQUEST, "invalid part_number"));
    }
    let (key, upload_id) = pending_upload(&state.pool, &id).await?;
    let url = s3
        .presign_put_part(&key, &upload_id, req.part_number, s3.url_ttl)
        .await
        .map_err(|e| {
            tracing::error!("{e}");
            err(StatusCode::BAD_GATEWAY, "could not presign part")
        })?;
    Ok(Json(PartUrlResp { url }))
}

#[derive(Deserialize)]
pub(crate) struct CompletePart {
    part_number: i32,
    etag: String,
}

#[derive(Deserialize)]
pub(crate) struct CompleteReq {
    parts: Vec<CompletePart>,
}

pub(crate) async fn upload_complete(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<CompleteReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    let Some(s3) = state.s3.as_ref() else {
        return Err(err(StatusCode::SERVICE_UNAVAILABLE, "s3 not configured"));
    };
    if req.parts.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "no parts"));
    }
    let (key, upload_id) = pending_upload(&state.pool, &id).await?;

    let parts: Vec<PartRef> = req
        .parts
        .into_iter()
        .map(|p| PartRef {
            part_number: p.part_number,
            etag: p.etag,
        })
        .collect();

    if let Err(e) = s3.complete_multipart(&key, &upload_id, parts).await {
        tracing::error!("{e}");
        if s3.abort_multipart(&key, &upload_id).await {
            let _ = sqlx::query("DELETE FROM secrets WHERE id = ? AND status = 'pending'")
                .bind(&id)
                .execute(&state.pool)
                .await;
        }
        return Err(err(StatusCode::BAD_GATEWAY, "could not complete upload"));
    }

    // Flip to ready, restore the creator's full expiry, drop pending reap.
    let now = now_secs();
    let row = sqlx::query(
        "UPDATE secrets SET status = 'ready', purge_after = NULL, \
            expires_at = CASE WHEN nonce != '' THEN CAST(nonce AS INTEGER) ELSE expires_at END, \
            nonce = '' \
         WHERE id = ? AND storage = 's3' AND status = 'pending' \
         RETURNING kind, size",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!("complete flip failed: {e}");
        err(StatusCode::INTERNAL_SERVER_ERROR, "storage error")
    })?;

    if let Some(row) = row {
        let kind: String = row.get("kind");
        let size: i64 = row.get("size");
        bump(&state.pool, "created_total", 1).await;
        bump(&state.pool, &format!("created_{kind}"), 1).await;
        bump(&state.pool, "bytes_created_total", size).await;
        let _ = sqlx::query(
            "INSERT INTO daily_stats (day, count, bytes) \
             VALUES (strftime('%Y-%m-%d', ?, 'unixepoch'), 1, ?) \
             ON CONFLICT(day) DO UPDATE SET count = count + 1, bytes = bytes + ?",
        )
        .bind(now)
        .bind(size)
        .bind(size)
        .execute(&state.pool)
        .await;
    }

    Ok(Json(serde_json::json!({ "status": "ready" })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;
    use std::sync::Mutex;

    // Guards mutation of the S3_* env vars that S3Backend::from_env reads,
    // so fake_s3_backend() is safe under cargo's parallel test runner.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    async fn test_state(s3: Option<S3Backend>) -> (AppState, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "tresorpost-uploads-test-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("data.db");
        let pool = crate::db::init_db(&path.to_string_lossy()).await;
        let state = AppState {
            pool,
            db_path: path.to_string_lossy().into_owned(),
            admin_token: None,
            max_file_bytes: 5 * 1024 * 1024,
            max_ciphertext_chars: 1_000_000,
            s3,
            create_limiter: crate::rate::CreateLimiter::from_env(),
            read_limiter: crate::rate::ReadLimiter::from_env(),
            email_limiter: crate::rate::EmailLimiter::from_env(),
            mailer: None,
            admin_report_to: None,
            admin_auth_limiter: crate::rate::AdminAuthLimiter::from_env(),
            max_sqlite_bytes: 0,
            max_s3_bytes: 0,
            pending_upload_ttl_secs: 21_600,
        };
        (state, dir)
    }

    /// A real `S3Backend` pointed at a bogus local endpoint. Building the
    /// client never touches the network — only calling its methods
    /// (`create_multipart`, etc.) would — so this is safe to use for
    /// exercising the validation branches in upload_init/_part_url/_complete
    /// that return before any S3 call is made.
    fn fake_s3_backend(max_file_bytes: i64) -> S3Backend {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        unsafe {
            std::env::set_var("S3_ENDPOINT", "http://127.0.0.1:1");
            std::env::set_var("S3_BUCKET", "test-bucket");
            std::env::set_var("S3_ACCESS_KEY_ID", "test");
            std::env::set_var("S3_SECRET_ACCESS_KEY", "test");
        }
        let backend = S3Backend::from_env(max_file_bytes).expect("fake s3 backend");
        unsafe {
            std::env::remove_var("S3_ENDPOINT");
            std::env::remove_var("S3_BUCKET");
            std::env::remove_var("S3_ACCESS_KEY_ID");
            std::env::remove_var("S3_SECRET_ACCESS_KEY");
        }
        backend
    }

    fn peer() -> ConnectInfo<SocketAddr> {
        ConnectInfo(SocketAddr::new(
            std::net::IpAddr::V4(Ipv4Addr::new(203, 0, 113, 9)),
            4242,
        ))
    }

    fn valid_req() -> UploadInitReq {
        UploadInitReq {
            expires_in: 3600,
            max_views: None,
            kind: None,
            total_size: 100,
            part_size: 100,
            part_count: 1,
            meta: "m".into(),
            allow_delete: true,
            allow_recipient_delete: false,
        }
    }

    #[tokio::test]
    async fn upload_init_rejects_without_s3_configured() {
        let (state, dir) = test_state(None).await;
        let result = upload_init(State(state), peer(), HeaderMap::new(), Json(valid_req())).await;
        assert_eq!(result.unwrap_err().0, StatusCode::SERVICE_UNAVAILABLE);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn upload_init_rejects_oversized_file() {
        let (state, dir) = test_state(Some(fake_s3_backend(1_000))).await;
        let req = UploadInitReq {
            total_size: 2_000,
            ..valid_req()
        };
        let result = upload_init(State(state), peer(), HeaderMap::new(), Json(req)).await;
        assert_eq!(result.unwrap_err().0, StatusCode::PAYLOAD_TOO_LARGE);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn upload_init_rejects_invalid_part_count() {
        let (state, dir) = test_state(Some(fake_s3_backend(10_000_000))).await;
        for bad in [0, 10_001] {
            let req = UploadInitReq {
                part_count: bad,
                ..valid_req()
            };
            let result =
                upload_init(State(state.clone()), peer(), HeaderMap::new(), Json(req)).await;
            assert_eq!(
                result.unwrap_err().0,
                StatusCode::BAD_REQUEST,
                "part_count={bad}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn upload_init_rejects_empty_or_oversized_meta() {
        let (state, dir) = test_state(Some(fake_s3_backend(10_000_000))).await;
        let empty = UploadInitReq {
            meta: "".into(),
            ..valid_req()
        };
        let result = upload_init(State(state.clone()), peer(), HeaderMap::new(), Json(empty)).await;
        assert_eq!(result.unwrap_err().0, StatusCode::BAD_REQUEST);

        let oversized = UploadInitReq {
            meta: "x".repeat(64 * 1024 + 1),
            ..valid_req()
        };
        let result = upload_init(State(state), peer(), HeaderMap::new(), Json(oversized)).await;
        assert_eq!(result.unwrap_err().0, StatusCode::BAD_REQUEST);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn upload_init_rejects_expires_in_out_of_range() {
        let (state, dir) = test_state(Some(fake_s3_backend(10_000_000))).await;
        for bad in [MIN_EXPIRES - 1, MAX_EXPIRES + 1] {
            let req = UploadInitReq {
                expires_in: bad,
                ..valid_req()
            };
            let result =
                upload_init(State(state.clone()), peer(), HeaderMap::new(), Json(req)).await;
            assert_eq!(
                result.unwrap_err().0,
                StatusCode::BAD_REQUEST,
                "expires_in={bad}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn upload_init_rejects_zero_max_views() {
        let (state, dir) = test_state(Some(fake_s3_backend(10_000_000))).await;
        let req = UploadInitReq {
            max_views: Some(0),
            ..valid_req()
        };
        let result = upload_init(State(state), peer(), HeaderMap::new(), Json(req)).await;
        assert_eq!(result.unwrap_err().0, StatusCode::BAD_REQUEST);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn upload_part_url_rejects_out_of_range_part_number() {
        let (state, dir) = test_state(Some(fake_s3_backend(10_000_000))).await;
        for bad in [0, 10_001] {
            let result = upload_part_url(
                State(state.clone()),
                Path("someid".to_string()),
                Json(PartUrlReq { part_number: bad }),
            )
            .await;
            assert_eq!(
                result.unwrap_err().0,
                StatusCode::BAD_REQUEST,
                "part_number={bad}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn upload_part_url_rejects_without_s3_configured() {
        let (state, dir) = test_state(None).await;
        let result = upload_part_url(
            State(state),
            Path("someid".to_string()),
            Json(PartUrlReq { part_number: 1 }),
        )
        .await;
        assert_eq!(result.unwrap_err().0, StatusCode::SERVICE_UNAVAILABLE);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn upload_complete_rejects_empty_parts() {
        let (state, dir) = test_state(Some(fake_s3_backend(10_000_000))).await;
        let result = upload_complete(
            State(state),
            Path("someid".to_string()),
            Json(CompleteReq { parts: vec![] }),
        )
        .await;
        assert_eq!(result.unwrap_err().0, StatusCode::BAD_REQUEST);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn pending_upload_returns_not_found_for_unknown_id() {
        let (state, dir) = test_state(None).await;
        let result = pending_upload(&state.pool, "nope").await;
        assert_eq!(result.unwrap_err().0, StatusCode::NOT_FOUND);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn pending_upload_returns_key_and_upload_id_for_pending_row() {
        let (state, dir) = test_state(None).await;
        sqlx::query(
            "INSERT INTO secrets (id, ciphertext, nonce, created_at, expires_at, views, kind, size, storage, status, s3_key, upload_id) \
             VALUES ('up1', '', '', 0, 999999999, 0, 'file', 10, 's3', 'pending', 'tresorpost/xyz', 'upload-abc')",
        )
        .execute(&state.pool)
        .await
        .unwrap();
        let (key, upload_id) = pending_upload(&state.pool, "up1").await.unwrap();
        assert_eq!(key, "tresorpost/xyz");
        assert_eq!(upload_id, "upload-abc");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn pending_upload_ignores_ready_rows() {
        // A completed upload has already flipped `status` to 'ready' — the
        // part-url/complete endpoints must not resume writing to a finished
        // object.
        let (state, dir) = test_state(None).await;
        sqlx::query(
            "INSERT INTO secrets (id, ciphertext, nonce, created_at, expires_at, views, kind, size, storage, status, s3_key, upload_id) \
             VALUES ('done1', '', '', 0, 999999999, 0, 'file', 10, 's3', 'ready', 'tresorpost/xyz', 'upload-abc')",
        )
        .execute(&state.pool)
        .await
        .unwrap();
        let result = pending_upload(&state.pool, "done1").await;
        assert_eq!(result.unwrap_err().0, StatusCode::NOT_FOUND);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
