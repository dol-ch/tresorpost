//! End-to-end encrypted, burn-after-reading transfer service.
//!
//! The server is intentionally "blind": it only ever stores opaque ciphertext
//! and a nonce produced by the client. The symmetric key never leaves the
//! browser (it travels in the URL fragment), so the server cannot decrypt any
//! stored payload. It only enforces expiry and view-count limits.

use std::{net::SocketAddr, path::PathBuf};

use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};

mod admin;
mod common;
mod db;
mod s3;
mod secrets;
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

    let pool = db::init_db(&db_path).await;
    tokio::spawn(db::cleanup_loop(pool.clone(), s3.clone()));

    let state = AppState {
        pool,
        db_path: db_path.clone(),
        admin_token,
        max_file_bytes: max_file_bytes as i64,
        max_ciphertext_chars,
        s3,
    };

    let api = Router::new()
        .route("/health", get(secrets::health))
        .route("/config", get(secrets::config))
        .route("/secrets", post(secrets::create_secret))
        .route("/secrets/{id}", get(secrets::read_secret))
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
        let index = dist.join("index.html");
        app = app.fallback_service(ServeDir::new(&dist).fallback(
            tower_http::services::ServeFile::new(index),
        ));
        tracing::info!("serving static frontend from {static_dir}");
    } else {
        tracing::info!("no built frontend at {static_dir}; API only");
    }

    let app = app
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
