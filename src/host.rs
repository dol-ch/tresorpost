//! Canonical host: `SHORT_DOMAIN` always 301s to `PUBLIC_URL`.
//!
//! The encryption key lives in the URL fragment (`#/v/…`), which is never sent
//! to the server. Browsers keep the original fragment when `Location` has none.

use axum::{
    extract::Request,
    http::{HeaderMap, Uri, header},
    middleware::Next,
    response::{IntoResponse, Redirect, Response},
};

/// `PUBLIC_URL` as `https://host` with no trailing slash.
pub(crate) fn public_origin() -> Option<String> {
    origin_from_env("PUBLIC_URL")
}

/// Host of `SHORT_DOMAIN` (`tpst.ch` or `https://tpst.ch`), lowercased, no `www.` / port.
pub(crate) fn short_domain_host() -> Option<String> {
    host_from_env("SHORT_DOMAIN")
}

fn origin_from_env(var: &str) -> Option<String> {
    let raw = std::env::var(var).ok()?;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let with_scheme = if raw.starts_with("http://") || raw.starts_with("https://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let origin = with_scheme
        .split_once("://")
        .map(|(scheme, rest)| {
            let host = rest.split(['/', '?', '#']).next().unwrap_or(rest);
            format!("{scheme}://{host}")
        })
        .unwrap_or(with_scheme);
    Some(origin.trim_end_matches('/').to_string())
}

fn host_from_env(var: &str) -> Option<String> {
    let raw = std::env::var(var).ok()?;
    normalize_host(raw.trim())
}

pub(crate) fn normalize_host(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let rest = s
        .strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))
        .unwrap_or(s);
    let hostport = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let host = hostport
        .split(':')
        .next()
        .unwrap_or(hostport)
        .trim()
        .trim_matches('"')
        .to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    if host.is_empty() || is_loopback_host(host) {
        None
    } else {
        Some(host.to_string())
    }
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1") || host.starts_with("127.")
}

fn request_host(headers: &HeaderMap) -> Option<String> {
    if let Some(xfh) = headers
        .get("x-forwarded-host")
        .and_then(|v| v.to_str().ok())
        && let Some(h) = normalize_host(xfh.split(',').next().unwrap_or(xfh).trim())
    {
        return Some(h);
    }
    headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .and_then(normalize_host)
}

pub(crate) fn redirect_location(public_origin: &str, uri: &Uri) -> String {
    let pq = uri
        .path_and_query()
        .map(|p| p.as_str())
        .filter(|p| !p.is_empty())
        .unwrap_or("/");
    format!("{public_origin}{pq}")
}

/// 301 `SHORT_DOMAIN` → `PUBLIC_URL` (same path + query). Fragment is kept by the browser.
pub(crate) async fn short_domain_redirect(request: Request, next: Next) -> Response {
    let Some(short) = short_domain_host() else {
        return next.run(request).await;
    };
    let Some(public) = public_origin() else {
        return next.run(request).await;
    };
    let Some(public_host) = normalize_host(&public) else {
        return next.run(request).await;
    };
    if short == public_host {
        return next.run(request).await;
    }
    let Some(host) = request_host(request.headers()) else {
        return next.run(request).await;
    };
    if host != short {
        return next.run(request).await;
    }
    Redirect::permanent(&redirect_location(&public, request.uri())).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_host_forms() {
        assert_eq!(normalize_host("tpst.ch").as_deref(), Some("tpst.ch"));
        assert_eq!(
            normalize_host("https://www.tpst.ch/").as_deref(),
            Some("tpst.ch")
        );
        assert_eq!(normalize_host("TPST.CH:443").as_deref(), Some("tpst.ch"));
        assert_eq!(normalize_host("127.0.0.1:7777"), None);
    }

    #[test]
    fn copies_path_and_query() {
        let origin = "https://tresorpost.ch";
        let uri: Uri = "/".parse().unwrap();
        assert_eq!(redirect_location(origin, &uri), "https://tresorpost.ch/");
        let uri: Uri = "/?utm=1".parse().unwrap();
        assert_eq!(
            redirect_location(origin, &uri),
            "https://tresorpost.ch/?utm=1"
        );
        let uri: Uri = "/api/config".parse().unwrap();
        assert_eq!(
            redirect_location(origin, &uri),
            "https://tresorpost.ch/api/config"
        );
    }
}
