//! End-to-end encrypted, burn-after-reading transfer service.
//!
//! The server is intentionally "blind": it only ever stores opaque ciphertext
//! and a nonce produced by the client. The symmetric key never leaves the
//! browser (it travels in the URL fragment), so the server cannot decrypt any
//! stored payload. It only enforces expiry and view-count limits.

use std::{
    net::SocketAddr,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};
use uuid::Uuid;

const MAX_BODY: usize = 16 * 1024 * 1024; /// TODO: make this configurable via env var
const MIN_EXPIRES: i64 = 60; /// TODO: make this configurable via env var
const MAX_EXPIRES: i64 = 31 * 24 * 3600; /// TODO: make this configurable via env var
const MAX_CIPHERTEXT_CHARS: usize = 16 * 1024 * 1024; /// TODO: make this configurable via env var

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
}

#[derive(Deserialize)]
struct CreateReq {
    ciphertext: String,
    nonce: String,
    expires_in: i64,
    max_views: Option<i64>,
}

#[derive(Serialize)]
struct CreateResp {
    id: String,
}

#[derive(Serialize)]
struct GetResp {
    ciphertext: String,
    nonce: String,
    views_remaining: Option<i64>,
}

#[derive(Serialize)]
struct ApiError {
    error: String,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn err(status: StatusCode, msg: &str) -> (StatusCode, Json<ApiError>) {
    (
        status,
        Json(ApiError {
            error: msg.to_string(),
        }),
    )
}

async fn health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

async fn create_secret(
    State(state): State<AppState>,
    Json(req): Json<CreateReq>,
) -> Result<(StatusCode, Json<CreateResp>), (StatusCode, Json<ApiError>)> {
    if req.ciphertext.is_empty() || req.nonce.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "empty payload"));
    }
    if req.ciphertext.len() > MAX_CIPHERTEXT_CHARS {
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

    let id = Uuid::new_v4().to_string();
    let now = now_secs();
    let expires_at = now + req.expires_in;

    sqlx::query(
        "INSERT INTO secrets (id, ciphertext, nonce, created_at, expires_at, max_views, views) \
         VALUES (?, ?, ?, ?, ?, ?, 0)",
    )
    .bind(&id)
    .bind(&req.ciphertext)
    .bind(&req.nonce)
    .bind(now)
    .bind(expires_at)
    .bind(req.max_views)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!("insert failed: {e}");
        err(StatusCode::INTERNAL_SERVER_ERROR, "storage error")
    })?;

    Ok((StatusCode::CREATED, Json(CreateResp { id })))
}

async fn read_secret(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<GetResp>, (StatusCode, Json<ApiError>)> {
    let now = now_secs();

    // Atomically claim one view. The row is only returned if it still exists,
    // has not expired, and has views remaining. This closes the race where two
    // readers could both fetch the "last" view.
    let row = sqlx::query(
        "UPDATE secrets SET views = views + 1 \
         WHERE id = ? AND expires_at > ? AND (max_views IS NULL OR views < max_views) \
         RETURNING ciphertext, nonce, max_views, views",
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

    let ciphertext: String = row.get("ciphertext");
    let nonce: String = row.get("nonce");
    let max_views: Option<i64> = row.get("max_views");
    let views: i64 = row.get("views");

    let views_remaining = max_views.map(|m| (m - views).max(0));

    // Burn the secret once the final view has been served.
    if let Some(m) = max_views {
        if views >= m {
            let _ = sqlx::query("DELETE FROM secrets WHERE id = ?")
                .bind(&id)
                .execute(&state.pool)
                .await;
        }
    }

    Ok(Json(GetResp {
        ciphertext,
        nonce,
        views_remaining,
    }))
}

/// Periodically purge expired rows so the database does not grow unbounded.
async fn cleanup_loop(pool: SqlitePool) {
    let mut ticker = tokio::time::interval(Duration::from_secs(60));
    loop {
        ticker.tick().await;
        let now = now_secs();
        match sqlx::query("DELETE FROM secrets WHERE expires_at <= ?")
            .bind(now)
            .execute(&pool)
            .await
        {
            Ok(res) if res.rows_affected() > 0 => {
                tracing::info!("purged {} expired secrets", res.rows_affected());
            }
            Ok(_) => {}
            Err(e) => tracing::error!("cleanup failed: {e}"),
        }
    }
}

async fn init_db(db_path: &str) -> SqlitePool {
    let path = PathBuf::from(db_path);
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).expect("failed to create database directory");
    }

    let opts = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .expect("failed to open database");

    sqlx::query("PRAGMA journal_mode = WAL;")
        .execute(&pool)
        .await
        .ok();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS secrets (\
            id TEXT PRIMARY KEY,\
            ciphertext TEXT NOT NULL,\
            nonce TEXT NOT NULL,\
            created_at INTEGER NOT NULL,\
            expires_at INTEGER NOT NULL,\
            max_views INTEGER,\
            views INTEGER NOT NULL DEFAULT 0\
        )",
    )
    .execute(&pool)
    .await
    .expect("failed to create table");

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_secrets_expires ON secrets(expires_at)")
        .execute(&pool)
        .await
        .ok();

    pool
}

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tresorpost=info,tower_http=info".into()),
        )
        .init();

    let db_path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| "db/data.db".to_string());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".to_string());

    let pool = init_db(&db_path).await;
    tokio::spawn(cleanup_loop(pool.clone()));

    let state = AppState { pool };

    let api = Router::new()
        .route("/health", get(health))
        .route("/secrets", post(create_secret))
        .route("/secrets/{id}", get(read_secret))
        .layer(DefaultBodyLimit::max(MAX_BODY));

    let mut app = Router::new().nest("/api", api);

    // Serve the built SPA when present, falling back to index.html so that
    // client-side routes (e.g. /v/<id>) resolve to the app shell.
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
