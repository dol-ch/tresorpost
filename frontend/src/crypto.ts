// Client-side end-to-end encryption.
//
// We use XChaCha20-Poly1305 with a 256-bit key. Symmetric ciphers with 256-bit
// keys are considered quantum-resistant: the best known quantum attack (Grover's
// algorithm) only halves the effective key strength, leaving ~128 bits of
// security — comfortably beyond reach. The key is generated in the browser and
// never sent to the server; it is placed in the URL fragment (after `#`), which
// browsers do not transmit in HTTP requests. The server therefore only ever
// stores opaque ciphertext and can never decrypt it.

import { xchacha20poly1305 } from "@noble/ciphers/chacha";

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
