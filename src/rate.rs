//! Per-IP create rate limiter (in-memory, per process).

use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::ConnectInfo,
    http::{HeaderMap, StatusCode},
    Json,
};

use crate::common::{err, ApiError, AppState};

/// Default: 60 new notes per IP per hour. `CREATE_RATE_LIMIT=0` disables.
pub(crate) const DEFAULT_CREATE_RATE_LIMIT: u32 = 60;
pub(crate) const DEFAULT_CREATE_RATE_WINDOW_SECS: u64 = 3600;

#[derive(Clone)]
pub(crate) struct CreateLimiter {
    max: u32,
    window: Duration,
    hits: Arc<Mutex<HashMap<IpAddr, Vec<Instant>>>>,
}

impl CreateLimiter {
    pub(crate) fn from_env() -> Self {
        let max = std::env::var("CREATE_RATE_LIMIT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_CREATE_RATE_LIMIT);
        let window_secs = std::env::var("CREATE_RATE_WINDOW_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|&s| s >= 1)
            .unwrap_or(DEFAULT_CREATE_RATE_WINDOW_SECS);
        Self {
            max,
            window: Duration::from_secs(window_secs),
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

    /// Returns `Ok(())` or seconds until the oldest hit in the window expires.
    pub(crate) fn check(&self, ip: IpAddr) -> Result<(), u64> {
        if self.max == 0 {
            return Ok(());
        }
        let now = Instant::now();
        let mut map = self.hits.lock().unwrap_or_else(|e| e.into_inner());

        // Bound memory if many distinct IPs probe the endpoint.
        if map.len() > 50_000 {
            map.retain(|_, times| {
                times.retain(|t| now.saturating_duration_since(*t) < self.window);
                !times.is_empty()
            });
        }

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

/// Peer address, or `X-Forwarded-For` / `X-Real-IP` when `TRUST_PROXY` is set
/// (only enable this behind a reverse proxy that overwrites those headers).
pub(crate) fn client_ip(headers: &HeaderMap, peer: SocketAddr) -> IpAddr {
    let trust = std::env::var("TRUST_PROXY")
        .ok()
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes"))
        .unwrap_or(false);
    if trust {
        if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            if let Some(first) = xff.split(',').next() {
                if let Ok(ip) = first.trim().parse::<IpAddr>() {
                    return ip;
                }
            }
        }
        if let Some(real) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
            if let Ok(ip) = real.trim().parse::<IpAddr>() {
                return ip;
            }
        }
    }
    peer.ip()
}

pub(crate) fn enforce_create_limit(
    state: &AppState,
    headers: &HeaderMap,
    peer: ConnectInfo<SocketAddr>,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    let ip = client_ip(headers, peer.0);
    match state.create_limiter.check(ip) {
        Ok(()) => Ok(()),
        Err(secs) => Err(err(
            StatusCode::TOO_MANY_REQUESTS,
            &format!("rate limit exceeded, retry in {secs}s"),
        )),
    }
}
