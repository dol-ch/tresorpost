import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { RichTextEditor, type EditorHandle } from "./Editor";
import {
  generateKey,
  encryptBytes,
  bytesToBase64Url,
} from "./crypto";
import {
  encodePayload,
  fileToBase64,
  type SecretKind,
  type SecretPayload,
} from "./payload";
import { createSecret, fetchConfig } from "./api";
import { uploadLargeFile } from "./largeFile";
import { EXPIRY_OPTIONS, MAX_FILE_BYTES, humanSize } from "./options";

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CreatePage() {
  const [kind, setKind] = useState<SecretKind>("text");
  const [file, setFile] = useState<File | null>(null);
  const [expiresIn, setExpiresIn] = useState<number>(EXPIRY_OPTIONS[4].seconds); // 1 hour
  const [limitViews, setLimitViews] = useState(false);
  const [maxViews, setMaxViews] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [maxFileBytes, setMaxFileBytes] = useState<number>(MAX_FILE_BYTES);
  const [s3Enabled, setS3Enabled] = useState(false);
  const [maxS3FileBytes, setMaxS3FileBytes] = useState<number>(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const editorRef = useRef<EditorHandle>(null);

  useEffect(() => {
    fetchConfig()
      .then((cfg) => {
        if (cfg.max_file_bytes > 0) setMaxFileBytes(cfg.max_file_bytes);
        setS3Enabled(cfg.s3_enabled);
        setMaxS3FileBytes(cfg.max_s3_file_bytes);
      })
      .catch(() => {
        /* keep the default limit if config is unavailable */
      });
  }, []);

  const useS3 = s3Enabled && kind === "file";
  const effectiveMax = useS3 ? maxS3FileBytes : maxFileBytes;
  const maxLabel = humanSize(effectiveMax);
  const fileMaxLabel = humanSize(s3Enabled ? maxS3FileBytes : maxFileBytes);

  useEffect(() => {
    if (!shareUrl) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(shareUrl, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: "M",
      color: { dark: "#111111", light: "#ffffff" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [shareUrl]);

  function reset() {
    setShareUrl(null);
    setError(null);
    setCopied(false);
  }

  async function buildPayload(): Promise<SecretPayload> {
    if (kind === "text") {
      const html = editorRef.current?.getHTML() ?? "";
      if (!html || editorRef.current?.isEmpty()) {
        throw new Error("Write something before creating a link.");
      }
      return { kind: "text", data: html };
    }
    if (!file) throw new Error("Choose a file first.");
    if (file.size > effectiveMax) {
      throw new Error(`File is too large (${humanSize(file.size)}). Max is ${maxLabel}.`);
    }
    const data = await fileToBase64(file);
    return { kind, data, filename: file.name, mime: file.type || "application/octet-stream" };
  }

  async function onCreate() {
    reset();
    setBusy(true);
    const maxViewsVal = limitViews ? Math.max(1, Math.floor(maxViews)) : null;
    try {
      let id: string;
      let key: Uint8Array;

      if (useS3) {
        if (!file) throw new Error("Choose a file first.");
        if (file.size > effectiveMax) {
          throw new Error(`File is too large (${humanSize(file.size)}). Max is ${maxLabel}.`);
        }
        const ac = new AbortController();
        abortRef.current = ac;
        setProgress({ done: 0, total: file.size });
        const res = await uploadLargeFile({
          file,
          kind: "file",
          expiresIn,
          maxViews: maxViewsVal,
          onProgress: (done, total) =>
            setProgress((p) => ({ done: Math.max(p?.done ?? 0, done), total })),
          signal: ac.signal,
        });
        id = res.id;
        key = res.key;
      } else {
        const payload = await buildPayload();
        key = generateKey();
        const plaintext = encodePayload(payload);
        const enc = encryptBytes(key, plaintext);
        id = await createSecret({
          ciphertext: enc.ciphertext,
          nonce: enc.nonce,
          expires_in: expiresIn,
          max_views: maxViewsVal,
          kind: payload.kind,
        });
      }

      const keyUrl = bytesToBase64Url(key);
      const url = `${window.location.origin}/#/v/${id}/${keyUrl}`;
      setShareUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setProgress(null);
      setBusy(false);
    }
  }

  function onCancel() {
    abortRef.current?.abort();
  }

  async function copy() {
    if (!shareUrl) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(shareUrl);
      ok = true;
    } catch {
      ok = legacyCopy(shareUrl);
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (f && f.size > effectiveMax) {
      setError(`File is too large (${humanSize(f.size)}). Max is ${maxLabel}.`);
    }
    setFile(f);
  }

  if (shareUrl) {
    return (
      <div className="card result">
        <p className="eyebrow">
          <span className="num">02</span>&nbsp;&nbsp;— Share
        </p>
        <h2>Your encrypted link is ready</h2>
        <p className="muted small">
          Send it any way you like — or let them scan the code. The 256-bit key
          lives only after the <code>#</code> and never reaches the server.
        </p>

        <div className="share-block">
          {qr && (
            <div className="qr">
              <img src={qr} alt="QR code for the encrypted link" />
              <span className="eyebrow">Scan to open</span>
            </div>
          )}
          <div className="share-controls">
            <div className="share-row">
              <input
                className="share-input"
                readOnly
                value={shareUrl}
                onFocus={(e) => e.target.select()}
              />
              <button className="btn" onClick={copy}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div className="actions">
              <a className="btn ghost" href={shareUrl} target="_blank" rel="noreferrer">
                Open link
              </a>
              <button
                className="btn ghost"
                onClick={() => {
                  reset();
                  setFile(null);
                }}
              >
                Create another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="field">
        <label>Type</label>
        <select value={kind} onChange={(e) => { setKind(e.target.value as SecretKind); setError(null); }}>
          <option value="text">Text</option>
          <option value="image">Image</option>
          <option value="file">File (max {fileMaxLabel})</option>
        </select>
      </div>

      {kind === "text" ? (
        <div className="field">
          <label>Message</label>
          <RichTextEditor ref={editorRef} />
        </div>
      ) : (
        <div className="field">
          <label>{kind === "image" ? "Image" : "File"} (max {maxLabel})</label>
          <input
            type="file"
            accept={kind === "image" ? "image/*" : undefined}
            onChange={onFileChange}
          />
          {file && (
            <p className="muted small">
              {file.name} — {humanSize(file.size)}
            </p>
          )}
        </div>
      )}

      <div className="field">
        <label>Self-destruct after</label>
        <select
          value={expiresIn}
          onChange={(e) => setExpiresIn(Number(e.target.value))}
        >
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.seconds} value={o.seconds}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={limitViews}
            onChange={(e) => setLimitViews(e.target.checked)}
          />
          Limit number of opens
        </label>
        {limitViews && (
          <input
            className="numeric"
            type="number"
            min={1}
            value={maxViews}
            onChange={(e) => setMaxViews(Math.max(1, Number(e.target.value) || 1))}
          />
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {progress && (
        <div className="progress" role="status" aria-live="polite">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${progress.total ? Math.min(100, Math.max(0, (progress.done / progress.total) * 100)) : 0}%`,
              }}
            />
          </div>
          <p className="muted small progress-label">
            Encrypting &amp; uploading: {humanSize(Math.max(0, progress.done))} /{" "}
            {humanSize(progress.total)}
            {progress.total
              ? ` (${Math.min(100, Math.max(0, Math.floor((progress.done / progress.total) * 100)))}%)`
              : ""}
          </p>
        </div>
      )}

      <button className="btn primary" onClick={onCreate} disabled={busy}>
        {busy ? (useS3 ? "Uploading…" : "Encrypting…") : "Create encrypted link"}
      </button>
      {busy && useS3 && (
        <button className="btn ghost" onClick={onCancel} style={{ marginTop: 8 }}>
          Cancel
        </button>
      )}
    </div>
  );
}
