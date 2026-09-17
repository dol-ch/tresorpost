//! SQLite schema, expiry purge, storage quotas, and cleanup loop.

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    time::Duration,
};

use axum::{Json, http::StatusCode};
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

use crate::common::*;
use crate::s3::S3Backend;

/// How often the background sweeper runs.
const SWEEP_SECS: u64 = 60;
/// List-and-reap orphan S3 keys every N sweeps (~5 minutes at 60s).
const ORPHAN_REAP_EVERY_N: u64 = 5;

/// Result of explicit destruction (creator/recipient delete).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DestroyOutcome {
    Deleted,
    Missing,
    /// Object/multipart is still there; row kept so a retry can finish the job.
    RetryLater,
}

pub(crate) async fn purge_expired(
    pool: &SqlitePool,
    s3: &Option<S3Backend>,
    now: i64,
    pending_ttl_secs: i64,
) -> u64 {
    let pending_cutoff = now.saturating_sub(pending_ttl_secs.max(0));
    let rows = match sqlx::query(
        "SELECT id, storage, status, s3_key, upload_id FROM secrets \
         WHERE expires_at <= ?1 \
            OR (purge_after IS NOT NULL AND purge_after <= ?1) \
            OR (status = 'pending' AND created_at <= ?2)",
    )
    .bind(now)
    .bind(pending_cutoff)
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!("purge select failed: {e}");
            return 0;
        }
    };

    let mut deleted: u64 = 0;
    for row in rows {
        let id: String = row.get("id");
        let storage: String = row.get("storage");
        let status: String = row.get("status");
        let key: Option<String> = row.get("s3_key");
        let upload_id: Option<String> = row.get("upload_id");

        if storage == "s3" && key.is_some() {
            let Some(s3) = s3.as_ref() else {
                tracing::warn!("purge skipped {id}: S3 object present but backend disabled");
                continue;
            };
            if !remove_s3_payload(s3, &status, key.as_deref(), upload_id.as_deref()).await {
                continue;
            }
        }

        match sqlx::query("DELETE FROM secrets WHERE id = ?")
            .bind(&id)
            .execute(pool)
            .await
        {
            Ok(res) if res.rows_affected() > 0 => deleted += 1,
            Ok(_) => {}
            Err(e) => tracing::error!("purge delete failed for {id}: {e}"),
        }
    }

    if deleted > 0 {
        reclaim_sqlite(pool).await;
    }
    deleted
}

/// Delete S3 object / abort multipart. `true` if gone (or already missing).
async fn remove_s3_payload(
    s3: &S3Backend,
    status: &str,
    key: Option<&str>,
    upload_id: Option<&str>,
) -> bool {
    let Some(key) = key else {
        return true;
    };
    let mut ok = true;
    if status == "pending"
        && let Some(uid) = upload_id
    {
        ok = s3.abort_multipart(key, uid).await;
    }
    ok && s3.delete_object(key).await
}

/// Remove one secret and its S3 object/multipart (if any). The SQLite row is
/// kept when object delete fails so a later retry can finish cleanup.
pub(crate) async fn destroy_secret(
    pool: &SqlitePool,
    s3: &Option<S3Backend>,
    id: &str,
) -> DestroyOutcome {
    let row = sqlx::query("SELECT storage, status, s3_key, upload_id FROM secrets WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

    let Some(row) = row else {
        return DestroyOutcome::Missing;
    };

    let storage: String = row.get("storage");
    if storage == "s3" {
        let key: Option<String> = row.get("s3_key");
        let upload_id: Option<String> = row.get("upload_id");
        let status: String = row.get("status");
        if key.is_some() {
            let Some(s3) = s3.as_ref() else {
                return DestroyOutcome::RetryLater;
            };
            if !remove_s3_payload(s3, &status, key.as_deref(), upload_id.as_deref()).await {
                return DestroyOutcome::RetryLater;
            }
        }
    }

    match sqlx::query("DELETE FROM secrets WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
    {
        Ok(res) if res.rows_affected() > 0 => {
            reclaim_sqlite(pool).await;
            DestroyOutcome::Deleted
        }
        Ok(_) => DestroyOutcome::Missing,
        Err(e) => {
            tracing::error!("destroy failed: {e}");
            DestroyOutcome::RetryLater
        }
    }
}

/// Delete bucket keys under `tresorpost/` that no secret row still references.
pub(crate) async fn reap_orphan_objects(pool: &SqlitePool, s3: &S3Backend) -> u64 {
    let keys = match s3.list_object_keys().await {
        Ok(k) => k,
        Err(e) => {
            tracing::warn!("orphan list failed: {e}");
            return 0;
        }
    };

    let mut known: HashSet<String> = HashSet::new();
    if let Ok(rows) = sqlx::query("SELECT s3_key FROM secrets WHERE s3_key IS NOT NULL")
        .fetch_all(pool)
        .await
    {
        for row in rows {
            if let Some(k) = row.get::<Option<String>, _>("s3_key") {
                known.insert(k);
            }
        }
    }

    let mut n = 0u64;
    for key in keys {
        if known.contains(&key) {
            continue;
        }
        if s3.delete_object(&key).await {
            n += 1;
        }
    }
    if n > 0 {
        tracing::info!("reaped {n} orphan S3 objects");
    }
    n
}

async fn reclaim_sqlite(pool: &SqlitePool) {
    if let Err(e) = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE);")
        .execute(pool)
        .await
    {
        tracing::warn!("wal_checkpoint failed: {e}");
    }
    if let Err(e) = sqlx::query("PRAGMA incremental_vacuum;")
        .execute(pool)
        .await
    {
        tracing::warn!("incremental_vacuum failed: {e}");
    }
}

/// Periodically purge expired / burned / stale-pending rows and (less often)
/// reap S3 keys that have no matching secret row.
pub(crate) async fn cleanup_loop(pool: SqlitePool, s3: Option<S3Backend>, pending_ttl_secs: i64) {
    let mut ticker = tokio::time::interval(Duration::from_secs(SWEEP_SECS));
    let mut ticks: u64 = 0;
    loop {
        ticker.tick().await;
        ticks += 1;
        let now = now_secs();
        let n = purge_expired(&pool, &s3, now, pending_ttl_secs).await;
        if n > 0 {
            bump(&pool, "expired_total", n as i64).await;
            tracing::info!("purged {n} expired secrets");
        }
        if ticks.is_multiple_of(ORPHAN_REAP_EVERY_N)
            && let Some(s3) = s3.as_ref()
        {
            let _ = reap_orphan_objects(&pool, s3).await;
        }
    }
}

/// Sum the sizes of the SQLite database file and its WAL/SHM sidecars.
pub(crate) fn db_file_bytes(db_path: &str) -> u64 {
    ["", "-wal", "-shm"]
        .iter()
        .filter_map(|suffix| std::fs::metadata(format!("{db_path}{suffix}")).ok())
        .map(|m| m.len())
        .sum()
}

pub(crate) fn enforce_sqlite_quota(
    db_path: &str,
    max_bytes: u64,
    additional: u64,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    if max_bytes == 0 {
        return Ok(());
    }
    let used = db_file_bytes(db_path);
    if used.saturating_add(additional) > max_bytes {
        return Err(err(
            StatusCode::INSUFFICIENT_STORAGE,
            "storage quota exceeded",
        ));
    }
    Ok(())
}

pub(crate) async fn s3_live_bytes(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COALESCE(SUM(size), 0) FROM secrets WHERE s3_key IS NOT NULL")
        .fetch_one(pool)
        .await
        .unwrap_or(0)
}

pub(crate) async fn enforce_s3_quota(
    pool: &SqlitePool,
    max_bytes: u64,
    additional: i64,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    if max_bytes == 0 {
        return Ok(());
    }
    let used = s3_live_bytes(pool).await;
    let extra = additional.max(0) as u64;
    if (used.max(0) as u64).saturating_add(extra) > max_bytes {
        return Err(err(
            StatusCode::INSUFFICIENT_STORAGE,
            "object storage quota exceeded",
        ));
    }
    Ok(())
}

pub(crate) fn pending_expires_at(now: i64, secret_expires_in: i64, pending_ttl_secs: i64) -> i64 {
    let secret = now.saturating_add(secret_expires_in);
    let pending = now.saturating_add(pending_ttl_secs.max(MIN_EXPIRES));
    secret.min(pending)
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
    // Best-effort: for a brand-new file this takes effect before CREATE TABLE.
    // Existing databases keep their current auto_vacuum mode unless VACUUM'd.
    sqlx::query("PRAGMA auto_vacuum = INCREMENTAL;")
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

    sqlx::query("ALTER TABLE secrets ADD COLUMN kind TEXT")
        .execute(&pool)
        .await
        .ok();
    sqlx::query("ALTER TABLE secrets ADD COLUMN size INTEGER NOT NULL DEFAULT 0")
        .execute(&pool)
        .await
        .ok();

    for stmt in [
        "ALTER TABLE secrets ADD COLUMN storage TEXT NOT NULL DEFAULT 'sqlite'",
        "ALTER TABLE secrets ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'",
        "ALTER TABLE secrets ADD COLUMN s3_key TEXT",
        "ALTER TABLE secrets ADD COLUMN upload_id TEXT",
        "ALTER TABLE secrets ADD COLUMN meta TEXT",
        "ALTER TABLE secrets ADD COLUMN delete_token_hash TEXT",
        "ALTER TABLE secrets ADD COLUMN recipient_delete_hash TEXT",
        "ALTER TABLE secrets ADD COLUMN purge_after INTEGER",
    ] {
        sqlx::query(stmt).execute(&pool).await.ok();
    }

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_secrets_purge_after ON secrets(purge_after)")
        .execute(&pool)
        .await
        .ok();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS metrics (\
            name TEXT PRIMARY KEY,\
            value INTEGER NOT NULL DEFAULT 0\
        )",
    )
    .execute(&pool)
    .await
    .expect("failed to create metrics table");

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

pub(crate) async fn load_metrics(pool: &SqlitePool) -> HashMap<String, i64> {
    let mut m: HashMap<String, i64> = HashMap::new();
    if let Ok(rows) = sqlx::query("SELECT name, value FROM metrics")
        .fetch_all(pool)
        .await
    {
        for row in rows {
            m.insert(row.get("name"), row.get("value"));
        }
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db_path() -> (String, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "tresorpost-test-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("data.db");
        (path.to_string_lossy().into_owned(), dir)
    }

    #[test]
    fn pending_expires_caps_at_ttl() {
        let now = 1_000_000;
        assert_eq!(
            pending_expires_at(now, 31 * 24 * 3600, 6 * 3600),
            now + 6 * 3600
        );
        assert_eq!(pending_expires_at(now, 60, 6 * 3600), now + 60);
    }

    #[test]
    fn sqlite_quota_unlimited_when_zero() {
        assert!(enforce_sqlite_quota("/nonexistent", 0, 1_000_000).is_ok());
    }

    #[tokio::test]
    async fn purge_expired_sqlite_row_and_skip_s3_without_backend() {
        let (path, dir) = test_db_path();
        let pool = init_db(&path).await;
        let now = now_secs();

        sqlx::query(
            "INSERT INTO secrets (id, ciphertext, nonce, created_at, expires_at, views, kind, size, storage, status) \
             VALUES ('gone', 'c', 'n', ?, ?, 0, 'text', 2, 'sqlite', 'ready')",
        )
        .bind(now - 10)
        .bind(now - 1)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO secrets (id, ciphertext, nonce, created_at, expires_at, views, kind, size, storage, status, s3_key) \
             VALUES ('s3row', '', '', ?, ?, 0, 'file', 9, 's3', 'ready', 'tresorpost/orphan')",
        )
        .bind(now - 10)
        .bind(now - 1)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO secrets (id, ciphertext, nonce, created_at, expires_at, views, max_views, kind, size, storage, status, s3_key, purge_after) \
             VALUES ('burned', '', '', ?, ?, 1, 1, 'file', 4, 's3', 'ready', 'tresorpost/burn', ?)",
        )
        .bind(now - 10)
        .bind(now + 86_400)
        .bind(now - 1)
        .execute(&pool)
        .await
        .unwrap();

        let n = purge_expired(&pool, &None, now, 6 * 3600).await;
        assert_eq!(
            n, 1,
            "only the sqlite row should be dropped without an S3 backend"
        );

        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM secrets")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(left, 2);

        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM secrets ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(ids, vec!["burned".to_string(), "s3row".to_string()]);

        drop(pool);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn pending_stale_sqlite_row_is_purged_by_created_at() {
        let (path, dir) = test_db_path();
        let pool = init_db(&path).await;
        let now = now_secs();
        sqlx::query(
            "INSERT INTO secrets (id, ciphertext, nonce, created_at, expires_at, views, kind, size, storage, status) \
             VALUES ('stale', '', '', ?, ?, 0, 'file', 1, 'sqlite', 'pending')",
        )
        .bind(now - 7 * 3600)
        .bind(now + 30 * 24 * 3600)
        .execute(&pool)
        .await
        .unwrap();

        let n = purge_expired(&pool, &None, now, 6 * 3600).await;
        assert_eq!(n, 1);
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM secrets")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(left, 0);
        drop(pool);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn destroy_keeps_s3_row_when_backend_missing() {
        let (path, dir) = test_db_path();
        let pool = init_db(&path).await;
        let now = now_secs();
        sqlx::query(
            "INSERT INTO secrets (id, ciphertext, nonce, created_at, expires_at, views, kind, size, storage, status, s3_key) \
             VALUES ('keep', '', '', ?, ?, 0, 'file', 1, 's3', 'ready', 'tresorpost/x')",
        )
        .bind(now)
        .bind(now + 60)
        .execute(&pool)
        .await
        .unwrap();

        let out = destroy_secret(&pool, &None, "keep").await;
        assert_eq!(out, DestroyOutcome::RetryLater);
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM secrets WHERE id = 'keep'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(left, 1);
        drop(pool);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn metrics_increment_without_scanning_secrets() {
        let (path, dir) = test_db_path();
        let pool = init_db(&path).await;
        bump(&pool, "created_total", 2).await;
        bump(&pool, "created_image", 1).await;
        bump(&pool, "created_file", 1).await;
        bump(&pool, "bytes_created_total", 3_000).await;
        let m = load_metrics(&pool).await;
        assert_eq!(m.get("created_total").copied().unwrap_or(0), 2);
        assert_eq!(m.get("created_image").copied().unwrap_or(0), 1);
        assert_eq!(m.get("created_file").copied().unwrap_or(0), 1);
        assert_eq!(m.get("bytes_created_total").copied().unwrap_or(0), 3_000);
        let secrets: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM secrets")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(secrets, 0);
        drop(pool);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn s3_quota_sums_pending_and_ready() {
        let (path, dir) = test_db_path();
        let pool = init_db(&path).await;
        let now = now_secs();
        sqlx::query(
            "INSERT INTO secrets (id, ciphertext, nonce, created_at, expires_at, views, kind, size, storage, status, s3_key) \
             VALUES ('a', '', '', ?, ?, 0, 'file', 100, 's3', 'pending', 'tresorpost/a'), \
                    ('b', '', '', ?, ?, 0, 'file', 50, 's3', 'ready', 'tresorpost/b')",
        )
        .bind(now)
        .bind(now + 60)
        .bind(now)
        .bind(now + 60)
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(s3_live_bytes(&pool).await, 150);
        assert!(enforce_s3_quota(&pool, 200, 40).await.is_ok());
        assert!(enforce_s3_quota(&pool, 200, 51).await.is_err());
        assert!(enforce_s3_quota(&pool, 0, 9_000).await.is_ok());
        drop(pool);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
