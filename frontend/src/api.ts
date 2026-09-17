import type { Encrypted } from "./crypto";

export interface CreateSecretInput extends Encrypted {
  expires_in: number; // seconds
  max_views: number | null;
  kind: "text" | "image" | "file" | "video"; // coarse metadata for aggregate stats
  allow_delete: boolean;
  allow_recipient_delete: boolean;
}

export interface CreateSecretResult {
  id: string;
  delete_token?: string;
  recipient_delete_token?: string;
}

export async function createSecret(input: CreateSecretInput): Promise<CreateSecretResult> {
  const res = await fetch("/api/secrets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 429) {
      throw new Error(msg.error || "Too many notes created. Please wait and try again.");
    }
    if (res.status === 413) {
      throw new Error(
        "File is too large for this server. Enable S3 or raise the upload size limit.",
      );
    }
    if (res.status === 507) {
      throw new Error(msg.error || "Storage is full. Please try again later.");
    }
    throw new Error(msg.error || `request failed (${res.status})`);
  }
  return (await res.json()) as CreateSecretResult;
}

export async function deleteSecret(id: string, deleteToken: string): Promise<void> {
  const res = await fetch(`/api/secrets/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ delete_token: deleteToken }),
  });
  if (res.status === 204) return;
  if (res.status === 404) throw new Error("This note is already gone, or the delete link is invalid.");
  if (res.status === 503) throw new Error("Could not delete stored files. Please retry.");
  const msg = await res.json().catch(() => ({ error: res.statusText }));
  throw new Error(msg.error || `request failed (${res.status})`);
}

export interface FetchedSecret {
  ciphertext: string;
  nonce: string;
  views_remaining: number | null;
  expires_at: number; // unix seconds
}

export interface AppConfig {
  max_file_bytes: number;
  s3_enabled: boolean;
  max_s3_file_bytes: number;
  email_enabled?: boolean;
  /** When true, view pages show Report (SMTP + ADMIN_REPORT_URL). */
  report_enabled?: boolean;
  /** Canonical origin (`PUBLIC_URL`) used for minted share/delete links. */
  public_origin?: string;
}

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return (await res.json()) as AppConfig;
}

export async function sendShareEmail(input: {
  to: string;
  url: string;
  expires_in: number;
  max_views: number | null;
}): Promise<void> {
  const res = await fetch("/api/share-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.ok) return;
  const msg = await res.json().catch(() => ({ error: res.statusText }));
  if (res.status === 429) {
    throw new Error(msg.error || "Too many emails. Wait a minute and try again.");
  }
  if (res.status === 503) {
    throw new Error("Email sending is not configured on this server.");
  }
  throw new Error(msg.error || `request failed (${res.status})`);
}

export async function sendContentReport(input: {
  view_url: string;
  message?: string;
  kind: string;
}): Promise<void> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.ok) return;
  const msg = await res.json().catch(() => ({ error: res.statusText }));
  if (res.status === 429) {
    throw new Error(msg.error || "Too many reports. Wait a minute and try again.");
  }
  if (res.status === 503) {
    throw new Error("Reporting is not configured on this server.");
  }
  throw new Error(msg.error || `request failed (${res.status})`);
}

/** Public all-time aggregates. No tokens, ids, or ciphertext. */
export interface PublicStats {
  links_created: number;
  bytes_transferred: number;
  by_kind: {
    text?: number;
    image?: number;
    video?: number;
    file?: number;
  };
}

export async function fetchPublicStats(): Promise<PublicStats> {
  const res = await fetch("/api/stats");
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return (await res.json()) as PublicStats;
}

/** An S3-backed large-file secret: the ciphertext lives in object storage and
 *  is fetched from a short-lived presigned URL. */
export interface FetchedS3Secret {
  storage: "s3";
  url: string;
  meta: string;
  size: number;
  views_remaining: number | null;
  expires_at: number;
}

export type FetchedAny = (FetchedSecret & { storage?: undefined }) | FetchedS3Secret;

export async function fetchSecret(id: string): Promise<FetchedAny | null> {
  const res = await fetch(`/api/secrets/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return (await res.json()) as FetchedAny;
}

// ---- S3 large-file upload orchestration ------------------------------------

export interface UploadInitInput {
  expires_in: number;
  max_views: number | null;
  kind: "file" | "image" | "video";
  total_size: number;
  part_size: number;
  part_count: number;
  meta: string; // opaque stream descriptor
  allow_delete: boolean;
  allow_recipient_delete: boolean;
}

export interface UploadInitResult {
  id: string;
  upload_id: string;
  part_size: number;
  delete_token?: string;
  recipient_delete_token?: string;
}

export async function uploadInit(input: UploadInitInput): Promise<UploadInitResult> {
  const res = await fetch("/api/uploads/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 429) {
      throw new Error(msg.error || "Too many notes created. Please wait and try again.");
    }
    if (res.status === 507) {
      throw new Error(msg.error || "Storage is full. Please try again later.");
    }
    throw new Error(msg.error || `request failed (${res.status})`);
  }
  return (await res.json()) as UploadInitResult;
}

export async function uploadPartUrl(id: string, partNumber: number): Promise<string> {
  const res = await fetch(`/api/uploads/${encodeURIComponent(id)}/part-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ part_number: partNumber }),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(msg.error || `request failed (${res.status})`);
  }
  return ((await res.json()) as { url: string }).url;
}

export interface CompletedPart {
  part_number: number;
  etag: string;
}

export async function uploadComplete(id: string, parts: CompletedPart[]): Promise<void> {
  const res = await fetch(`/api/uploads/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parts }),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(msg.error || `request failed (${res.status})`);
  }
}

export interface DailyPoint {
  day: string;
  count: number;
  bytes: number;
}

export interface AdminStats {
  active: { count: number; bytes: number; by_kind: Record<string, number> };
  lifetime: {
    created_total: number;
    by_kind: Record<string, number>;
    bytes_created_total: number;
    opens_total: number;
    burned_total: number;
    expired_total: number;
  };
  storage: { db_file_bytes: number; active_bytes: number };
  daily: DailyPoint[];
  generated_at: number;
}

function adminHeaders(token: string) {
  return { "x-admin-token": token };
}

function adminError(status: number): Error {
  if (status === 401) return new Error("Invalid admin token.");
  if (status === 404) return new Error("Admin endpoint is disabled (no ADMIN_TOKEN set).");
  return new Error(`request failed (${status})`);
}

export async function fetchAdminStats(token: string): Promise<AdminStats> {
  const res = await fetch("/api/admin/stats", { headers: adminHeaders(token) });
  if (!res.ok) throw adminError(res.status);
  return (await res.json()) as AdminStats;
}

export interface ActiveItem {
  id: string;
  kind: string;
  size: number;
  created_at: number;
  expires_at: number;
  views: number;
  max_views: number | null;
}

export async function fetchActive(
  token: string,
): Promise<{ items: ActiveItem[]; total: number }> {
  const res = await fetch("/api/admin/active", { headers: adminHeaders(token) });
  if (!res.ok) throw adminError(res.status);
  return (await res.json()) as { items: ActiveItem[]; total: number };
}

export async function purgeExpired(token: string): Promise<{ purged: number }> {
  const res = await fetch("/api/admin/purge", {
    method: "POST",
    headers: adminHeaders(token),
  });
  if (!res.ok) throw adminError(res.status);
  return (await res.json()) as { purged: number };
}
