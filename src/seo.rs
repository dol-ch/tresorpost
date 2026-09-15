//! First-paint title/description/canonical/OG for marketing paths.
//!
//! `ServeDir` serves hashed assets and `index.html` for `/`. Other paths such
//! as `/faq` fall through to this rewriter so crawlers and chat previews do
//! not receive the homepage card.

use std::{
    convert::Infallible,
    future::Future,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};

use axum::{
    body::Body,
    http::{header, HeaderName, HeaderValue, Request, Response},
};
use tower::Service;

/// Serves rewritten `index.html` when `ServeDir` has no file for the path.
#[derive(Clone)]
pub struct SpaIndex(pub Arc<String>);

impl<B> Service<Request<B>> for SpaIndex
where
    B: Send + 'static,
{
    type Response = Response<Body>;
    type Error = Infallible;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, _: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, req: Request<B>) -> Self::Future {
        let html = self.0.clone();
        let path = req.uri().path().to_string();
        Box::pin(async move {
            let body = rewrite_index_html(&html, &path);
            let mut res = Response::new(Body::from(body));
            res.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/html; charset=utf-8"),
            );
            if noindex_path(&path) {
                res.headers_mut().insert(
                    HeaderName::from_static("x-robots-tag"),
                    HeaderValue::from_static("noindex, nofollow"),
                );
            }
            Ok(res)
        })
    }
}

const SITE: &str = "https://tresorpost.ch";

const HOME_TITLE: &str = "Tresorpost — quantum-safe file transfer that forgets itself";
const HOME_DESCRIPTION: &str = "Quantum-safe, end-to-end encrypted transfer for text, images, video and files. 256-bit encryption in your browser, hosted in Switzerland, no accounts and no analytics.";

const FAQ_TITLE: &str = "How it works — Tresorpost";
const FAQ_DESCRIPTION: &str = "How Tresorpost encrypts secrets in the browser, keeps the key in the link, and deletes ciphertext after reading. Hosted in Switzerland, no analytics.";

const PRIVACY_TITLE: &str = "Privacy — Tresorpost";
const PRIVACY_DESCRIPTION: &str = "Tresorpost stores only ciphertext. No keys, no accounts, no analytics. App and object storage run in Zurich, Switzerland.";

const INDEX_FOLLOW: &str = "index, follow";
const NOINDEX: &str = "noindex, nofollow";

pub struct PageMeta {
    pub path: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub robots: &'static str,
}

pub fn page_for(request_path: &str) -> PageMeta {
    match normalize_path(request_path) {
        "/faq" => PageMeta {
            path: "/faq",
            title: FAQ_TITLE,
            description: FAQ_DESCRIPTION,
            robots: INDEX_FOLLOW,
        },
        "/privacy" => PageMeta {
            path: "/privacy",
            title: PRIVACY_TITLE,
            description: PRIVACY_DESCRIPTION,
            robots: INDEX_FOLLOW,
        },
        "/admin" => PageMeta {
            path: "/admin",
            title: "Tresorpost — encrypted transfer",
            description: HOME_DESCRIPTION,
            robots: NOINDEX,
        },
        _ => PageMeta {
            path: "/",
            title: HOME_TITLE,
            description: HOME_DESCRIPTION,
            robots: INDEX_FOLLOW,
        },
    }
}

pub fn noindex_path(request_path: &str) -> bool {
    page_for(request_path).robots.starts_with("noindex")
}

pub fn rewrite_index_html(html: &str, request_path: &str) -> String {
    let page = page_for(request_path);
    let url = canonical_url(page.path);
    let mut out = html.to_string();
    out = replace_title(&out, page.title);
    out = replace_named_meta(&out, "description", page.description);
    out = replace_named_meta(&out, "robots", page.robots);
    out = replace_named_meta(&out, "twitter:title", page.title);
    out = replace_named_meta(&out, "twitter:description", page.description);
    out = replace_property_meta(&out, "og:title", page.title);
    out = replace_property_meta(&out, "og:description", page.description);
    out = replace_property_meta(&out, "og:url", &url);
    out = replace_canonical(&out, &url);
    out = replace_hreflang(&out, &url);
    if page.path == "/faq" {
        out = inject_faq_json_ld(&out);
        out = replace_noscript(&out, FAQ_NOSCRIPT);
    } else if page.path == "/privacy" {
        out = replace_noscript(&out, PRIVACY_NOSCRIPT);
    }
    out
}

fn canonical_url(path: &str) -> String {
    if path == "/" {
        format!("{SITE}/")
    } else {
        format!("{SITE}{path}")
    }
}

fn normalize_path(path: &str) -> &str {
    let p = path.split('?').next().unwrap_or(path);
    if p.len() > 1 && p.ends_with('/') {
        p.trim_end_matches('/')
    } else if p.is_empty() {
        "/"
    } else {
        p
    }
}

fn replace_title(html: &str, title: &str) -> String {
    let Some(start) = html.find("<title>") else {
        return html.to_string();
    };
    let from = start + "<title>".len();
    let Some(rel) = html[from..].find("</title>") else {
        return html.to_string();
    };
    splice(html, from, from + rel, &escape_text(title))
}

fn replace_named_meta(html: &str, name: &str, content: &str) -> String {
    replace_meta(html, "name", name, content)
}

fn replace_property_meta(html: &str, property: &str, content: &str) -> String {
    replace_meta(html, "property", property, content)
}

fn replace_meta(html: &str, attr: &str, key: &str, content: &str) -> String {
    let needle = format!("{attr}=\"{key}\"");
    let Some(idx) = html.find(&needle) else {
        return html.to_string();
    };
    replace_content_attr_after(html, idx, content)
}

fn replace_canonical(html: &str, href: &str) -> String {
    let Some(idx) = html.find("rel=\"canonical\"") else {
        return html.to_string();
    };
    replace_href_attr_after(html, idx, href)
}

fn replace_hreflang(html: &str, href: &str) -> String {
    let Some(idx) = html.find("hreflang=\"en\"") else {
        return html.to_string();
    };
    replace_href_attr_after(html, idx, href)
}

fn replace_content_attr_after(html: &str, from: usize, value: &str) -> String {
    replace_quoted_attr_after(html, from, "content=\"", value)
}

fn replace_href_attr_after(html: &str, from: usize, value: &str) -> String {
    replace_quoted_attr_after(html, from, "href=\"", value)
}

fn replace_quoted_attr_after(html: &str, from: usize, prefix: &str, value: &str) -> String {
    let search = &html[from..];
    let Some(rel) = search.find(prefix) else {
        return html.to_string();
    };
    let value_start = from + rel + prefix.len();
    let Some(end_rel) = html[value_start..].find('"') else {
        return html.to_string();
    };
    splice(html, value_start, value_start + end_rel, &escape_attr(value))
}

fn splice(html: &str, start: usize, end: usize, insert: &str) -> String {
    let mut out = String::with_capacity(html.len() + insert.len());
    out.push_str(&html[..start]);
    out.push_str(insert);
    out.push_str(&html[end..]);
    out
}

fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

fn escape_text(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;")
}

fn replace_noscript(html: &str, inner: &str) -> String {
    let Some(start) = html.find("<noscript>") else {
        return html.to_string();
    };
    let from = start + "<noscript>".len();
    let Some(rel) = html[from..].find("</noscript>") else {
        return html.to_string();
    };
    splice(html, from, from + rel, inner)
}

const FAQ_JSON: &str = include_str!("seo_faqs.json");

fn inject_faq_json_ld(html: &str) -> String {
    if html.contains("id=\"tresorpost-faq-jsonld\"") {
        return html.to_string();
    }
    let Ok(items) = serde_json::from_str::<Vec<FaqItem>>(FAQ_JSON) else {
        return html.to_string();
    };
    let main_entity: Vec<serde_json::Value> = items
        .into_iter()
        .map(|item| {
            serde_json::json!({
                "@type": "Question",
                "name": item.q,
                "acceptedAnswer": { "@type": "Answer", "text": item.a }
            })
        })
        .collect();
    let doc = serde_json::json!({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": main_entity
    });
    let tag = format!(
        "  <script id=\"tresorpost-faq-jsonld\" type=\"application/ld+json\">\n  {}\n  </script>\n</head>",
        doc
    );
    html.replacen("</head>", &tag, 1)
}

#[derive(serde::Deserialize)]
struct FaqItem {
    q: String,
    a: String,
}

const FAQ_NOSCRIPT: &str = r#"
  <main>
    <h1>How Tresorpost works</h1>
    <p>End-to-end encrypted, self-destructing transfer. The key stays in the link. Hosted in Switzerland, no analytics.</p>
    <p><a href="/">Send a secret</a> · <a href="/privacy">Privacy</a></p>
  </main>
"#;

const PRIVACY_NOSCRIPT: &str = r#"
  <main>
    <h1>Privacy — Tresorpost</h1>
    <p>The server holds ciphertext it cannot read, and forgets it on schedule. Swiss storage in Zurich, no analytics, no accounts.</p>
    <p><a href="/">Send a secret</a> · <a href="/faq">How it works</a></p>
  </main>
"#;

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"<!doctype html>
<html lang="en">
<head>
  <title>Tresorpost — encrypted self-destructing file transfer</title>
  <meta name="description" content="Home description" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="https://tresorpost.ch/" />
  <link rel="alternate" hreflang="en" href="https://tresorpost.ch/" />
  <meta property="og:url" content="https://tresorpost.ch/" />
  <meta property="og:title" content="Home title" />
  <meta property="og:description" content="Home og" />
  <meta name="twitter:title" content="Home title" />
  <meta name="twitter:description" content="Home og" />
</head>
<body>
<noscript>home</noscript>
</body>
</html>"#;

    #[test]
    fn faq_gets_own_canonical_and_title() {
        let out = rewrite_index_html(FIXTURE, "/faq");
        assert!(out.contains("<title>How it works — Tresorpost</title>"));
        assert!(out.contains("href=\"https://tresorpost.ch/faq\""));
        assert!(out.contains("content=\"https://tresorpost.ch/faq\""));
        assert!(out.contains("id=\"tresorpost-faq-jsonld\""));
        assert!(out.contains("FAQPage"));
        assert!(out.contains("How Tresorpost works"));
        assert!(!out.contains("<title>Tresorpost — encrypted self-destructing file transfer</title>"));
    }

    #[test]
    fn privacy_is_indexable() {
        let out = rewrite_index_html(FIXTURE, "/privacy/");
        assert!(out.contains("Privacy — Tresorpost"));
        assert!(out.contains("https://tresorpost.ch/privacy"));
        assert!(out.contains("index, follow"));
    }

    #[test]
    fn admin_is_noindex() {
        let out = rewrite_index_html(FIXTURE, "/admin");
        assert!(out.contains("noindex, nofollow"));
        assert!(noindex_path("/admin"));
        assert!(!noindex_path("/faq"));
    }

    #[test]
    fn faq_json_matches_frontend_copy() {
        assert_eq!(
            include_str!("seo_faqs.json"),
            include_str!("../frontend/src/content/faqs.json")
        );
    }

    #[test]
    fn rewrites_committed_index_html() {
        let html = include_str!("../frontend/index.html");
        let faq = rewrite_index_html(html, "/faq");
        assert!(faq.contains("<title>How it works — Tresorpost</title>"));
        assert!(faq.contains("rel=\"canonical\" href=\"https://tresorpost.ch/faq\""));
        assert!(faq.contains("FAQPage"));
        assert!(faq.contains("og.png"));
        let home = rewrite_index_html(html, "/");
        assert!(home.contains("quantum-safe file transfer that forgets itself"));
        assert!(!home.contains("id=\"tresorpost-faq-jsonld\""));
    }
}
