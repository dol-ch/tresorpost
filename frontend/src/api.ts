import type { Encrypted } from "./crypto";

export interface CreateSecretInput extends Encrypted {
  expires_in: number; // seconds
  max_views: number | null;
  kind: "text" | "image" | "file"; // coarse metadata for aggregate stats
}

export async function createSecret(input: CreateSecretInput): Promise<string> {
  const res = await fetch("/api/secrets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(msg.error || `request failed (${res.status})`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
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
}

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return (await res.json()) as AppConfig;
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
  kind: "file" | "image";
  total_size: number;
  part_size: number;
  part_count: number;
  meta: string; // opaque stream descriptor
}

export interface UploadInitResult {
  id: string;
  upload_id: string;
  part_size: number;
}

export async function uploadInit(input: UploadInitInput): Promise<UploadInitResult> {
  const res = await fetch("/api/uploads/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
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
