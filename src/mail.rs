//! Optional share-link email via SMTP (Mailgun on 2525 by default).
//!
//! Sending a working link means the URL fragment (the key) is given to this
//! process and to the mail provider. The UI only offers this when SMTP is
//! configured. The URL is never written to logs or SQLite.

use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, State},
    http::HeaderMap,
    http::StatusCode,
    Json,
};
use lettre::{
    message::Mailbox,
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use serde::{Deserialize, Serialize};

use crate::common::{err, ApiError, AppState, ID_LEN, MAX_EXPIRES, MIN_EXPIRES};

const SUBJECT: &str = "You were sent a secure message";
const MAX_EMAIL_LEN: usize = 254;
const MAX_URL_LEN: usize = 2048;

#[derive(Clone)]
pub(crate) struct Mailer {
    host: String,
    port: u16,
    username: String,
    password: String,
    from: Mailbox,
}

impl Mailer {
    pub(crate) fn from_env() -> Option<Self> {
        let username = first_env(&["SMTP_USERNAME", "MAILGUN_SMTP_LOGIN"])?;
        let password = first_env(&["SMTP_PASSWORD", "MAILGUN_SMTP_PASSWORD"])?;
        let from_raw = first_env(&["SMTP_FROM", "MAILGUN_FROM"])?;
        let from = from_raw.parse::<Mailbox>().ok()?;
        let host = std::env::var("SMTP_HOST")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "smtp.mailgun.org".into());
        let port = std::env::var("SMTP_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(2525);
        Some(Self {
            host,
            port,
            username,
            password,
            from,
        })
    }

    async fn send(&self, to: Mailbox, body: String) -> Result<(), String> {
        let email = Message::builder()
            .from(self.from.clone())
            .to(to)
            .subject(SUBJECT)
            .body(body)
            .map_err(|e| e.to_string())?;
        // Mailgun 2525 / 587: STARTTLS (not implicit TLS on 465).
        let mailer = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&self.host)
            .map_err(|e| e.to_string())?
            .port(self.port)
            .credentials(Credentials::new(
                self.username.clone(),
                self.password.clone(),
            ))
            .build();
        mailer.send(email).await.map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn first_env(keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| {
        std::env::var(k)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    })
}

#[derive(Deserialize)]
pub(crate) struct ShareEmailReq {
    to: String,
    url: String,
    /// Seconds until the note expires (copy for the email body).
    expires_in: i64,
    max_views: Option<i64>,
}

#[derive(Serialize)]
pub(crate) struct ShareEmailResp {
    ok: bool,
}

pub(crate) async fn send_share_email(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<ShareEmailReq>,
) -> Result<Json<ShareEmailResp>, (StatusCode, Json<ApiError>)> {
    let Some(mailer) = state.mailer.as_ref() else {
        return Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "email sending is not configured",
        ));
    };
    crate::rate::enforce_email_limit(&state, &headers, ConnectInfo(peer))?;

    let to_raw = req.to.trim();
    if !valid_email(to_raw) {
        return Err(err(StatusCode::BAD_REQUEST, "invalid email address"));
    }
    let to: Mailbox = to_raw
        .parse()
        .map_err(|_| err(StatusCode::BAD_REQUEST, "invalid email address"))?;

    let url = req.url.trim();
    if url.len() > MAX_URL_LEN || !looks_like_share_url(url) {
        return Err(err(StatusCode::BAD_REQUEST, "invalid share link"));
    }
    let origin = request_origin(&headers);
    if let Some(origin) = origin.as_deref() {
        if !share_origin_ok(url, origin) {
            return Err(err(StatusCode::BAD_REQUEST, "invalid share link"));
        }
    }

    let expires_in = req.expires_in.clamp(MIN_EXPIRES, MAX_EXPIRES);
    let max_views = req.max_views.filter(|&n| n >= 1 && n <= 1_000_000);
    let body = email_body(url, expires_in, max_views);

    if let Err(e) = mailer.send(to, body).await {
        tracing::error!(error = %e, "share email smtp failed");
        return Err(err(
            StatusCode::BAD_GATEWAY,
            "could not send the email, try again later",
        ));
    }
    tracing::info!("share email accepted by smtp");
    Ok(Json(ShareEmailResp { ok: true }))
}

pub(crate) fn valid_email(s: &str) -> bool {
    if s.len() > MAX_EMAIL_LEN || s.contains("..") {
        return false;
    }
    let Some((local, domain)) = s.split_once('@') else {
        return false;
    };
    if local.is_empty() || local.len() > 64 || domain.len() < 3 {
        return false;
    }
    if !local
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '%' | '+' | '-'))
    {
        return false;
    }
    domain.contains('.')
        && domain
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !domain.starts_with('-')
}

pub(crate) fn looks_like_share_url(url: &str) -> bool {
    let Some((_, frag)) = url.split_once('#') else {
        return false;
    };
    let path = frag.trim_start_matches('/');
    let mut parts = path.split('/');
    if parts.next() != Some("v") {
        return false;
    }
    let Some(id) = parts.next() else {
        return false;
    };
    let Some(key) = parts.next() else {
        return false;
    };
    id.len() == ID_LEN
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric())
        && key.len() >= 16
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn share_origin_ok(url: &str, origin: &str) -> bool {
    let origin = origin.trim().trim_end_matches('/');
    if origin.is_empty() {
        return false;
    }
    url.starts_with(&format!("{origin}/#/")) || url.starts_with(&format!("{origin}#/"))
}

fn request_origin(headers: &HeaderMap) -> Option<String> {
    if let Some(explicit) = std::env::var("PUBLIC_URL")
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
    {
        return Some(explicit);
    }
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(axum::http::header::HOST))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
        .filter(|s| !s.is_empty())?;
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim())
        .filter(|s| *s == "http" || *s == "https")
        .unwrap_or("https");
    Some(format!("{proto}://{host}"))
}

pub(crate) fn human_ttl(secs: i64) -> String {
    let secs = secs.max(0);
    if secs < 60 {
        return format!("{secs} seconds");
    }
    let mins = secs / 60;
    if mins < 60 {
        return if mins == 1 {
            "1 minute".into()
        } else {
            format!("{mins} minutes")
        };
    }
    let hours = mins / 60;
    if hours < 24 {
        return if hours == 1 {
            "1 hour".into()
        } else {
            format!("{hours} hours")
        };
    }
    let days = hours / 24;
    if days == 1 {
        "1 day".into()
    } else {
        format!("{days} days")
    }
}

fn email_body(url: &str, expires_in: i64, max_views: Option<i64>) -> String {
    let ttl = human_ttl(expires_in);
    let mut body = format!(
        "You were sent a secure message.\n\n\
         Someone shared an encrypted link with you. It will self-destruct after {ttl}."
    );
    if let Some(n) = max_views {
        let times = if n == 1 { "time" } else { "times" };
        body.push_str(&format!(" It can be opened at most {n} {times}."));
    }
    body.push_str("\n\nOpen this link on a device you trust:\n\n");
    body.push_str(url);
    body.push_str(
        "\n\nAnyone with this link can read the message. The encryption key is part of the URL.\n",
    );
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttl_wording() {
        assert_eq!(human_ttl(5 * 60), "5 minutes");
        assert_eq!(human_ttl(60), "1 minute");
        assert_eq!(human_ttl(3600), "1 hour");
        assert_eq!(human_ttl(86400), "1 day");
        assert_eq!(human_ttl(7 * 86400), "7 days");
    }

    #[test]
    fn email_rules() {
        assert!(valid_email("a@b.co"));
        assert!(valid_email("first.last+tag@mailgun.org"));
        assert!(!valid_email(""));
        assert!(!valid_email("nope"));
        assert!(!valid_email("@x.com"));
        assert!(!valid_email("a@b"));
    }

    #[test]
    fn share_url_shape() {
        let url = "https://tresorpost.example/#/v/abcdefghijkl/ABCDEFGHIJKLMNOPQRSTUV";
        assert!(looks_like_share_url(url));
        assert!(share_origin_ok(url, "https://tresorpost.example"));
        assert!(!share_origin_ok(url, "https://evil.example"));
        assert!(!looks_like_share_url("https://tresorpost.example/#/d/abcdefghijkl/token"));
    }

    #[test]
    fn body_mentions_destruct() {
        let b = email_body("https://x/#/v/abcdefghijkl/ABCDEFGHIJKLMNOPQRSTUV", 3600, Some(1));
        assert!(b.contains("self-destruct after 1 hour"));
        assert!(b.contains("at most 1 time"));
        assert!(b.contains("You were sent a secure message"));
    }
}
