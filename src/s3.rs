//! Optional S3-compatible storage backend for large files.
//!
//! When the `S3_*` environment variables are configured, `kind=file` (and
//! `image` / `video`) uploads are streamed **directly** from the browser to S3 using
//! presigned multipart-upload URLs. The server never sees the file bytes — it
//! only orchestrates the multipart lifecycle (init → per-part presign →
//! complete) and issues short-lived presigned GET URLs for download. The bytes
//! stay end-to-end encrypted: S3 only ever stores ciphertext chunks.
//!
//! This module is entirely inert unless `S3_ENDPOINT` (and the bucket/keys) are
//! set, so the default deployment behaves exactly as before.

use std::time::Duration;

use aws_sdk_s3::Client;
use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_s3::error::ProvideErrorMetadata;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
use rand::RngExt;

/// A configured S3 backend. Cloned cheaply (the inner `Client` is an `Arc`).
#[derive(Clone)]
pub struct S3Backend {
    client: Client,
    bucket: String,
    /// Maximum accepted raw (plaintext) file size in bytes.
    pub max_file_bytes: i64,
    /// Lifetime of presigned upload/download URLs. Also the grace window a
    /// burned object stays around so an in-flight download can finish.
    pub url_ttl: Duration,
}

/// One completed multipart part reported back by the client.
pub struct PartRef {
    pub part_number: i32,
    pub etag: String,
}

impl S3Backend {
    /// Build the backend from the environment. Returns `None` (S3 disabled)
    /// when `S3_ENDPOINT` is unset/empty. Requires `S3_BUCKET`,
    /// `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` when enabled.
    pub fn from_env(max_file_bytes: i64) -> Option<S3Backend> {
        let endpoint = std::env::var("S3_ENDPOINT")
            .ok()
            .filter(|s| !s.is_empty())?;
        let bucket = match std::env::var("S3_BUCKET").ok().filter(|s| !s.is_empty()) {
            Some(b) => b,
            None => {
                tracing::warn!("S3_ENDPOINT set but S3_BUCKET missing — S3 disabled");
                return None;
            }
        };
        let access_key = std::env::var("S3_ACCESS_KEY_ID").unwrap_or_default();
        let secret_key = std::env::var("S3_SECRET_ACCESS_KEY").unwrap_or_default();
        if access_key.is_empty() || secret_key.is_empty() {
            tracing::warn!("S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY missing — S3 disabled");
            return None;
        }
        let region = std::env::var("S3_REGION")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "us-east-1".to_string());
        // Path-style addressing (bucket in the path) is required by MinIO and
        // convenient for many self-hosted gateways. Virtual-hosted style is the
        // default for AWS.
        let force_path_style = std::env::var("S3_FORCE_PATH_STYLE")
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);
        // Presigned-URL lifetime (seconds). Also bounds how long a burned object
        // lingers so an in-flight download can complete. Default 1 hour.
        let url_ttl = std::env::var("S3_URL_TTL_SECS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|&s| (1..=604_800).contains(&s))
            .unwrap_or(3600);

        let creds = Credentials::new(access_key, secret_key, None, None, "tresorpost-static");
        let conf = aws_sdk_s3::config::Builder::new()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new(region))
            .endpoint_url(&endpoint)
            .credentials_provider(creds)
            .force_path_style(force_path_style)
            .build();
        let client = Client::from_conf(conf);

        tracing::info!(
            "S3 backend enabled (endpoint={endpoint}, bucket={bucket}, path_style={force_path_style})"
        );
        Some(S3Backend {
            client,
            bucket,
            max_file_bytes,
            url_ttl: Duration::from_secs(url_ttl),
        })
    }

    /// Generate a random, unguessable object key under a stable prefix.
    pub fn random_key() -> String {
        const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
        let mut rng = rand::rng();
        let name: String = (0..32)
            .map(|_| ALPHABET[rng.random_range(0..ALPHABET.len())] as char)
            .collect();
        format!("tresorpost/{name}")
    }

    /// Start a multipart upload, returning the S3 `upload_id`.
    pub async fn create_multipart(&self, key: &str) -> Result<String, String> {
        let out = self
            .client
            .create_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| format!("create_multipart_upload: {e}"))?;
        out.upload_id()
            .map(|s| s.to_string())
            .ok_or_else(|| "create_multipart_upload: no upload id".to_string())
    }

    /// Presign a PUT URL for one part of a pending multipart upload.
    pub async fn presign_put_part(
        &self,
        key: &str,
        upload_id: &str,
        part_number: i32,
        expires: Duration,
    ) -> Result<String, String> {
        let cfg = PresigningConfig::expires_in(expires).map_err(|e| e.to_string())?;
        let presigned = self
            .client
            .upload_part()
            .bucket(&self.bucket)
            .key(key)
            .upload_id(upload_id)
            .part_number(part_number)
            .presigned(cfg)
            .await
            .map_err(|e| format!("presign upload_part: {e}"))?;
        Ok(presigned.uri().to_string())
    }

    /// Complete a multipart upload with the client-reported parts/ETags.
    pub async fn complete_multipart(
        &self,
        key: &str,
        upload_id: &str,
        mut parts: Vec<PartRef>,
    ) -> Result<(), String> {
        parts.sort_by_key(|p| p.part_number);
        let completed: Vec<CompletedPart> = parts
            .into_iter()
            .map(|p| {
                CompletedPart::builder()
                    .part_number(p.part_number)
                    .e_tag(p.etag)
                    .build()
            })
            .collect();
        let body = CompletedMultipartUpload::builder()
            .set_parts(Some(completed))
            .build();
        self.client
            .complete_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .upload_id(upload_id)
            .multipart_upload(body)
            .send()
            .await
            .map_err(|e| format!("complete_multipart_upload: {e}"))?;
        Ok(())
    }

    /// Delete an object. `true` if gone (including already missing).
    pub async fn delete_object(&self, key: &str) -> bool {
        match self
            .client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
        {
            Ok(_) => true,
            Err(e) => {
                if is_missing(&e) {
                    return true;
                }
                tracing::warn!("delete_object failed for {key}: {e}");
                false
            }
        }
    }

    /// Abort a multipart upload. `true` if aborted or already gone.
    pub async fn abort_multipart(&self, key: &str, upload_id: &str) -> bool {
        match self
            .client
            .abort_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .upload_id(upload_id)
            .send()
            .await
        {
            Ok(_) => true,
            Err(e) => {
                if is_missing(&e) {
                    return true;
                }
                tracing::warn!("abort_multipart_upload failed: {e}");
                false
            }
        }
    }

    /// Presign a short-lived GET URL for download.
    pub async fn presign_get(&self, key: &str, expires: Duration) -> Result<String, String> {
        let cfg = PresigningConfig::expires_in(expires).map_err(|e| e.to_string())?;
        let presigned = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .presigned(cfg)
            .await
            .map_err(|e| format!("presign get_object: {e}"))?;
        Ok(presigned.uri().to_string())
    }

    /// List object keys under `tresorpost/` (for orphan reaping).
    pub async fn list_object_keys(&self) -> Result<Vec<String>, String> {
        let mut keys = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut req = self
                .client
                .list_objects_v2()
                .bucket(&self.bucket)
                .prefix("tresorpost/");
            if let Some(t) = token.as_ref() {
                req = req.continuation_token(t);
            }
            let out = req
                .send()
                .await
                .map_err(|e| format!("list_objects_v2: {e}"))?;
            for obj in out.contents() {
                if let Some(k) = obj.key() {
                    keys.push(k.to_string());
                }
            }
            if out.is_truncated() == Some(true) {
                token = out.next_continuation_token().map(|s| s.to_string());
                if token.is_none() {
                    break;
                }
            } else {
                break;
            }
        }
        Ok(keys)
    }
}

fn is_missing(e: &impl ProvideErrorMetadata) -> bool {
    matches!(
        e.code(),
        Some("NoSuchKey" | "NoSuchUpload" | "NotFound" | "404")
    )
}
