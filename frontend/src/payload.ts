// The plaintext object that gets encrypted. Everything here — including the
// content kind, filename and MIME type — is inside the encrypted blob, so the
// server learns nothing about what is being shared.

export type SecretKind = "text" | "image" | "file";

export interface SecretPayload {
  kind: SecretKind;
  /** For text: sanitized rich-text HTML. For image/file: base64 of raw bytes. */
  data: string;
  /** Original file name (image/file only). */
  filename?: string;
  /** MIME type (image/file only). */
  mime?: string;
}

import {
  bytesToBase64,
  base64ToBytes,
  utf8Decode,
  utf8Encode,
} from "./crypto";

export function encodePayload(payload: SecretPayload): Uint8Array {
  return utf8Encode(JSON.stringify(payload));
}

export function decodePayload(bytes: Uint8Array): SecretPayload {
  return JSON.parse(utf8Decode(bytes)) as SecretPayload;
}

export function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buf) => bytesToBase64(new Uint8Array(buf)));
}

export function base64ToBlob(b64: string, mime: string): Blob {
  return new Blob([base64ToBytes(b64)], { type: mime });
}
