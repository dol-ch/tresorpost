//! SQLite secret create/read and public config/health endpoints.

use std::net::SocketAddr;

use axum::{
    Json,
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
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
    /// When true, the create-success screen may email the share link via SMTP.
    email_enabled: bool,
    /// When true, view pages may send an abuse report to `ADMIN_REPORT_URL`.
    report_enabled: bool,
}

pub(crate) async fn config(State(state): State<AppState>) -> Json<ConfigResp> {
    Json(ConfigResp {
        max_file_bytes: state.max_file_bytes,
        s3_enabled: state.s3.is_some(),
        max_s3_file_bytes: state.s3.as_ref().map(|s| s.max_file_bytes).unwrap_or(0),
        email_enabled: state.mailer.is_some(),
        report_enabled: state.mailer.is_some() && state.admin_report_to.is_some(),
    })
}

#[derive(Serialize)]
pub(crate) struct PublicStats {
    /// All-time encrypted links that finished creating (including later burned/expired).
    links_created: i64,
    /// All-time ciphertext bytes stored at create time (SQLite body or S3 object size).
    bytes_transferred: i64,
    /// All-time counts for the public kinds. Never includes ids, keys, or ciphertext.
    by_kind: std::collections::HashMap<String, i64>,
}

pub(crate) async fn public_stats(State(state): State<AppState>) -> Json<PublicStats> {
    Json(public_stats_from_metrics(
        crate::db::load_metrics(&state.pool).await,
    ))
}

pub(crate) fn public_stats_from_metrics(m: std::collections::HashMap<String, i64>) -> PublicStats {
    let get_m = |k: &str| m.get(k).copied().unwrap_or(0);
    let mut by_kind = std::collections::HashMap::new();
    for k in ["text", "image", "video", "file"] {
        by_kind.insert(k.to_string(), get_m(&format!("created_{k}")));
    }
    PublicStats {
        links_created: get_m("created_total"),
        bytes_transferred: get_m("bytes_created_total"),
        by_kind,
    }
}

pub(crate) async fn create_secret(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<CreateReq>,
) -> Result<(StatusCode, Json<CreateResp>), (StatusCode, Json<ApiError>)> {
    crate::rate::enforce_create_limit(&state, &headers, ConnectInfo(peer))?;
    if req.ciphertext.is_empty() || req.nonce.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "empty payload"));
    }
    if req.ciphertext.len() > state.max_ciphertext_chars {
        return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "ciphertext too large"));
    }
    if req.expires_in < MIN_EXPIRES || req.expires_in > MAX_EXPIRES {
        return Err(err(StatusCode::BAD_REQUEST, "expires_in out of range"));
    }
    if let Some(v) = req.max_views
        && v < 1
    {
        return Err(err(StatusCode::BAD_REQUEST, "max_views must be >= 1"));
    }

    let now = now_secs();
    let expires_at = now + req.expires_in;
    let kind = normalize_kind(&req.kind);
    let size = (req.ciphertext.len() + req.nonce.len()) as i64;
    crate::db::enforce_sqlite_quota(&state.db_path, state.max_sqlite_bytes, size as u64)?;
    let delete_token = req.allow_delete.then(generate_delete_token);
    let delete_hash = delete_token.as_deref().map(hash_delete_token);
    let recipient_delete_token = req.allow_recipient_delete.then(generate_delete_token);
    let recipient_delete_hash = recipient_delete_token.as_deref().map(hash_delete_token);

    // Generate a short random ID, retrying on the astronomically unlikely event
    // of a primary-key collision.
    for _ in 0..6 {
        let id = generate_id();
        let res = sqlx::query(
            "INSERT INTO secrets (id, ciphertext, nonce, created_at, expires_at, max_views, views, kind, size, delete_token_hash, recipient_delete_hash) \
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&req.ciphertext)
        .bind(&req.nonce)
        .bind(now)
        .bind(expires_at)
        .bind(req.max_views)
        .bind(kind)
        .bind(size)
        .bind(&delete_hash)
        .bind(&recipient_delete_hash)
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
                return Ok((
                    StatusCode::CREATED,
                    Json(CreateResp {
                        id,
                        delete_token,
                        recipient_delete_token,
                    }),
                ));
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
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    crate::rate::enforce_read_limit(&state, &headers, ConnectInfo(peer))?;
    let now = now_secs();

    // Atomic claim closes the race where two readers both fetch the "last" view.
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

        // purge_after lets the sweeper reap this after the URL expires, surviving a restart.
        if burning {
            let purge_after = now.saturating_add(s3.url_ttl.as_secs() as i64);
            let _ = sqlx::query("UPDATE secrets SET purge_after = ? WHERE id = ?")
                .bind(purge_after)
                .bind(&id)
                .execute(&state.pool)
                .await;
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

#[derive(serde::Deserialize)]
pub(crate) struct DeleteReq {
    delete_token: String,
}

/// Destroy with a creator or recipient delete token. The plaintext token is
/// never stored; only SHA-256 hashes are compared. Wrong or missing tokens
/// return the same 404 as an unknown id.
pub(crate) async fn delete_secret(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<DeleteReq>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    crate::rate::enforce_read_limit(&state, &headers, ConnectInfo(peer))?;
    if req.delete_token.is_empty() || req.delete_token.len() > 128 {
        return Err(err(StatusCode::NOT_FOUND, "not found"));
    }

    let row = sqlx::query(
        "SELECT delete_token_hash, recipient_delete_hash FROM secrets \
         WHERE id = ? AND expires_at > ?",
    )
    .bind(&id)
    .bind(now_secs())
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!("delete lookup failed: {e}");
        err(StatusCode::INTERNAL_SERVER_ERROR, "storage error")
    })?;

    let Some(row) = row else {
        return Err(err(StatusCode::NOT_FOUND, "not found"));
    };
    let creator: Option<String> = row.get("delete_token_hash");
    let recipient: Option<String> = row.get("recipient_delete_hash");
    let dummy = "0".repeat(64);
    let a = creator
        .filter(|h| h.len() == 64)
        .unwrap_or_else(|| dummy.clone());
    let b = recipient.filter(|h| h.len() == 64).unwrap_or(dummy);
    if !(delete_token_matches(&a, &req.delete_token) | delete_token_matches(&b, &req.delete_token))
    {
        return Err(err(StatusCode::NOT_FOUND, "not found"));
    }

    match crate::db::destroy_secret(&state.pool, &state.s3, &id).await {
        crate::db::DestroyOutcome::Deleted => {
            bump(&state.pool, "deleted_total", 1).await;
            Ok(StatusCode::NO_CONTENT)
        }
        crate::db::DestroyOutcome::Missing => Ok(StatusCode::NO_CONTENT),
        crate::db::DestroyOutcome::RetryLater => Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "could not delete storage, retry",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn public_stats_are_aggregates_only() {
        let mut m = HashMap::new();
        m.insert("created_total".into(), 12);
        m.insert("bytes_created_total".into(), 1_048_576);
        m.insert("created_text".into(), 7);
        m.insert("created_image".into(), 3);
        m.insert("created_file".into(), 2);
        m.insert("opens_total".into(), 99);
        m.insert("burned_total".into(), 4);
        let stats = public_stats_from_metrics(m);
        let json = serde_json::to_value(&stats).unwrap();
        assert_eq!(json["links_created"], 12);
        assert_eq!(json["bytes_transferred"], 1_048_576);
        assert_eq!(json["by_kind"]["text"], 7);
        assert_eq!(json["by_kind"]["image"], 3);
        assert_eq!(json["by_kind"]["video"], 0);
        assert_eq!(json["by_kind"]["file"], 2);
        assert!(json.get("opens_total").is_none());
        assert!(json.get("burned_total").is_none());
        assert!(json.get("active").is_none());
        assert!(json.get("daily").is_none());
        let s = json.to_string();
        assert!(!s.contains("ciphertext"));
        assert!(!s.contains("admin"));
    }

    #[test]
    fn config_does_not_override_share_link_origin() {
        let json = serde_json::to_value(&ConfigResp {
            max_file_bytes: 1,
            s3_enabled: false,
            max_s3_file_bytes: 0,
            email_enabled: false,
            report_enabled: false,
        })
        .unwrap();
        assert!(json.get("short_origin").is_none());
        assert!(json.get("public_origin").is_none());
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.as_str())
            .collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "email_enabled",
                "max_file_bytes",
                "max_s3_file_bytes",
                "report_enabled",
                "s3_enabled"
            ]
        );
    }
}
