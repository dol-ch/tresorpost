import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { fetchSecret, deleteSecret } from "./api";
import { decryptBytes, base64UrlToBytes, type StreamMeta, type StreamHeader } from "./crypto";
import { decodePayload, base64ToBlob, type SecretPayload } from "./payload";
import {
  parseMeta,
  readHeader,
  downloadLargeFile,
  hasFileSystemAccess,
  fileSystemSink,
  blobSink,
  collectingSink,
  FALLBACK_MAX_BYTES,
} from "./largeFile";
import { humanSize } from "./options";
import { copyText } from "./clipboard";
import "./highlight.css";

function RenderedText({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const fullText = useRef<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll("pre code").forEach((block) => {
      try {
        hljs.highlightElement(block as HTMLElement);
      } catch {
        /* ignore */
      }
    });
    fullText.current = el.innerText;
    const cleanups: Array<() => void> = [];
    el.querySelectorAll("pre").forEach((pre) => {
      pre.classList.add("code-block");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-copy";
      btn.textContent = "Copy";
      const onClick = async (e: Event) => {
        e.preventDefault();
        const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
        if (await copyText(code)) {
          btn.textContent = "Copied!";
          window.setTimeout(() => {
            btn.textContent = "Copy";
          }, 1200);
        }
      };
      btn.addEventListener("click", onClick);
      pre.appendChild(btn);
      cleanups.push(() => {
        btn.removeEventListener("click", onClick);
        btn.remove();
      });
    });
    return () => cleanups.forEach((c) => c());
  }, [html]);

  async function copyAll() {
    const text = fullText.current || ref.current?.innerText || "";
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  }

  return (
    <div className="rt-wrap">
      <div className="rt-toolbar">
        <button className="copy-btn" onClick={copyAll}>
          {copied ? "Copied!" : "Copy text"}
        </button>
      </div>
      <div
        className="rendered-text"
        ref={ref}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
      />
    </div>
  );
}

interface Props {
  id: string;
  keyB64Url: string;
  recipientDeleteToken?: string;
}

type Status =
  | { state: "loading" }
  | { state: "gone" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      payload: SecretPayload;
      viewsRemaining: number | null;
      expiresAt: number;
    }
  | {
      state: "s3file";
      url: string;
      meta: StreamMeta;
      key: Uint8Array;
      header: StreamHeader;
      viewsRemaining: number | null;
      expiresAt: number;
    };

function SdIcon({ kind }: { kind: "opens" | "clock" }) {
  return (
    <svg
      className="sd-icon"
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "opens" ? (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      )}
    </svg>
  );
}

function relativeTime(diffSec: number): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
    style: "long",
  });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  for (const [unit, s] of units) {
    if (Math.abs(diffSec) >= s || unit === "second") {
      return rtf.format(Math.round(diffSec / s), unit);
    }
  }
  return "";
}

function formatExpiry(sec: number): { absolute: string; relative: string } {
  const d = new Date(sec * 1000);
  const absolute = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
  return { absolute, relative: relativeTime(sec - Date.now() / 1000) };
}

export function ViewPage({ id, keyB64Url, recipientDeleteToken }: Props) {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const secret = await fetchSecret(id);
        if (!secret) {
          setStatus({ state: "gone" });
          return;
        }
        const key = base64UrlToBytes(keyB64Url);
        if (secret.storage === "s3") {
          try {
            const meta = parseMeta(secret.meta);
            const header = readHeader(key, meta);
            setStatus({
              state: "s3file",
              url: secret.url,
              meta,
              key,
              header,
              viewsRemaining: secret.views_remaining,
              expiresAt: secret.expires_at,
            });
          } catch {
            setStatus({
              state: "error",
              message: "Decryption failed. The link may be corrupted or the key is wrong.",
            });
          }
          return;
        }
        let plaintext: Uint8Array;
        try {
          plaintext = decryptBytes(key, secret.ciphertext, secret.nonce);
        } catch {
          setStatus({
            state: "error",
            message: "Decryption failed. The link may be corrupted or the key is wrong.",
          });
          return;
        }
        const payload = decodePayload(plaintext);
        setStatus({
          state: "ok",
          payload,
          viewsRemaining: secret.views_remaining,
          expiresAt: secret.expires_at,
        });
      } catch (e) {
        setStatus({
          state: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [id, keyB64Url]);

  if (status.state === "loading") {
    return (
      <div className="card">
        <p className="muted">Decrypting…</p>
      </div>
    );
  }
  if (status.state === "gone") {
    return (
      <div className="card center">
        <h2>Nothing here</h2>
        <p className="muted">
          This secret has expired, was already opened the maximum number of
          times, or never existed.
        </p>
        <a className="btn primary" href="#/">
          Create your own
        </a>
      </div>
    );
  }
  if (status.state === "error") {
    return (
      <div className="card center">
        <h2>Could not open</h2>
        <p className="error">{status.message}</p>
        <a className="btn ghost" href="#/">
          Go home
        </a>
      </div>
    );
  }
  if (status.state === "s3file") {
    return (
      <S3FileView
        status={status}
        id={id}
        recipientDeleteToken={recipientDeleteToken}
        onDestroyed={() => setStatus({ state: "gone" })}
      />
    );
  }

  const { payload, viewsRemaining, expiresAt } = status;
  const opensLimited = viewsRemaining !== null;
  const expiry = formatExpiry(expiresAt);
  let opensLine: string | null = null;
  if (opensLimited) {
    opensLine =
      viewsRemaining === 0
        ? "No more opens — destroyed after this view"
        : `${viewsRemaining} more open${viewsRemaining === 1 ? "" : "s"}`;
  }

  return (
    <div className="card">
      <div className="view-banner">
        <span className="badge">Decrypted locally</span>
      </div>
      <div className="selfdestruct">
        <span className="eyebrow">Self-destructs</span>
        <div className="sd-lines">
          {opensLine && (
            <span className="sd-line">
              <SdIcon kind="opens" />
              {opensLine}
            </span>
          )}
          <span className="sd-line">
            <SdIcon kind="clock" />
            {expiry.absolute}
            <span className="sd-rel">· {expiry.relative}</span>
          </span>
        </div>
      </div>
      {payload.kind === "text" && <RenderedText html={payload.data} />}
      {payload.kind === "image" && (
        <div className="media">
          <img
            alt={payload.filename ?? "image"}
            src={URL.createObjectURL(base64ToBlob(payload.data, payload.mime ?? "image/*"))}
          />
          <p className="muted small">{payload.filename}</p>
        </div>
      )}
      {payload.kind === "video" && (
        <VideoPlayer
          blob={base64ToBlob(payload.data, payload.mime ?? "video/mp4")}
          filename={payload.filename}
        />
      )}
      {payload.kind === "file" && <FileDownload payload={payload} />}
      <div className="actions">
        {recipientDeleteToken && (
          <RecipientDestroy
            id={id}
            token={recipientDeleteToken}
            onDestroyed={() => setStatus({ state: "gone" })}
          />
        )}
        <a className="btn ghost" href="#/">
          Create your own
        </a>
      </div>
    </div>
  );
}

type S3Status = Extract<Status, { state: "s3file" }>;

function S3FileView({
  status,
  id,
  recipientDeleteToken,
  onDestroyed,
}: {
  status: S3Status;
  id: string;
  recipientDeleteToken?: string;
  onDestroyed: () => void;
}) {
  const { url, meta, key, header, viewsRemaining, expiresAt } = status;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [phase, setPhase] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [playBlob, setPlayBlob] = useState<Blob | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const expiry = formatExpiry(expiresAt);
  const isVideo =
    header.kind === "video" || (header.mime || "").startsWith("video/");
  const canPlayInBrowser = isVideo && header.size <= FALLBACK_MAX_BYTES;
  const opensLimited = viewsRemaining !== null;
  let opensLine: string | null = null;
  if (opensLimited) {
    opensLine =
      viewsRemaining === 0
        ? "No more opens — destroyed after this view"
        : `${viewsRemaining} more open${viewsRemaining === 1 ? "" : "s"}`;
  }

  async function onDownload() {
    setMessage(null);
    const useFsa = hasFileSystemAccess();
    if (!useFsa && header.size > FALLBACK_MAX_BYTES) {
      setPhase("error");
      setMessage(
        `This browser cannot stream ${humanSize(header.size)} to disk. Open the link in Chrome or Edge (which support streaming saves) to download files this large.`,
      );
      return;
    }
    let sink;
    try {
      sink = useFsa ? await fileSystemSink(header.filename) : blobSink(header.filename, header.mime);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setPhase("error");
      setMessage(e instanceof Error ? e.message : String(e));
      return;
    }
    await runDecrypt(sink, false);
  }

  async function onPlay() {
    setMessage(null);
    if (header.size > FALLBACK_MAX_BYTES) {
      setPhase("error");
      setMessage(
        `This video is ${humanSize(header.size)} — too large to play in the browser. Download it instead.`,
      );
      return;
    }
    const sink = collectingSink(header.mime || "video/mp4");
    await runDecrypt(sink, true);
    setPlayBlob(sink.result());
  }

  async function runDecrypt(
    sink: Parameters<typeof downloadLargeFile>[0]["sink"],
    forPlayback: boolean,
  ) {
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase("downloading");
    setProgress({ done: 0, total: header.size });
    try {
      await downloadLargeFile({
        url,
        meta,
        key,
        sink,
        onProgress: (done, total) =>
          setProgress((p) => ({ done: Math.max(p?.done ?? 0, done), total })),
        signal: ac.signal,
      });
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : String(e));
      if (forPlayback) setPlayBlob(null);
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <div className="card">
      <div className="view-banner">
        <span className="badge">Decrypted locally</span>
      </div>
      <div className="selfdestruct">
        <span className="eyebrow">Self-destructs</span>
        <div className="sd-lines">
          {opensLine && (
            <span className="sd-line">
              <SdIcon kind="opens" />
              {opensLine}
            </span>
          )}
          <span className="sd-line">
            <SdIcon kind="clock" />
            {expiry.absolute}
            <span className="sd-rel">· {expiry.relative}</span>
          </span>
        </div>
      </div>
      <div className="media center">
        <p className="file-name">{header.filename || "download"}</p>
        <p className="muted small">{humanSize(header.size)}</p>
        {playBlob && <VideoPlayer blob={playBlob} filename={header.filename} />}
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
              {phase === "done"
                ? playBlob
                  ? "Ready to play"
                  : "Downloaded"
                : "Downloading & decrypting"}
              : {humanSize(Math.max(0, progress.done))} / {humanSize(progress.total)}
              {progress.total
                ? ` (${Math.min(100, Math.max(0, Math.floor((progress.done / progress.total) * 100)))}%)`
                : ""}
            </p>
          </div>
        )}
        {message && <p className="error">{message}</p>}
        {phase !== "downloading" && !playBlob && (
          <div className="media-actions">
            {canPlayInBrowser && (
              <button className="btn primary fit" onClick={onPlay}>
                Decrypt &amp; play
              </button>
            )}
            <button
              className={canPlayInBrowser ? "btn ghost" : "btn primary fit"}
              onClick={onDownload}
            >
              {isVideo ? "Download video" : "Download & decrypt"}
            </button>
          </div>
        )}
        {phase === "downloading" && (
          <button className="btn ghost" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        )}
      </div>
      <div className="actions">
        {recipientDeleteToken && (
          <RecipientDestroy id={id} token={recipientDeleteToken} onDestroyed={onDestroyed} />
        )}
        <a className="btn ghost" href="#/">
          Create your own
        </a>
      </div>
    </div>
  );
}

function RecipientDestroy({
  id,
  token,
  onDestroyed,
}: {
  id: string;
  token: string;
  onDestroyed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (
      !window.confirm(
        "Permanently delete this from the server? Anyone else with the link will not be able to open it.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteSecret(id, token);
      onDestroyed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn ghost" onClick={onClick} disabled={busy}>
        {busy ? "Deleting…" : "Delete permanently"}
      </button>
      {error && <p className="error">{error}</p>}
    </>
  );
}

function VideoPlayer({ blob, filename }: { blob: Blob; filename?: string }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="video-block">
      {!failed ? (
        <video
          className="player"
          controls
          playsInline
          preload="metadata"
          src={url}
          onError={() => setFailed(true)}
        />
      ) : (
        <p className="muted small video-fallback">
          This browser cannot decode this video (common for AVI and some MOV).
          Download the file and open it in a player.
        </p>
      )}
      <div className="media-actions">
        <a className="btn primary fit" href={url} download={filename ?? "video"}>
          Download video
        </a>
      </div>
    </div>
  );
}

function FileDownload({ payload }: { payload: SecretPayload }) {
  const blob = base64ToBlob(payload.data, payload.mime ?? "application/octet-stream");
  const url = URL.createObjectURL(blob);
  return (
    <div className="media center">
      <p className="file-name">{payload.filename ?? "download"}</p>
      <p className="muted small">{humanSize(blob.size)}</p>
      <a className="btn primary" href={url} download={payload.filename ?? "download"}>
        Download file
      </a>
    </div>
  );
}
