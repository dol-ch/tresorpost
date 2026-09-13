// The plaintext object that gets encrypted. Everything here — including the
// content kind, filename and MIME type — is inside the encrypted blob, so the
// server learns nothing about what is being shared.

export type SecretKind = "text" | "image" | "file" | "video";

export interface SecretPayload {
  kind: SecretKind;
  /** For text: sanitized rich-text HTML. For image/file/video: base64 of raw bytes. */
  data: string;
  /** Original file name (image/file/video only). */
  filename?: string;
  /** MIME type (image/file/video only). */
  mime?: string;
}

/** Browsers often leave `File.type` empty for .mov/.avi; hint a playable MIME. */
export function mimeForUpload(file: File, kind: SecretKind): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const n = file.name.toLowerCase();
  if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
  if (n.endsWith(".mov")) return "video/quicktime";
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".avi")) return "video/x-msvideo";
  if (n.endsWith(".mkv")) return "video/x-matroska";
  if (n.endsWith(".ogv")) return "video/ogg";
  if (n.endsWith(".3gp")) return "video/3gpp";
  if (kind === "video") return "video/mp4";
  if (kind === "image") return "image/*";
  return "application/octet-stream";
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
