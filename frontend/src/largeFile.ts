// Large-file (S3-backed) upload and download with client-side chunked streaming
// AEAD. The plaintext is never held in memory in full: it is sliced into fixed
// chunks that are encrypted one at a time on upload, and decrypted one at a
// time (streamed straight to disk when possible) on download.

import {
  generateKey,
  generateBaseNonce,
  encryptChunk,
  decryptChunk,
  encryptHeader,
  decryptHeader,
  bytesToBase64,
  base64ToBytes,
  STREAM_VERSION,
  type StreamMeta,
  type StreamHeader,
} from "./crypto";
import {
  uploadInit,
  uploadPartUrl,
  uploadComplete,
  type CompletedPart,
} from "./api";

/** Plaintext chunk size (8 MiB). Each encrypted chunk becomes exactly one S3
 *  multipart part; 8 MiB comfortably exceeds S3's 5 MiB minimum part size. */
export const CHUNK_SIZE = 8 * 1024 * 1024;
/** Poly1305 tag length appended by XChaCha20-Poly1305. */
const TAG_BYTES = 16;
/** In-memory fallback cap (no File System Access API) to avoid OOM. */
export const FALLBACK_MAX_BYTES = 500 * 1024 * 1024;

export interface UploadResult {
  id: string;
  key: Uint8Array;
  delete_token?: string;
  recipient_delete_token?: string;
}

export type ProgressFn = (done: number, total: number) => void;

function putPart(
  url: string,
  body: Uint8Array,
  total: number,
  base: number,
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // The encrypted chunk carries a Poly1305 tag; report progress against the
    // (larger) ciphertext but scale it into the plaintext total for a smooth,
    // byte-accurate bar.
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const frac = e.total > 0 ? e.loaded / e.total : 0;
        onProgress(base + frac * (body.length - TAG_BYTES), total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag =
          xhr.getResponseHeader("ETag") || xhr.getResponseHeader("etag");
        if (!etag) {
          reject(
            new Error(
              "S3 did not expose the ETag header — configure the bucket CORS to expose ETag.",
            ),
          );
        } else {
          resolve(etag);
        }
      } else {
        reject(new Error(`part upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () =>
      reject(new Error("network error uploading part (check S3 CORS)"));
    xhr.onabort = () => reject(new Error("upload cancelled"));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    // Send a fresh copy so the underlying buffer is a plain ArrayBuffer.
    xhr.send(body);
  });
}

/** Encrypt `file` in chunks and upload directly to S3 via presigned parts. */
export async function uploadLargeFile(opts: {
  file: File;
  kind: "file" | "image";
  expiresIn: number;
  maxViews: number | null;
  allowDelete: boolean;
  allowRecipientDelete: boolean;
  onProgress: ProgressFn;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const { file, kind, expiresIn, maxViews, allowDelete, allowRecipientDelete, onProgress, signal } = opts;

  const key = generateKey();
  const baseNonce = generateBaseNonce();
  const chunkCount = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  // Seal the file metadata (never sent in cleartext) as counter 0.
  const header: StreamHeader = {
    filename: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    kind,
  };
  const headerCt = encryptHeader(key, baseNonce, header);

  const meta: StreamMeta = {
    v: STREAM_VERSION,
    baseNonce: bytesToBase64(baseNonce),
    chunkSize: CHUNK_SIZE,
    chunkCount,
    size: file.size,
    header: bytesToBase64(headerCt),
  };

  const init = await uploadInit({
    expires_in: expiresIn,
    max_views: maxViews,
    kind,
    total_size: file.size,
    part_size: CHUNK_SIZE,
    part_count: chunkCount,
    meta: JSON.stringify(meta),
    allow_delete: allowDelete,
    allow_recipient_delete: allowRecipientDelete,
  });

  const parts: CompletedPart[] = [];
  let uploadedPlain = 0;
  onProgress(0, file.size);

  for (let i = 0; i < chunkCount; i++) {
    if (signal?.aborted) throw new Error("upload cancelled");
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const slice = await file.slice(start, end).arrayBuffer();
    const plaintext = new Uint8Array(slice);
    const isFinal = i === chunkCount - 1;
    const ciphertext = encryptChunk(key, baseNonce, i + 1, plaintext, isFinal);

    const partNumber = i + 1;
    const url = await uploadPartUrl(init.id, partNumber);
    const etag = await putPart(
      url,
      ciphertext,
      file.size,
      uploadedPlain,
      onProgress,
      signal,
    );
    parts.push({ part_number: partNumber, etag });
    uploadedPlain += plaintext.length;
    onProgress(uploadedPlain, file.size);
  }

  await uploadComplete(init.id, parts);
  return { id: init.id, key, delete_token: init.delete_token, recipient_delete_token: init.recipient_delete_token };
}

export function parseMeta(metaStr: string): StreamMeta {
  return JSON.parse(metaStr) as StreamMeta;
}

/** Read the (E2EE) file header from the stream descriptor without downloading
 *  the object body. */
export function readHeader(key: Uint8Array, meta: StreamMeta): StreamHeader {
  return decryptHeader(key, base64ToBytes(meta.baseNonce), base64ToBytes(meta.header));
}

// A tiny FIFO byte queue so we can carve fixed-size ciphertext frames out of an
// arbitrarily-chunked network stream.
class ByteQueue {
  private parts: Uint8Array[] = [];
  length = 0;

  push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }

  take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      const head = this.parts[0];
      const need = n - off;
      if (head.length <= need) {
        out.set(head, off);
        off += head.length;
        this.parts.shift();
      } else {
        out.set(head.subarray(0, need), off);
        this.parts[0] = head.subarray(need);
        off += need;
      }
    }
    this.length -= n;
    return out;
  }
}

export interface DecryptSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

/** Stream-download a presigned S3 URL and decrypt chunk-by-chunk into `sink`. */
export async function downloadLargeFile(opts: {
  url: string;
  meta: StreamMeta;
  key: Uint8Array;
  sink: DecryptSink;
  onProgress: ProgressFn;
  signal?: AbortSignal;
}): Promise<void> {
  const { url, meta, key, sink, onProgress, signal } = opts;
  const baseNonce = base64ToBytes(meta.baseNonce);
  const cipherFrame = meta.chunkSize + TAG_BYTES; // full non-final frame size

  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) {
    throw new Error(`download failed (HTTP ${res.status})`);
  }

  const reader = res.body.getReader();
  const queue = new ByteQueue();
  let dataIndex = 0; // 0-based data chunk index
  let writtenPlain = 0;
  onProgress(0, meta.size);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value && value.length) queue.push(value);

      // Decrypt all complete non-final frames that are fully buffered.
      while (dataIndex < meta.chunkCount - 1 && queue.length >= cipherFrame) {
        const frame = queue.take(cipherFrame);
        const pt = decryptChunk(key, baseNonce, dataIndex + 1, frame, false);
        await sink.write(pt);
        writtenPlain += pt.length;
        onProgress(writtenPlain, meta.size);
        dataIndex++;
      }
      if (done) break;
    }

    // The final chunk is whatever remains (last plaintext + tag).
    if (dataIndex === meta.chunkCount - 1) {
      const frame = queue.take(queue.length);
      const pt = decryptChunk(key, baseNonce, dataIndex + 1, frame, true);
      await sink.write(pt);
      writtenPlain += pt.length;
      onProgress(writtenPlain, meta.size);
    } else {
      throw new Error("stream ended before all chunks were received");
    }

    await sink.close();
  } catch (e) {
    if (sink.abort) await sink.abort().catch(() => {});
    throw e;
  }
}

/** Detect the File System Access API (streaming save straight to disk). */
export function hasFileSystemAccess(): boolean {
  return typeof (window as unknown as { showSaveFilePicker?: unknown })
    .showSaveFilePicker === "function";
}

/** A sink backed by the File System Access API (streams to disk, multi-GB). */
export async function fileSystemSink(
  suggestedName: string,
): Promise<DecryptSink> {
  const handle = await (
    window as unknown as {
      showSaveFilePicker: (opts: {
        suggestedName?: string;
      }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker({ suggestedName });
  const writable = await handle.createWritable();
  return {
    write: (chunk) => writable.write(chunk),
    close: () => writable.close(),
    abort: () => writable.abort?.(),
  };
}

/** A sink that accumulates in memory and triggers a normal browser download.
 *  Used as a fallback where the FS Access API is unavailable. */
export function blobSink(filename: string, mime: string): DecryptSink {
  const parts: Uint8Array[] = [];
  return {
    write: async (chunk) => {
      parts.push(chunk);
    },
    close: async () => {
      const blob = new Blob(parts as BlobPart[], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    abort: async () => {
      parts.length = 0;
    },
  };
}
