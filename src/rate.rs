//! Per-IP rate limiters (in-memory, per process).

use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    Json,
    extract::ConnectInfo,
    http::{HeaderMap, StatusCode},
};

use crate::common::{ApiError, AppState, err};

/// Default: 60 new notes per IP per hour. `CREATE_RATE_LIMIT=0` disables.
pub(crate) const DEFAULT_CREATE_RATE_LIMIT: u32 = 60;
pub(crate) const DEFAULT_CREATE_RATE_WINDOW_SECS: u64 = 3600;

/// Default: 300 GET/DELETE secret ops per IP per hour. `READ_RATE_LIMIT=0` disables.
pub(crate) const DEFAULT_READ_RATE_LIMIT: u32 = 300;
pub(crate) const DEFAULT_READ_RATE_WINDOW_SECS: u64 = 3600;

/// Default: 10 failed admin logins per IP per hour. `ADMIN_AUTH_MAX_FAILURES=0` disables.
pub(crate) const DEFAULT_ADMIN_AUTH_MAX_FAILURES: u32 = 10;
pub(crate) const DEFAULT_ADMIN_AUTH_WINDOW_SECS: u64 = 3600;

/// Default: 3 share emails per IP per minute. `EMAIL_RATE_LIMIT=0` disables.
pub(crate) const DEFAULT_EMAIL_RATE_LIMIT: u32 = 3;
pub(crate) const DEFAULT_EMAIL_RATE_WINDOW_SECS: u64 = 60;

#[derive(Clone)]
pub(crate) struct Limiter {
    max: u32,
    window: Duration,
    hits: Arc<Mutex<HashMap<IpAddr, Vec<Instant>>>>,
}

impl Limiter {
    fn from_env(max_var: &str, window_var: &str, default_max: u32, default_window: u64) -> Self {
        let max = std::env::var(max_var)
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(default_max);
        let window_secs = std::env::var(window_var)
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|&s| s >= 1)
            .unwrap_or(default_window);
        Self {
            max,
            window: Duration::from_secs(window_secs),
            hits: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    #[cfg(test)]
    fn new(max: u32, window: Duration) -> Self {
        Self {
            max,
            window,
            hits: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) fn disabled(&self) -> bool {
        self.max == 0
    }

    pub(crate) fn max(&self) -> u32 {
        self.max
    }

    pub(crate) fn window_secs(&self) -> u64 {
        self.window.as_secs()
    }

    fn prune_locked(map: &mut HashMap<IpAddr, Vec<Instant>>, window: Duration, now: Instant) {
        if map.len() > 50_000 {
            map.retain(|_, times| {
                times.retain(|t| now.saturating_duration_since(*t) < window);
                !times.is_empty()
            });
        }
    }

    /// Returns `Ok(())` (and records a hit) or seconds until the oldest hit expires.
    pub(crate) fn check(&self, ip: IpAddr) -> Result<(), u64> {
        if self.max == 0 {
            return Ok(());
        }
        let now = Instant::now();
        let mut map = self.hits.lock().unwrap_or_else(|e| e.into_inner());
        Self::prune_locked(&mut map, self.window, now);

        let times = map.entry(ip).or_default();
        times.retain(|t| now.saturating_duration_since(*t) < self.window);
        if times.len() as u32 >= self.max {
            let oldest = times.iter().min().copied().unwrap_or(now);
            let retry = self
                .window
                .saturating_sub(now.saturating_duration_since(oldest))
                .as_secs()
                .max(1);
            return Err(retry);
        }
        times.push(now);
        Ok(())
    }
}

/// Wrapper so create-path call sites stay explicit.
#[derive(Clone)]
pub(crate) struct CreateLimiter(Limiter);

impl CreateLimiter {
    pub(crate) fn from_env() -> Self {
        Self(Limiter::from_env(
            "CREATE_RATE_LIMIT",
            "CREATE_RATE_WINDOW_SECS",
            DEFAULT_CREATE_RATE_LIMIT,
            DEFAULT_CREATE_RATE_WINDOW_SECS,
        ))
    }

    pub(crate) fn disabled(&self) -> bool {
        self.0.disabled()
    }

    pub(crate) fn max(&self) -> u32 {
        self.0.max()
    }

    pub(crate) fn window_secs(&self) -> u64 {
        self.0.window_secs()
    }

    pub(crate) fn check(&self, ip: IpAddr) -> Result<(), u64> {
        self.0.check(ip)
    }
}

/// POST `/api/share-email` and `/api/report` limiter.
#[derive(Clone)]
pub(crate) struct EmailLimiter(Limiter);

impl EmailLimiter {
    pub(crate) fn from_env() -> Self {
        Self(Limiter::from_env(
            "EMAIL_RATE_LIMIT",
            "EMAIL_RATE_WINDOW_SECS",
            DEFAULT_EMAIL_RATE_LIMIT,
            DEFAULT_EMAIL_RATE_WINDOW_SECS,
        ))
    }

    pub(crate) fn disabled(&self) -> bool {
        self.0.disabled()
    }

    pub(crate) fn max(&self) -> u32 {
        self.0.max()
    }

    pub(crate) fn window_secs(&self) -> u64 {
        self.0.window_secs()
    }

    pub(crate) fn check(&self, ip: IpAddr) -> Result<(), u64> {
        self.0.check(ip)
    }
}

/// GET/DELETE `/api/secrets/{id}` limiter. Every request counts.
#[derive(Clone)]
pub(crate) struct ReadLimiter(Limiter);

impl ReadLimiter {
    pub(crate) fn from_env() -> Self {
        Self(Limiter::from_env(
            "READ_RATE_LIMIT",
            "READ_RATE_WINDOW_SECS",
            DEFAULT_READ_RATE_LIMIT,
            DEFAULT_READ_RATE_WINDOW_SECS,
        ))
    }

    pub(crate) fn disabled(&self) -> bool {
        self.0.disabled()
    }

    pub(crate) fn max(&self) -> u32 {
        self.0.max()
    }

    pub(crate) fn window_secs(&self) -> u64 {
        self.0.window_secs()
    }

    pub(crate) fn check(&self, ip: IpAddr) -> Result<(), u64> {
        self.0.check(ip)
    }
}

/// Failed admin-token attempts only. Successful auth does not consume budget.
#[derive(Clone)]
pub(crate) struct AdminAuthLimiter {
    max: u32,
    window: Duration,
    hits: Arc<Mutex<HashMap<IpAddr, Vec<Instant>>>>,
}

impl AdminAuthLimiter {
    pub(crate) fn from_env() -> Self {
        let max = std::env::var("ADMIN_AUTH_MAX_FAILURES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_ADMIN_AUTH_MAX_FAILURES);
        let window_secs = std::env::var("ADMIN_AUTH_WINDOW_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|&s| s >= 1)
            .unwrap_or(DEFAULT_ADMIN_AUTH_WINDOW_SECS);
        Self {
            max,
            window: Duration::from_secs(window_secs),
            hits: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    #[cfg(test)]
    fn new(max: u32, window: Duration) -> Self {
        Self {
            max,
            window,
            hits: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) fn disabled(&self) -> bool {
        self.max == 0
    }

    pub(crate) fn max(&self) -> u32 {
        self.max
    }

    pub(crate) fn window_secs(&self) -> u64 {
        self.window.as_secs()
    }

    /// Does **not** record a hit. Call [`record_failure`] only after a token mismatch.
    pub(crate) fn check(&self, ip: IpAddr) -> Result<(), u64> {
        if self.max == 0 {
            return Ok(());
        }
        let now = Instant::now();
        let mut map = self.hits.lock().unwrap_or_else(|e| e.into_inner());
        Limiter::prune_locked(&mut map, self.window, now);

        let times = map.entry(ip).or_default();
        times.retain(|t| now.saturating_duration_since(*t) < self.window);
        if times.len() as u32 >= self.max {
            let oldest = times.iter().min().copied().unwrap_or(now);
            let retry = self
                .window
                .saturating_sub(now.saturating_duration_since(oldest))
                .as_secs()
                .max(1);
            return Err(retry);
        }
        Ok(())
    }

    pub(crate) fn record_failure(&self, ip: IpAddr) {
        if self.max == 0 {
            return;
        }
        let now = Instant::now();
        let mut map = self.hits.lock().unwrap_or_else(|e| e.into_inner());
        Limiter::prune_locked(&mut map, self.window, now);
        let times = map.entry(ip).or_default();
        times.retain(|t| now.saturating_duration_since(*t) < self.window);
        times.push(now);
    }
}

/// Peer address, or `X-Forwarded-For` / `X-Real-IP` when `TRUST_PROXY` is set
/// (only enable this behind a reverse proxy that overwrites those headers).
pub(crate) fn client_ip(headers: &HeaderMap, peer: SocketAddr) -> IpAddr {
    let trust = std::env::var("TRUST_PROXY")
        .ok()
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes"))
        .unwrap_or(false);
    if trust {
        if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok())
            && let Some(first) = xff.split(',').next()
            && let Ok(ip) = first.trim().parse::<IpAddr>()
        {
            return ip;
        }
        if let Some(real) = headers.get("x-real-ip").and_then(|v| v.to_str().ok())
            && let Ok(ip) = real.trim().parse::<IpAddr>()
        {
            return ip;
        }
    }
    peer.ip()
}

fn too_many(secs: u64) -> (StatusCode, Json<ApiError>) {
    err(
        StatusCode::TOO_MANY_REQUESTS,
        &format!("rate limit exceeded, retry in {secs}s"),
    )
}

pub(crate) fn enforce_create_limit(
    state: &AppState,
    headers: &HeaderMap,
    peer: ConnectInfo<SocketAddr>,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    let ip = client_ip(headers, peer.0);
    match state.create_limiter.check(ip) {
        Ok(()) => Ok(()),
        Err(secs) => Err(too_many(secs)),
    }
}

pub(crate) fn enforce_email_limit(
    state: &AppState,
    headers: &HeaderMap,
    peer: ConnectInfo<SocketAddr>,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    let ip = client_ip(headers, peer.0);
    match state.email_limiter.check(ip) {
        Ok(()) => Ok(()),
        Err(secs) => Err(too_many(secs)),
    }
}

pub(crate) fn enforce_read_limit(
    state: &AppState,
    headers: &HeaderMap,
    peer: ConnectInfo<SocketAddr>,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    let ip = client_ip(headers, peer.0);
    match state.read_limiter.check(ip) {
        Ok(()) => Ok(()),
        Err(secs) => Err(too_many(secs)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn ip(n: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(203, 0, 113, n))
    }

    #[test]
    fn limiter_zero_disables() {
        let l = Limiter::new(0, Duration::from_secs(60));
        for _ in 0..50 {
            assert!(l.check(ip(1)).is_ok());
        }
    }

    #[test]
    fn limiter_blocks_after_max() {
        let l = Limiter::new(3, Duration::from_secs(3600));
        assert!(l.check(ip(1)).is_ok());
        assert!(l.check(ip(1)).is_ok());
        assert!(l.check(ip(1)).is_ok());
        assert!(l.check(ip(1)).is_err());
        assert!(l.check(ip(2)).is_ok());
    }

    #[test]
    fn admin_auth_counts_failures_only() {
        let l = AdminAuthLimiter::new(2, Duration::from_secs(3600));
        let a = ip(10);
        assert!(l.check(a).is_ok());
        assert!(l.check(a).is_ok());
        l.record_failure(a);
        assert!(l.check(a).is_ok());
        l.record_failure(a);
        assert!(l.check(a).is_err());
        assert!(l.check(ip(11)).is_ok());
    }

    #[test]
    fn admin_auth_zero_disables() {
        let l = AdminAuthLimiter::new(0, Duration::from_secs(60));
        let a = ip(12);
        for _ in 0..20 {
            assert!(l.check(a).is_ok());
            l.record_failure(a);
        }
    }

    // `TRUST_PROXY` is read from the process environment inside `client_ip`,
    // so these tests serialize on a lock and always restore the var
    // afterwards to avoid bleeding state into unrelated tests running in
    // parallel in this binary.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_trust_proxy<T>(value: Option<&str>, f: impl FnOnce() -> T) -> T {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        match value {
            Some(v) => unsafe { std::env::set_var("TRUST_PROXY", v) },
            None => unsafe { std::env::remove_var("TRUST_PROXY") },
        }
        let result = f();
        unsafe { std::env::remove_var("TRUST_PROXY") };
        result
    }

    fn socket(a: u8, b: u8, c: u8, d: u8) -> SocketAddr {
        SocketAddr::new(IpAddr::V4(Ipv4Addr::new(a, b, c, d)), 12345)
    }

    #[test]
    fn client_ip_uses_peer_when_trust_proxy_unset() {
        with_trust_proxy(None, || {
            let mut headers = HeaderMap::new();
            headers.insert("x-forwarded-for", "9.9.9.9".parse().unwrap());
            let peer = socket(203, 0, 113, 50);
            assert_eq!(client_ip(&headers, peer), peer.ip());
        });
    }

    #[test]
    fn client_ip_trusts_forwarded_for_when_enabled() {
        with_trust_proxy(Some("true"), || {
            let mut headers = HeaderMap::new();
            headers.insert("x-forwarded-for", "198.51.100.7, 10.0.0.1".parse().unwrap());
            let peer = socket(203, 0, 113, 50);
            assert_eq!(
                client_ip(&headers, peer),
                IpAddr::V4(Ipv4Addr::new(198, 51, 100, 7))
            );
        });
    }

    #[test]
    fn client_ip_falls_back_to_real_ip_when_forwarded_for_invalid() {
        with_trust_proxy(Some("true"), || {
            let mut headers = HeaderMap::new();
            headers.insert("x-forwarded-for", "not-an-ip".parse().unwrap());
            headers.insert("x-real-ip", "198.51.100.9".parse().unwrap());
            let peer = socket(203, 0, 113, 50);
            assert_eq!(
                client_ip(&headers, peer),
                IpAddr::V4(Ipv4Addr::new(198, 51, 100, 9))
            );
        });
    }

    #[test]
    fn client_ip_falls_back_to_peer_when_no_forwarding_headers_present() {
        with_trust_proxy(Some("true"), || {
            let headers = HeaderMap::new();
            let peer = socket(203, 0, 113, 50);
            assert_eq!(client_ip(&headers, peer), peer.ip());
        });
    }
}
