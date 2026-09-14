//! Token-protected admin stats, active listing, and purge.

use std::collections::HashMap;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Serialize;
use sqlx::Row;

use crate::common::*;
use crate::db::{db_file_bytes, purge_expired};

/// Validate the `x-admin-token` header against the configured token. Returns an
/// error response when admin is disabled or the token is wrong.
pub(crate) fn check_admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    let Some(expected) = state.admin_token.as_deref() else {
        return Err(err(StatusCode::NOT_FOUND, "admin disabled"));
    };
    let provided = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if provided.is_empty() || !constant_time_eq_str(provided, expected) {
        return Err(err(StatusCode::UNAUTHORIZED, "invalid admin token"));
    }
    Ok(())
}

#[derive(Serialize)]
pub(crate) struct DailyPoint {
    day: String,
    count: i64,
    bytes: i64,
}

#[derive(Serialize)]
pub(crate) struct AdminStats {
    active: ActiveStats,
    lifetime: LifetimeStats,
    storage: StorageStats,
    daily: Vec<DailyPoint>,
    generated_at: i64,
}

#[derive(Serialize)]
pub(crate) struct ActiveStats {
    count: i64,
    bytes: i64,
    by_kind: HashMap<String, i64>,
}

#[derive(Serialize)]
pub(crate) struct LifetimeStats {
    created_total: i64,
    by_kind: HashMap<String, i64>,
    bytes_created_total: i64,
    opens_total: i64,
    burned_total: i64,
    expired_total: i64,
}

#[derive(Serialize)]
pub(crate) struct StorageStats {
    db_file_bytes: u64,
    active_bytes: i64,
}

/// Protected admin dashboard stats. Requires the `x-admin-token` header to match
/// the server's `ADMIN_TOKEN`. Only aggregate metadata is exposed — never any
/// ciphertext or key material.
pub(crate) async fn admin_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AdminStats>, (StatusCode, Json<ApiError>)> {
    check_admin(&state, &headers)?;

    let now = now_secs();

    // Creations per day for the last 30 days (days with activity only).
    let mut daily: Vec<DailyPoint> = Vec::new();
    if let Ok(rows) = sqlx::query(
        "SELECT day, count, bytes FROM daily_stats \
         WHERE day >= strftime('%Y-%m-%d', ?, 'unixepoch', '-29 days') ORDER BY day",
    )
    .bind(now)
    .fetch_all(&state.pool)
    .await
    {
        for row in rows {
            daily.push(DailyPoint {
                day: row.get("day"),
                count: row.get("count"),
                bytes: row.get("bytes"),
            });
        }
    }

    // `size` is the base64 ciphertext+nonce length for sqlite rows and the raw
    // object size for s3 rows, so it gives a unified active-bytes figure.
    let (count, bytes): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(size), 0) \
         FROM secrets WHERE expires_at > ?",
    )
    .bind(now)
    .fetch_one(&state.pool)
    .await
    .unwrap_or((0, 0));

    let mut active_by_kind: HashMap<String, i64> = HashMap::new();
    if let Ok(rows) = sqlx::query(
        "SELECT COALESCE(kind, 'unknown') AS k, COUNT(*) AS c \
         FROM secrets WHERE expires_at > ? GROUP BY k",
    )
    .bind(now)
    .fetch_all(&state.pool)
    .await
    {
        for row in rows {
            active_by_kind.insert(row.get("k"), row.get("c"));
        }
    }

    let m = crate::db::load_metrics(&state.pool).await;
    let get_m = |k: &str| m.get(k).copied().unwrap_or(0);

    let mut lifetime_by_kind: HashMap<String, i64> = HashMap::new();
    for k in ["text", "image", "file", "video", "unknown"] {
        lifetime_by_kind.insert(k.to_string(), get_m(&format!("created_{k}")));
    }

    Ok(Json(AdminStats {
        active: ActiveStats {
            count,
            bytes,
            by_kind: active_by_kind,
        },
        lifetime: LifetimeStats {
            created_total: get_m("created_total"),
            by_kind: lifetime_by_kind,
            bytes_created_total: get_m("bytes_created_total"),
            opens_total: get_m("opens_total"),
            burned_total: get_m("burned_total"),
            expired_total: get_m("expired_total"),
        },
        storage: StorageStats {
            db_file_bytes: db_file_bytes(&state.db_path),
            active_bytes: bytes,
        },
        daily,
        generated_at: now,
    }))
}

#[derive(Serialize)]
pub(crate) struct PurgeResp {
    purged: u64,
}

/// Admin action: delete all currently-expired secrets immediately.
pub(crate) async fn admin_purge(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<PurgeResp>, (StatusCode, Json<ApiError>)> {
    check_admin(&state, &headers)?;
    let now = now_secs();
    let purged = purge_expired(
        &state.pool,
        &state.s3,
        now,
        state.pending_upload_ttl_secs,
    )
    .await;
    if purged > 0 {
        bump(&state.pool, "expired_total", purged as i64).await;
    }
    Ok(Json(PurgeResp { purged }))
}

#[derive(Serialize)]
pub(crate) struct ActiveItem {
    id: String,
    kind: String,
    size: i64,
    created_at: i64,
    expires_at: i64,
    views: i64,
    max_views: Option<i64>,
}

#[derive(Serialize)]
pub(crate) struct ActiveResp {
    items: Vec<ActiveItem>,
    total: i64,
}

/// Admin listing of currently-active secrets with their TTL, soonest-expiring
/// first. Exposes only metadata (never ciphertext or keys).
pub(crate) async fn admin_active(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ActiveResp>, (StatusCode, Json<ApiError>)> {
    check_admin(&state, &headers)?;
    let now = now_secs();

    let total: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM secrets WHERE expires_at > ?")
            .bind(now)
            .fetch_one(&state.pool)
            .await
            .unwrap_or(0);

    let mut items: Vec<ActiveItem> = Vec::new();
    if let Ok(rows) = sqlx::query(
        "SELECT id, COALESCE(kind, 'unknown') AS kind, size, created_at, expires_at, views, max_views \
         FROM secrets WHERE expires_at > ? ORDER BY expires_at ASC LIMIT 200",
    )
    .bind(now)
    .fetch_all(&state.pool)
    .await
    {
        for row in rows {
            items.push(ActiveItem {
                id: row.get("id"),
                kind: row.get("kind"),
                size: row.get("size"),
                created_at: row.get("created_at"),
                expires_at: row.get("expires_at"),
                views: row.get("views"),
                max_views: row.get("max_views"),
            });
        }
    }

    Ok(Json(ActiveResp { items, total }))
}
