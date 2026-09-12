import type { Encrypted } from "./crypto";

export interface CreateSecretInput extends Encrypted {
  expires_in: number; // seconds
  max_views: number | null;
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
}

export async function fetchSecret(id: string): Promise<FetchedSecret | null> {
  const res = await fetch(`/api/secrets/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return (await res.json()) as FetchedSecret;
}
