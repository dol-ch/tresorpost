//! S3 multipart upload orchestration (presign, complete, abort).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
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
}

fn default_allow_delete_upload() -> bool {
    true
}

#[derive(Serialize)]
pub(crate) struct UploadInitResp {
    id: String,
    upload_id: String,
    part_size: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    delete_token: Option<String>,
}

pub(crate) async fn upload_init(
    State(state): State<AppState>,
    Json(req): Json<UploadInitReq>,
) -> Result<(StatusCode, Json<UploadInitResp>), (StatusCode, Json<ApiError>)> {
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

    let now = now_secs();
    let expires_at = now + req.expires_in;
    let kind = normalize_kind(&req.kind);
    let s3_key = S3Backend::random_key();
    let delete_token = req.allow_delete.then(generate_delete_token);
    let delete_hash = delete_token.as_deref().map(hash_delete_token);

    let upload_id = s3.create_multipart(&s3_key).await.map_err(|e| {
        tracing::error!("{e}");
        err(StatusCode::BAD_GATEWAY, "could not start upload")
    })?;

    for _ in 0..6 {
        let id = generate_id();
        let res = sqlx::query(
            "INSERT INTO secrets \
             (id, ciphertext, nonce, created_at, expires_at, max_views, views, kind, size, \
              storage, status, s3_key, upload_id, meta, delete_token_hash) \
             VALUES (?, '', '', ?, ?, ?, 0, ?, ?, 's3', 'pending', ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(now)
        .bind(expires_at)
        .bind(req.max_views)
        .bind(kind)
        .bind(req.total_size)
        .bind(&s3_key)
        .bind(&upload_id)
        .bind(&req.meta)
        .bind(&delete_hash)
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
                    }),
                ));
            }
            Err(sqlx::Error::Database(e)) if e.is_unique_violation() => continue,
            Err(e) => {
                tracing::error!("upload init insert failed: {e}");
                s3.abort_multipart(&s3_key, &upload_id).await;
                return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "storage error"));
            }
        }
    }

    s3.abort_multipart(&s3_key, &upload_id).await;
    Err(err(StatusCode::INTERNAL_SERVER_ERROR, "could not allocate id"))
}

#[derive(Deserialize)]
pub(crate) struct PartUrlReq {
    part_number: i32,
}

#[derive(Serialize)]
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
        _ => Err(err(StatusCode::INTERNAL_SERVER_ERROR, "missing upload state")),
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
        s3.abort_multipart(&key, &upload_id).await;
        let _ = sqlx::query("DELETE FROM secrets WHERE id = ? AND status = 'pending'")
            .bind(&id)
            .execute(&state.pool)
            .await;
        return Err(err(StatusCode::BAD_GATEWAY, "could not complete upload"));
    }

    // Flip to ready and record the creation stats now that bytes are durable.
    let now = now_secs();
    let row = sqlx::query(
        "UPDATE secrets SET status = 'ready' \
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
