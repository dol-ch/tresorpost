//! SQLite secret create/read and public config/health endpoints.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Serialize;
use sqlx::Row;

use crate::common::*;

pub(crate) async fn health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

#[derive(Serialize)]
pub(crate) struct ConfigResp {
    /// Maximum raw attachment size in bytes that clients should enforce for the
    /// SQLite (small-file) path.
    max_file_bytes: i64,
    /// Whether the S3 large-file backend is configured and available.
    s3_enabled: bool,
    /// Maximum raw file size in bytes for the S3 path (only meaningful when
    /// `s3_enabled` is true).
    max_s3_file_bytes: i64,
}

/// Public runtime config so the frontend enforces the same limit as the server
/// without a rebuild.
pub(crate) async fn config(State(state): State<AppState>) -> Json<ConfigResp> {
    Json(ConfigResp {
        max_file_bytes: state.max_file_bytes,
        s3_enabled: state.s3.is_some(),
        max_s3_file_bytes: state.s3.as_ref().map(|s| s.max_file_bytes).unwrap_or(0),
    })
}

pub(crate) async fn create_secret(
    State(state): State<AppState>,
    Json(req): Json<CreateReq>,
) -> Result<(StatusCode, Json<CreateResp>), (StatusCode, Json<ApiError>)> {
    if req.ciphertext.is_empty() || req.nonce.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "empty payload"));
    }
    if req.ciphertext.len() > state.max_ciphertext_chars {
        return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "ciphertext too large"));
    }
    if req.expires_in < MIN_EXPIRES || req.expires_in > MAX_EXPIRES {
        return Err(err(StatusCode::BAD_REQUEST, "expires_in out of range"));
    }
    if let Some(v) = req.max_views {
        if v < 1 {
            return Err(err(StatusCode::BAD_REQUEST, "max_views must be >= 1"));
        }
    }

    let now = now_secs();
    let expires_at = now + req.expires_in;
    let kind = normalize_kind(&req.kind);
    let size = (req.ciphertext.len() + req.nonce.len()) as i64;

    // Generate a short random ID, retrying on the astronomically unlikely event
    // of a primary-key collision.
    for _ in 0..6 {
        let id = generate_id();
        let res = sqlx::query(
            "INSERT INTO secrets (id, ciphertext, nonce, created_at, expires_at, max_views, views, kind, size) \
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
        )
        .bind(&id)
        .bind(&req.ciphertext)
        .bind(&req.nonce)
        .bind(now)
        .bind(expires_at)
        .bind(req.max_views)
        .bind(kind)
        .bind(size)
        .execute(&state.pool)
        .await;

        match res {
            Ok(_) => {
                bump(&state.pool, "created_total", 1).await;
                bump(&state.pool, &format!("created_{kind}"), 1).await;
                bump(&state.pool, "bytes_created_total", size).await;
                // Per-day time series (day derived in UTC by SQLite).
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
                return Ok((StatusCode::CREATED, Json(CreateResp { id })));
            }
            Err(sqlx::Error::Database(e)) if e.is_unique_violation() => continue,
            Err(e) => {
                tracing::error!("insert failed: {e}");
                return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "storage error"));
            }
        }
    }

    Err(err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "could not allocate id",
    ))
}

pub(crate) async fn read_secret(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    let now = now_secs();

    // Atomically claim one view. The row is only returned if it still exists,
    // has not expired, is ready (fully uploaded), and has views remaining. This
    // closes the race where two readers could both fetch the "last" view.
    let row = sqlx::query(
        "UPDATE secrets SET views = views + 1 \
         WHERE id = ? AND expires_at > ? AND status = 'ready' \
           AND (max_views IS NULL OR views < max_views) \
         RETURNING ciphertext, nonce, max_views, views, expires_at, \
                   storage, s3_key, meta, size",
    )
    .bind(&id)
    .bind(now)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!("read update failed: {e}");
        err(StatusCode::INTERNAL_SERVER_ERROR, "storage error")
    })?;

    let Some(row) = row else {
        return Err(err(StatusCode::NOT_FOUND, "not found or expired"));
    };

    let max_views: Option<i64> = row.get("max_views");
    let views: i64 = row.get("views");
    let expires_at: i64 = row.get("expires_at");
    let storage: String = row.get("storage");

    let views_remaining = max_views.map(|m| (m - views).max(0));
    let burning = max_views.map(|m| views >= m).unwrap_or(false);

    bump(&state.pool, "opens_total", 1).await;

    let body = if storage == "s3" {
        // Large-file path: issue a short-lived presigned GET so the recipient
        // streams ciphertext straight from S3. The server never touches bytes.
        let s3_key: Option<String> = row.get("s3_key");
        let meta: Option<String> = row.get("meta");
        let size: i64 = row.get("size");
        let Some(s3) = state.s3.as_ref() else {
            return Err(err(StatusCode::SERVICE_UNAVAILABLE, "s3 not configured"));
        };
        let Some(key) = s3_key else {
            return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "missing s3 key"));
        };
        let url = s3.presign_get(&key, s3.url_ttl).await.map_err(|e| {
            tracing::error!("presign get failed: {e}");
            err(StatusCode::INTERNAL_SERVER_ERROR, "storage error")
        })?;

        // Burn: this was the final allowed view. The view-count guard already
        // makes every later GET a 404, so we don't need the row anymore — but we
        // keep it so the expiry sweeper can still delete the object if the
        // process restarts. We schedule the object deletion after the presigned
        // URL's lifetime, giving this in-flight download time to finish.
        if burning {
            let s3c = s3.clone();
            let grace = s3.url_ttl;
            let key_owned = key.clone();
            tokio::spawn(async move {
                tokio::time::sleep(grace).await;
                s3c.delete(&key_owned).await;
            });
            bump(&state.pool, "burned_total", 1).await;
        }

        serde_json::json!({
            "storage": "s3",
            "url": url,
            "meta": meta,
            "size": size,
            "views_remaining": views_remaining,
            "expires_at": expires_at,
        })
    } else {
        let ciphertext: String = row.get("ciphertext");
        let nonce: String = row.get("nonce");

        // Burn the SQLite secret row once the final view has been served (frees
        // the ciphertext immediately; nothing to delete in object storage).
        if burning {
            let _ = sqlx::query("DELETE FROM secrets WHERE id = ?")
                .bind(&id)
                .execute(&state.pool)
                .await;
            bump(&state.pool, "burned_total", 1).await;
        }

        serde_json::json!({
            "ciphertext": ciphertext,
            "nonce": nonce,
            "views_remaining": views_remaining,
            "expires_at": expires_at,
        })
    };

    Ok(Json(body))
}
