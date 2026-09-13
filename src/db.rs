//! SQLite schema, expiry purge, and cleanup loop.

use std::{path::PathBuf, time::Duration};

use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};

use crate::common::*;
use crate::s3::S3Backend;

pub(crate) async fn purge_expired(pool: &SqlitePool, s3: &Option<S3Backend>, now: i64) -> u64 {
    // Best-effort remove S3 objects/aborted uploads for expiring rows before we
    // drop the metadata that tells us where they live.
    if let Some(s3) = s3.as_ref() {
        if let Ok(rows) = sqlx::query(
            "SELECT s3_key, upload_id, status FROM secrets \
             WHERE storage = 's3' AND expires_at <= ? AND s3_key IS NOT NULL",
        )
        .bind(now)
        .fetch_all(pool)
        .await
        {
            for row in rows {
                let key: Option<String> = row.get("s3_key");
                let upload_id: Option<String> = row.get("upload_id");
                let status: String = row.get("status");
                if let Some(key) = key {
                    // Pending uploads were never completed: abort the multipart
                    // so no orphaned parts linger; ready objects get deleted.
                    if status == "pending" {
                        if let Some(uid) = upload_id {
                            s3.abort_multipart(&key, &uid).await;
                        }
                    }
                    s3.delete(&key).await;
                }
            }
        }
    }

    match sqlx::query("DELETE FROM secrets WHERE expires_at <= ?")
        .bind(now)
        .execute(pool)
        .await
    {
        Ok(res) => res.rows_affected(),
        Err(e) => {
            tracing::error!("purge failed: {e}");
            0
        }
    }
}

/// Remove one secret and its S3 object/multipart (if any). Returns whether a
/// row was deleted.
pub(crate) async fn destroy_secret(pool: &SqlitePool, s3: &Option<S3Backend>, id: &str) -> bool {
    let row = sqlx::query(
        "SELECT storage, status, s3_key, upload_id FROM secrets WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some(row) = row {
        let storage: String = row.get("storage");
        if storage == "s3" {
            if let Some(s3) = s3.as_ref() {
                let key: Option<String> = row.get("s3_key");
                let upload_id: Option<String> = row.get("upload_id");
                let status: String = row.get("status");
                if let Some(key) = key {
                    if status == "pending" {
                        if let Some(uid) = upload_id {
                            s3.abort_multipart(&key, &uid).await;
                        }
                    }
                    s3.delete(&key).await;
                }
            }
        }
    }

    match sqlx::query("DELETE FROM secrets WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
    {
        Ok(res) => res.rows_affected() > 0,
        Err(e) => {
            tracing::error!("destroy failed: {e}");
            false
        }
    }
}

/// Periodically purge expired rows so the database does not grow unbounded.
pub(crate) async fn cleanup_loop(pool: SqlitePool, s3: Option<S3Backend>) {
    let mut ticker = tokio::time::interval(Duration::from_secs(60));
    loop {
        ticker.tick().await;
        let now = now_secs();
        let n = purge_expired(&pool, &s3, now).await;
        if n > 0 {
            bump(&pool, "expired_total", n as i64).await;
            tracing::info!("purged {n} expired secrets");
        }
    }
}

pub(crate) async fn init_db(db_path: &str) -> SqlitePool {
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

    // Columns added after the initial schema; ignore "duplicate column" errors
    // so this stays a no-op on an already-migrated database.
    sqlx::query("ALTER TABLE secrets ADD COLUMN kind TEXT")
        .execute(&pool)
        .await
        .ok();
    sqlx::query("ALTER TABLE secrets ADD COLUMN size INTEGER NOT NULL DEFAULT 0")
        .execute(&pool)
        .await
        .ok();

    // S3 large-file backend columns. `storage` distinguishes 'sqlite' (default,
    // ciphertext stored inline) from 's3' (ciphertext lives in the object
    // store). For s3 rows, `status` moves from 'pending' to 'ready' once the
    // multipart upload completes; `meta` carries opaque client stream params.
    for stmt in [
        "ALTER TABLE secrets ADD COLUMN storage TEXT NOT NULL DEFAULT 'sqlite'",
        "ALTER TABLE secrets ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'",
        "ALTER TABLE secrets ADD COLUMN s3_key TEXT",
        "ALTER TABLE secrets ADD COLUMN upload_id TEXT",
        "ALTER TABLE secrets ADD COLUMN meta TEXT",
        "ALTER TABLE secrets ADD COLUMN delete_token_hash TEXT",
    ] {
        sqlx::query(stmt).execute(&pool).await.ok();
    }

    // Lifetime counters that persist even after secrets are burned or expire.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS metrics (\
            name TEXT PRIMARY KEY,\
            value INTEGER NOT NULL DEFAULT 0\
        )",
    )
    .execute(&pool)
    .await
    .expect("failed to create metrics table");

    // Per-day creation time series (UTC), persists after secrets are removed.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS daily_stats (\
            day TEXT PRIMARY KEY,\
            count INTEGER NOT NULL DEFAULT 0,\
            bytes INTEGER NOT NULL DEFAULT 0\
        )",
    )
    .execute(&pool)
    .await
    .expect("failed to create daily_stats table");

    pool
}
