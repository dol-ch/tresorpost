//! Token-protected admin stats, active listing, and purge.

use std::{collections::HashMap, net::SocketAddr};

use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
};
use serde::Serialize;
use sqlx::Row;

use crate::common::*;
use crate::db::{db_file_bytes, purge_expired};

pub(crate) fn check_admin(
    state: &AppState,
    headers: &HeaderMap,
    peer: ConnectInfo<SocketAddr>,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    let Some(expected) = state.admin_token.as_deref() else {
        return Err(err(StatusCode::NOT_FOUND, "admin disabled"));
    };
    let ip = crate::rate::client_ip(headers, peer.0);
    if let Err(secs) = state.admin_auth_limiter.check(ip) {
        return Err(err(
            StatusCode::TOO_MANY_REQUESTS,
            &format!("too many failed admin logins, retry in {secs}s"),
        ));
    }
    let provided = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if provided.is_empty() || !constant_time_eq_str(provided, expected) {
        state.admin_auth_limiter.record_failure(ip);
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

pub(crate) async fn admin_stats(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<AdminStats>, (StatusCode, Json<ApiError>)> {
    check_admin(&state, &headers, ConnectInfo(peer))?;

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

pub(crate) async fn admin_purge(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<PurgeResp>, (StatusCode, Json<ApiError>)> {
    check_admin(&state, &headers, ConnectInfo(peer))?;
    let now = now_secs();
    let purged = purge_expired(&state.pool, &state.s3, now, state.pending_upload_ttl_secs).await;
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

pub(crate) async fn admin_active(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<ActiveResp>, (StatusCode, Json<ApiError>)> {
    check_admin(&state, &headers, ConnectInfo(peer))?;
    let now = now_secs();

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM secrets WHERE expires_at > ?")
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;
    use std::net::{Ipv4Addr, SocketAddrV4};

    async fn test_state(admin_token: Option<&str>) -> (AppState, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "tresorpost-admin-test-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("data.db");
        let pool = crate::db::init_db(&path.to_string_lossy()).await;
        let state = AppState {
            pool,
            db_path: path.to_string_lossy().into_owned(),
            admin_token: admin_token.map(|s| s.to_string()),
            max_file_bytes: 5 * 1024 * 1024,
            max_ciphertext_chars: 1_000_000,
            s3: None,
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

    fn peer(n: u8) -> ConnectInfo<SocketAddr> {
        ConnectInfo(SocketAddr::V4(SocketAddrV4::new(
            Ipv4Addr::new(198, 51, 100, n),
            9999,
        )))
    }

    fn headers_with_token(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("x-admin-token", HeaderValue::from_str(token).unwrap());
        h
    }

    #[tokio::test]
    async fn admin_disabled_without_token_env() {
        let (state, dir) = test_state(None).await;
        let result = check_admin(&state, &HeaderMap::new(), peer(1));
        assert_eq!(result.unwrap_err().0, StatusCode::NOT_FOUND);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn correct_token_succeeds() {
        let (state, dir) = test_state(Some("supersecret")).await;
        let result = check_admin(&state, &headers_with_token("supersecret"), peer(2));
        assert!(result.is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn missing_token_header_is_unauthorized() {
        let (state, dir) = test_state(Some("supersecret")).await;
        let result = check_admin(&state, &HeaderMap::new(), peer(3));
        assert_eq!(result.unwrap_err().0, StatusCode::UNAUTHORIZED);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn wrong_token_is_unauthorized_then_rate_limited() {
        let (state, dir) = test_state(Some("supersecret")).await;
        let max = state.admin_auth_limiter.max();
        if max == 0 {
            // ADMIN_AUTH_MAX_FAILURES=0 in this environment disables the
            // limiter entirely; nothing to assert about lockout.
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }
        let p = peer(4);
        for _ in 0..max {
            let result = check_admin(&state, &headers_with_token("wrong"), p);
            assert_eq!(result.unwrap_err().0, StatusCode::UNAUTHORIZED);
        }
        // The next attempt is locked out before the token is even compared,
        // even if it happens to be correct.
        let result = check_admin(&state, &headers_with_token("supersecret"), p);
        assert_eq!(result.unwrap_err().0, StatusCode::TOO_MANY_REQUESTS);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn successful_auth_does_not_consume_failure_budget() {
        let (state, dir) = test_state(Some("supersecret")).await;
        let p = peer(5);
        for _ in 0..50 {
            let result = check_admin(&state, &headers_with_token("supersecret"), p);
            assert!(result.is_ok());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
