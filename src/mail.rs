//! Optional SMTP: share-link email and abuse reports (`ADMIN_REPORT_URL`).
//!
//! Sending a working link means the URL fragment (the key) is given to this
//! process and to the mail provider. The UI only offers this when SMTP is
//! configured. The URL is never written to logs or SQLite.

use std::net::SocketAddr;

use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::HeaderMap,
    http::StatusCode,
};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::Mailbox,
    transport::smtp::authentication::Credentials,
};
use serde::{Deserialize, Serialize};

use crate::common::{ApiError, AppState, ID_LEN, MAX_EXPIRES, MIN_EXPIRES, err};

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

    async fn send(&self, to: Mailbox, subject: &str, body: String) -> Result<(), String> {
        let email = Message::builder()
            .from(self.from.clone())
            .to(to)
            .subject(subject)
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
    if !share_url_allowed(url, &headers) {
        return Err(err(StatusCode::BAD_REQUEST, "invalid share link"));
    }

    let expires_in = req.expires_in.clamp(MIN_EXPIRES, MAX_EXPIRES);
    let max_views = req.max_views.filter(|&n| (1..=1_000_000).contains(&n));
    let body = email_body(url, expires_in, max_views);

    if let Err(e) = mailer.send(to, SUBJECT, body).await {
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
    let decoded = percent_decode(frag);
    let path = decoded.trim_start_matches('/');
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
        && id.chars().all(|c| c.is_ascii_alphanumeric())
        && key.len() >= 16
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn percent_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%'
            && i + 2 < b.len()
            && let Ok(c) =
                u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or(""), 16)
        {
            out.push(c as char);
            i += 3;
            continue;
        }
        out.push(b[i] as char);
        i += 1;
    }
    out
}

fn origin_host(s: &str) -> Option<String> {
    let s = s.trim();
    let rest = s
        .strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))?;
    let hostport = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let host = hostport
        .split(':')
        .next()
        .unwrap_or(hostport)
        .to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }
    Some(host.strip_prefix("www.").unwrap_or(&host).to_string())
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1") || host.starts_with("127.")
}

pub(crate) fn share_url_allowed(url: &str, headers: &HeaderMap) -> bool {
    let Some(url_host) = origin_host(url) else {
        return false;
    };
    if is_loopback_host(&url_host) {
        return false;
    }
    let allowed = allowed_hosts(headers);
    if allowed.is_empty() {
        // nginx → 127.0.0.1:7777 often has no public Host. The fragment shape is
        // already checked; do not compare against loopback.
        return true;
    }
    allowed.iter().any(|h| h == &url_host)
}

fn allowed_hosts(headers: &HeaderMap) -> Vec<String> {
    let mut out = Vec::new();
    let push = |out: &mut Vec<String>, raw: &str| {
        if let Some(h) = origin_host(raw).or_else(|| {
            let h = raw
                .split(['/', ',', ':'])
                .next()
                .unwrap_or(raw)
                .trim()
                .trim_matches('"')
                .to_ascii_lowercase();
            let h = h.strip_prefix("www.").unwrap_or(&h).to_string();
            if h.is_empty() || is_loopback_host(&h) {
                None
            } else {
                Some(h)
            }
        }) && !is_loopback_host(&h)
            && !out.contains(&h)
        {
            out.push(h);
        }
    };
    if let Ok(explicit) = std::env::var("PUBLIC_URL") {
        push(&mut out, explicit.trim());
    }
    if let Ok(short) = std::env::var("SHORT_DOMAIN") {
        push(&mut out, short.trim());
    }
    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        push(&mut out, origin);
    }
    if let Some(referer) = headers.get("referer").and_then(|v| v.to_str().ok()) {
        push(&mut out, referer);
    }
    if let Some(xfh) = headers
        .get("x-forwarded-host")
        .and_then(|v| v.to_str().ok())
    {
        push(&mut out, xfh.split(',').next().unwrap_or(xfh).trim());
    }
    if let Some(host) = headers
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok())
    {
        push(&mut out, host);
    }
    out
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

const REPORT_SUBJECT: &str = "Tresorpost content report";
const MAX_REPORT_MESSAGE_LEN: usize = 2000;

pub(crate) fn admin_report_to_from_env() -> Option<String> {
    let raw = std::env::var("ADMIN_REPORT_URL").ok()?;
    parse_admin_report_to(&raw)
}

pub(crate) fn parse_admin_report_to(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let email = trimmed.strip_prefix("mailto:").unwrap_or(trimmed).trim();
    if email.parse::<Mailbox>().is_ok() {
        return Some(email.to_string());
    }
    if valid_email(email) {
        return Some(email.to_string());
    }
    None
}

#[derive(Deserialize)]
pub(crate) struct ContentReportReq {
    view_url: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    kind: String,
}

#[derive(Serialize)]
pub(crate) struct ContentReportResp {
    ok: bool,
}

pub(crate) async fn send_content_report(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<ContentReportReq>,
) -> Result<Json<ContentReportResp>, (StatusCode, Json<ApiError>)> {
    let Some(to_raw) = state.admin_report_to.as_deref() else {
        return Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "reporting is not configured",
        ));
    };
    let Some(mailer) = state.mailer.as_ref() else {
        return Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "reporting is not configured",
        ));
    };
    crate::rate::enforce_email_limit(&state, &headers, ConnectInfo(peer))?;

    let to: Mailbox = to_raw.parse().map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "reporting is not configured",
        )
    })?;

    let view_url = req.view_url.trim();
    if view_url.len() > MAX_URL_LEN || !looks_like_share_url(view_url) {
        return Err(err(StatusCode::BAD_REQUEST, "invalid share link"));
    }
    if !share_url_allowed(view_url, &headers) {
        return Err(err(StatusCode::BAD_REQUEST, "invalid share link"));
    }

    let kind = match req.kind.trim() {
        "text" | "image" | "video" | "file" => req.kind.trim(),
        _ => "unknown",
    };
    let message = req.message.trim();
    if message.len() > MAX_REPORT_MESSAGE_LEN {
        return Err(err(StatusCode::BAD_REQUEST, "message is too long"));
    }

    let body = report_email_body(view_url, kind, message);

    if let Err(e) = mailer.send(to, REPORT_SUBJECT, body).await {
        tracing::error!(error = %e, "content report smtp failed");
        return Err(err(
            StatusCode::BAD_GATEWAY,
            "could not send the report, try again later",
        ));
    }
    tracing::info!("content report accepted by smtp");
    Ok(Json(ContentReportResp { ok: true }))
}

/// Origin + `#/d/<id>/<token>` when the view URL carries a recipient delete token.
pub(crate) fn delete_url_from_view(view_url: &str) -> Option<String> {
    let (origin, frag) = view_url.split_once('#')?;
    let decoded = percent_decode(frag);
    let path = decoded.trim_start_matches('/');
    let mut parts = path.split('/');
    if parts.next() != Some("v") {
        return None;
    }
    let id = parts.next()?;
    let _key = parts.next()?;
    let token = parts.next()?;
    if token.is_empty() {
        return None;
    }
    Some(format!("{origin}#/d/{id}/{token}"))
}

fn report_email_body(view_url: &str, kind: &str, message: &str) -> String {
    let mut body = format!(
        "A recipient reported a secret ({kind}).\n\n\
         Opening the view link decrypts the content. The encryption key is in the URL.\n\n\
         View:\n{view_url}\n"
    );
    if let Some(delete_url) = delete_url_from_view(view_url) {
        body.push_str("\nDelete (recipient token):\n");
        body.push_str(&delete_url);
        body.push('\n');
    } else {
        body.push_str("\nNo delete link was attached to this share URL.\n");
    }
    if !message.is_empty() {
        body.push_str("\nMessage:\n");
        body.push_str(message);
        body.push('\n');
    }
    body
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
    fn share_url_ignores_loopback_host() {
        let url = "https://tresorpost.ch/#/v/abcdefghijkl/ABCDEFGHIJKLMNOPQRSTUV";
        let mut headers = HeaderMap::new();
        headers.insert("host", "127.0.0.1:7777".parse().unwrap());
        assert!(looks_like_share_url(url));
        assert!(share_url_allowed(url, &headers));
        headers.insert("origin", "https://tresorpost.ch".parse().unwrap());
        assert!(share_url_allowed(url, &headers));
        assert!(!looks_like_share_url(
            "https://tresorpost.ch/#/d/abcdefghijkl/notakeynotakey"
        ));
        assert!(looks_like_share_url(
            "https://tresorpost.ch/#/v/abcdefghijkl/ABCDEFGHIJKLMNOPQRSTUV/delTokendelToken"
        ));
        let mut evil = HeaderMap::new();
        evil.insert("origin", "https://evil.example".parse().unwrap());
        assert!(!share_url_allowed(url, &evil));
    }

    #[test]
    fn body_mentions_destruct() {
        let b = email_body(
            "https://x/#/v/abcdefghijkl/ABCDEFGHIJKLMNOPQRSTUV",
            3600,
            Some(1),
        );
        assert!(b.contains("self-destruct after 1 hour"));
        assert!(b.contains("at most 1 time"));
        assert!(b.contains("You were sent a secure message"));
    }

    #[test]
    fn admin_report_mailbox_from_url_or_mailto() {
        assert_eq!(
            parse_admin_report_to("reports@dol.ch").as_deref(),
            Some("reports@dol.ch")
        );
        assert_eq!(
            parse_admin_report_to("mailto:reports@dol.ch").as_deref(),
            Some("reports@dol.ch")
        );
        assert_eq!(
            parse_admin_report_to("Tresorpost <reports@dol.ch>").as_deref(),
            Some("Tresorpost <reports@dol.ch>")
        );
        assert!(parse_admin_report_to("").is_none());
        assert!(parse_admin_report_to("https://example.com/hook").is_none());
    }

    #[test]
    fn report_email_includes_view_and_optional_delete() {
        let view = "https://tresorpost.ch/#/v/abcdefghijkl/ABCDEFGHIJKLMNOPQRSTUV";
        let with_del =
            "https://tresorpost.ch/#/v/abcdefghijkl/ABCDEFGHIJKLMNOPQRSTUV/delTokendelToken";
        let plain = report_email_body(view, "image", "spam");
        assert!(plain.contains("View:\nhttps://tresorpost.ch/#/v/abcdefghijkl/"));
        assert!(plain.contains("No delete link"));
        assert!(plain.contains("Message:\nspam"));
        assert!(plain.contains("(image)"));
        let del = report_email_body(with_del, "file", "");
        assert_eq!(
            delete_url_from_view(with_del).as_deref(),
            Some("https://tresorpost.ch/#/d/abcdefghijkl/delTokendelToken")
        );
        assert!(del.contains("Delete (recipient token):"));
        assert!(del.contains("/#/d/abcdefghijkl/delTokendelToken"));
        assert!(!del.contains("Message:"));
    }
}
