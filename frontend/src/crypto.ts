// Client-side end-to-end encryption: XChaCha20-Poly1305, 256-bit key (quantum-safe —
// Grover's algorithm only halves the effective strength, leaving ~128 bits).
// The key is generated in the browser and lives only in the URL fragment
// (after `#`), which browsers never send to the server, so the server only
// ever sees opaque ciphertext.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const KEY_BYTES = 32; // 256-bit key
const NONCE_BYTES = 24; // XChaCha20 extended nonce

export function generateKey(): Uint8Array {
  const key = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(key);
  return key;
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(nonce);
  return nonce;
}

export interface Encrypted {
  ciphertext: string; // base64
  nonce: string; // base64
}

export function encryptBytes(key: Uint8Array, plaintext: Uint8Array): Encrypted {
  const nonce = randomNonce();
  const aead = xchacha20poly1305(key, nonce);
  const ct = aead.encrypt(plaintext);
  return { ciphertext: bytesToBase64(ct), nonce: bytesToBase64(nonce) };
}

export function decryptBytes(
  key: Uint8Array,
  ciphertextB64: string,
  nonceB64: string,
): Uint8Array {
  const nonce = base64ToBytes(nonceB64);
  const ct = base64ToBytes(ciphertextB64);
  const aead = xchacha20poly1305(key, nonce);
  return aead.decrypt(ct);
}

// ---- chunked streaming AEAD (large S3-backed files) ------------------------
// Fixed plaintext chunks, each sealed independently. AAD binds the chunk
// index and a final-flag byte, so reordering/dropping/truncation is detected.
// Nonce = 20-byte random base prefix || 4-byte big-endian counter.

export const STREAM_VERSION = 1;
/** Base nonce prefix length; the remaining 4 bytes are the chunk counter. */
const BASE_NONCE_BYTES = NONCE_BYTES - 4; // 20

/** Descriptor stored (non-secret parts) in the server `meta` field. The key
 *  itself lives ONLY in the URL fragment and is never part of this. */
export interface StreamMeta {
  v: number;
  /** base64 of the 20-byte base nonce prefix. */
  baseNonce: string;
  /** Plaintext chunk size in bytes. */
  chunkSize: number;
  /** Number of data chunks. */
  chunkCount: number;
  /** Total plaintext size in bytes. */
  size: number;
  /** base64 of the encrypted header blob (filename, mime, size). */
  header: string;
}

export function generateBaseNonce(): Uint8Array {
  const b = new Uint8Array(BASE_NONCE_BYTES);
  crypto.getRandomValues(b);
  return b;
}

function chunkNonce(base: Uint8Array, counter: number): Uint8Array {
  const nonce = new Uint8Array(NONCE_BYTES);
  nonce.set(base, 0);
  const dv = new DataView(nonce.buffer);
  dv.setUint32(BASE_NONCE_BYTES, counter >>> 0, false); // big-endian
  return nonce;
}

function chunkAad(counter: number, isFinal: boolean): Uint8Array {
  const aad = new Uint8Array(5);
  new DataView(aad.buffer).setUint32(0, counter >>> 0, false);
  aad[4] = isFinal ? 1 : 0;
  return aad;
}

/** Encrypt one plaintext chunk. Counter 0 is reserved for the header, so data
 *  chunk `i` (0-based) uses counter `i + 1`. */
export function encryptChunk(
  key: Uint8Array,
  baseNonce: Uint8Array,
  counter: number,
  plaintext: Uint8Array,
  isFinal: boolean,
): Uint8Array {
  const aead = xchacha20poly1305(key, chunkNonce(baseNonce, counter), chunkAad(counter, isFinal));
  return aead.encrypt(plaintext);
}

export function decryptChunk(
  key: Uint8Array,
  baseNonce: Uint8Array,
  counter: number,
  ciphertext: Uint8Array,
  isFinal: boolean,
): Uint8Array {
  const aead = xchacha20poly1305(key, chunkNonce(baseNonce, counter), chunkAad(counter, isFinal));
  return aead.decrypt(ciphertext);
}

/** The E2EE header describing the file, sealed as counter 0. */
export interface StreamHeader {
  filename: string;
  mime: string;
  size: number;
  kind: "file" | "image" | "video";
}

export function encryptHeader(
  key: Uint8Array,
  baseNonce: Uint8Array,
  header: StreamHeader,
): Uint8Array {
  return encryptChunk(key, baseNonce, 0, utf8Encode(JSON.stringify(header)), false);
}

export function decryptHeader(
  key: Uint8Array,
  baseNonce: Uint8Array,
  headerCiphertext: Uint8Array,
): StreamHeader {
  const pt = decryptChunk(key, baseNonce, 0, headerCiphertext, false);
  return JSON.parse(utf8Decode(pt)) as StreamHeader;
}

// ---- encoding helpers -------------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return base64ToBytes(b64 + pad);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
