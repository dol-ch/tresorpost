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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState, SelfDestructCard } from "@/components/kit";

function progressPct(done: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function DecryptedLocallyBadge() {
  return (
    <Badge variant="outline" className="w-fit">
      <LockIcon />
      Decrypted locally
    </Badge>
  );
}

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
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" type="button" onClick={copyAll}>
          {copied ? "Copied!" : "Copy text"}
        </Button>
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
  | { state: "destroyed" }
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
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">Decrypting…</p>
        </CardContent>
      </Card>
    );
  }
  if (status.state === "gone") {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
            }
            title="Nothing here"
            description="It was opened, deleted, or it expired. Encrypted notes are removed from the server for good — there is no copy and no way to recover it."
            cta={{ label: "Create your own note", href: "#/" }}
          />
        </CardContent>
      </Card>
    );
  }
  if (status.state === "destroyed") {
    return (
      <Card>
        <CardContent>
          <EmptyState
            tone="primary"
            icon={
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            }
            title="Note destroyed"
            description="The ciphertext has been wiped from the server. Anyone opening the link from now on will see nothing."
            cta={{ label: "Create another note", href: "#/" }}
          />
        </CardContent>
      </Card>
    );
  }
  if (status.state === "error") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2 className="font-heading text-xl font-bold tracking-tight">Could not open</h2>
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
          <Button variant="secondary" asChild>
            <a href="/">Go home</a>
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (status.state === "s3file") {
    return (
      <S3FileView
        status={status}
        id={id}
        recipientDeleteToken={recipientDeleteToken}
        onDestroyed={() => setStatus({ state: "destroyed" })}
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
    <Card>
      <CardContent className="flex flex-col gap-4">
        <DecryptedLocallyBadge />
        <SelfDestructCard opensLine={opensLine} expiry={expiry} />
        {payload.kind === "text" && <RenderedText html={payload.data} />}
        {payload.kind === "image" && (
          <div className="space-y-2 text-center">
            <img
              alt={payload.filename ?? "image"}
              className="mx-auto max-w-full rounded-[14px]"
              src={URL.createObjectURL(base64ToBlob(payload.data, payload.mime ?? "image/*"))}
            />
            <p className="text-sm text-muted-foreground">{payload.filename}</p>
          </div>
        )}
        {payload.kind === "video" && (
          <VideoPlayer
            blob={base64ToBlob(payload.data, payload.mime ?? "video/mp4")}
            filename={payload.filename}
          />
        )}
        {payload.kind === "file" && <FileDownload payload={payload} />}
        <div className="flex flex-col gap-2 pt-1">
          {recipientDeleteToken && (
            <RecipientDestroy
              id={id}
              token={recipientDeleteToken}
              onDestroyed={() => setStatus({ state: "destroyed" })}
            />
          )}
          <Button variant="secondary" asChild>
            <a href="/">Create your own</a>
          </Button>
        </div>
      </CardContent>
    </Card>
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
  const isImage =
    header.kind === "image" || (header.mime || "").startsWith("image/");
  const canPreviewInBrowser =
    (isVideo || isImage) && header.size <= FALLBACK_MAX_BYTES;
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
        `This file is ${humanSize(header.size)} — too large to open in the browser. Download it instead.`,
      );
      return;
    }
    const sink = collectingSink(header.mime || (isImage ? "image/*" : "video/mp4"));
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
    <Card>
      <CardContent className="flex flex-col gap-4">
        <DecryptedLocallyBadge />
        <SelfDestructCard opensLine={opensLine} expiry={expiry} />

        <div className="flex items-center gap-3.5 rounded-[14px] bg-muted p-4">
          <div className="flex size-[46px] flex-none items-center justify-center rounded-[12px] bg-card">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15.5px] font-semibold">
              {header.filename || "download"}
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              {humanSize(header.size)} · decrypted in your browser
            </div>
          </div>
        </div>

        {playBlob && isVideo && <VideoPlayer blob={playBlob} filename={header.filename} />}
        {playBlob && isImage && <ImagePreview blob={playBlob} filename={header.filename} />}
        {progress && (
          <div className="space-y-2" role="status" aria-live="polite">
            <Progress value={progressPct(progress.done, progress.total)} />
            <p className="text-center text-xs text-muted-foreground">
              {phase === "done"
                ? playBlob
                  ? "Ready to play"
                  : "Downloaded"
                : "Downloading & decrypting"}
              : {humanSize(Math.max(0, progress.done))} / {humanSize(progress.total)} (
              {progressPct(progress.done, progress.total)}%)
            </p>
          </div>
        )}
        {message && (
          <Alert variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
        {phase !== "downloading" && !playBlob && (
          <div className="flex flex-col gap-2">
            {canPreviewInBrowser && (
              <Button onClick={onPlay}>{isImage ? "Decrypt & view" : "Decrypt & play"}</Button>
            )}
            <Button variant="secondary" onClick={onDownload}>
              {isVideo ? "Download video" : isImage ? "Download image" : "Download & decrypt"}
            </Button>
          </div>
        )}
        {phase === "downloading" && (
          <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
            Cancel
          </Button>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {recipientDeleteToken && (
            <RecipientDestroy id={id} token={recipientDeleteToken} onDestroyed={onDestroyed} />
          )}
          <Button variant="secondary" asChild>
            <a href="/">Create your own</a>
          </Button>
        </div>
      </CardContent>
    </Card>
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

  async function onConfirm() {
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
    <div className="flex flex-col gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="secondary" className="text-destructive" disabled={busy}>
            {busy ? "Deleting…" : "Delete permanently"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone else with the link will not be able to open it. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="text-destructive" onClick={onConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ImagePreview({ blob, filename }: { blob: Blob; filename?: string }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="flex flex-col items-center gap-3">
      <img alt={filename ?? "image"} className="max-w-full rounded-[14px]" src={url} />
      <Button asChild>
        <a href={url} download={filename ?? "image"}>
          Download image
        </a>
      </Button>
    </div>
  );
}

function VideoPlayer({ blob, filename }: { blob: Blob; filename?: string }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="flex flex-col items-center gap-3">
      {!failed ? (
        <video
          className="max-h-[min(70vh,720px)] w-full rounded-[14px] bg-black"
          controls
          playsInline
          preload="metadata"
          src={url}
          onError={() => setFailed(true)}
        />
      ) : (
        <p className="max-w-prose text-center text-sm text-muted-foreground">
          This browser cannot decode this video (common for AVI and some MOV).
          Download the file and open it in a player.
        </p>
      )}
      <Button asChild>
        <a href={url} download={filename ?? "video"}>
          Download video
        </a>
      </Button>
    </div>
  );
}

function FileDownload({ payload }: { payload: SecretPayload }) {
  const blob = base64ToBlob(payload.data, payload.mime ?? "application/octet-stream");
  const url = URL.createObjectURL(blob);
  return (
    <div className="flex items-center gap-3.5 rounded-[14px] bg-muted p-4">
      <div className="flex size-[46px] flex-none items-center justify-center rounded-[12px] bg-card">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15.5px] font-semibold">
          {payload.filename ?? "download"}
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">{humanSize(blob.size)}</div>
      </div>
      <Button asChild>
        <a href={url} download={payload.filename ?? "download"}>
          Download
        </a>
      </Button>
    </div>
  );
}
