//! End-to-end encrypted, burn-after-reading transfer service.
//!

use std::{net::SocketAddr, path::PathBuf, sync::Arc};

use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};
use tower_http::{services::ServeDir, trace::TraceLayer};

mod admin;
mod common;
mod db;
mod host;
mod mail;
mod rate;
mod s3;
mod secrets;
mod seo;
mod uploads;

use common::*;
use s3::S3Backend;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tresorpost=info,tower_http=info".into()),
        )
        .init();

    let max_file_mb: u64 = std::env::var("MAX_FILE_MB")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&mb| mb >= 1)
        .unwrap_or(DEFAULT_MAX_FILE_MB);
    let max_file_bytes = max_file_mb * 1024 * 1024;
    let (body_limit, max_ciphertext_chars) = derive_limits(max_file_bytes);
    tracing::info!("max attachment size: {max_file_mb} MB");

    let max_s3_file_mb: u64 = std::env::var("MAX_S3_FILE_MB")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&mb| mb >= 1)
        .unwrap_or(DEFAULT_MAX_S3_FILE_MB);
    let max_s3_file_bytes = (max_s3_file_mb * 1024 * 1024) as i64;
    let s3 = S3Backend::from_env(max_s3_file_bytes);
    if s3.is_some() {
        tracing::info!("max S3 file size: {max_s3_file_mb} MB");
    }

    let db_path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| "db/data.db".to_string());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".to_string());
    let admin_token = std::env::var("ADMIN_TOKEN").ok().filter(|t| !t.is_empty());
    if admin_token.is_some() {
        tracing::info!("admin stats endpoint enabled at /api/admin/stats");
    } else {
        tracing::info!("ADMIN_TOKEN not set — admin stats endpoint disabled");
    }

    let max_sqlite_mb: u64 = std::env::var("MAX_SQLITE_MB")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_MAX_SQLITE_MB);
    let max_sqlite_bytes = max_sqlite_mb.saturating_mul(1024 * 1024);
    if max_sqlite_mb == 0 {
        tracing::info!("SQLite storage quota disabled (MAX_SQLITE_MB=0)");
    } else {
        tracing::info!("SQLite storage quota: {max_sqlite_mb} MB");
    }

    let max_s3_gb: u64 = std::env::var("MAX_S3_GB")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_MAX_S3_GB);
    let max_s3_bytes = max_s3_gb.saturating_mul(1024 * 1024 * 1024);
    if max_s3_gb == 0 {
        tracing::info!("S3 storage quota disabled (MAX_S3_GB=0)");
    } else {
        tracing::info!("S3 storage quota: {max_s3_gb} GB");
    }

    let pending_upload_ttl_secs: i64 = std::env::var("PENDING_UPLOAD_TTL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&s| s >= 1)
        .unwrap_or(DEFAULT_PENDING_UPLOAD_TTL_SECS);
    tracing::info!("pending upload TTL: {pending_upload_ttl_secs}s");

    tracing::info!("sqlite database: {db_path}");
    let pool = db::init_db(&db_path).await;
    tokio::spawn(db::cleanup_loop(
        pool.clone(),
        s3.clone(),
        pending_upload_ttl_secs,
    ));

    let create_limiter = rate::CreateLimiter::from_env();
    if create_limiter.disabled() {
        tracing::info!("create rate limit disabled (CREATE_RATE_LIMIT=0)");
    } else {
        tracing::info!(
            max = create_limiter.max(),
            window_secs = create_limiter.window_secs(),
            "create rate limit enabled"
        );
    }

    let read_limiter = rate::ReadLimiter::from_env();
    if read_limiter.disabled() {
        tracing::info!("read rate limit disabled (READ_RATE_LIMIT=0)");
    } else {
        tracing::info!(
            max = read_limiter.max(),
            window_secs = read_limiter.window_secs(),
            "read/delete rate limit enabled"
        );
    }

    let email_limiter = rate::EmailLimiter::from_env();
    if email_limiter.disabled() {
        tracing::info!("share-email rate limit disabled (EMAIL_RATE_LIMIT=0)");
    } else {
        tracing::info!(
            max = email_limiter.max(),
            window_secs = email_limiter.window_secs(),
            "share-email rate limit enabled"
        );
    }

    let mailer = mail::Mailer::from_env();
    if mailer.is_some() {
        tracing::info!("share-email SMTP enabled");
    } else {
        tracing::info!("share-email SMTP not configured — email UI disabled");
    }

    if let Some(short) = host::short_domain_host() {
        if let Some(public) = host::public_origin() {
            tracing::info!("SHORT_DOMAIN={short} redirects to {public}");
        } else {
            tracing::warn!("SHORT_DOMAIN is set but PUBLIC_URL is missing — no canonical redirect");
        }
    }

    let admin_auth_limiter = rate::AdminAuthLimiter::from_env();
    if admin_auth_limiter.disabled() {
        tracing::info!("admin auth failure limit disabled (ADMIN_AUTH_MAX_FAILURES=0)");
    } else {
        tracing::info!(
            max = admin_auth_limiter.max(),
            window_secs = admin_auth_limiter.window_secs(),
            "admin auth failure limit enabled"
        );
    }

    let state = AppState {
        pool,
        db_path: db_path.clone(),
        admin_token,
        max_file_bytes: max_file_bytes as i64,
        max_ciphertext_chars,
        s3,
        create_limiter,
        read_limiter,
        email_limiter,
        mailer,
        admin_auth_limiter,
        max_sqlite_bytes,
        max_s3_bytes,
        pending_upload_ttl_secs,
    };

    let api = Router::new()
        .route("/health", get(secrets::health))
        .route("/config", get(secrets::config))
        .route("/stats", get(secrets::public_stats))
        .route("/secrets", post(secrets::create_secret))
        .route("/share-email", post(mail::send_share_email))
        .route("/secrets/{id}", get(secrets::read_secret).delete(secrets::delete_secret))
        .route("/uploads/init", post(uploads::upload_init))
        .route("/uploads/{id}/part-url", post(uploads::upload_part_url))
        .route("/uploads/{id}/complete", post(uploads::upload_complete))
        .route("/admin/stats", get(admin::admin_stats))
        .route("/admin/active", get(admin::admin_active))
        .route("/admin/purge", post(admin::admin_purge))
        .layer(DefaultBodyLimit::max(body_limit));

    let mut app = Router::new().nest("/api", api);

    let dist = PathBuf::from(&static_dir);
    if dist.join("index.html").exists() {
        let index_html = std::fs::read_to_string(dist.join("index.html"))
            .expect("readable frontend/dist/index.html");
        app = app.fallback_service(
            ServeDir::new(&dist).fallback(seo::SpaIndex(Arc::new(index_html))),
        );
        tracing::info!("serving static frontend from {static_dir}");
    } else {
        tracing::info!("no built frontend at {static_dir}; API only");
    }

    let app = security_headers_layer(app)
        .layer(TraceLayer::new_for_http())
        .layer(axum::middleware::from_fn(host::short_domain_redirect))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
