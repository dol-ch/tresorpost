import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { fetchSecret, deleteSecret, fetchConfig, sendContentReport } from "./api";
import { decryptBytes, base64UrlToBytes, type StreamMeta, type StreamHeader } from "./crypto";
import { decodePayload, base64ToBlob, type SecretPayload } from "./payload";
import { displayHTML, RICH_TEXT_SANITIZE } from "./richText";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState, SelfDestructCard } from "@/components/kit";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { useI18n, useT } from "./i18n";

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
  const t = useT();
  return (
    <Badge variant="outline" className="w-fit">
      <LockIcon />
      {t("view.badge")}
    </Badge>
  );
}

function RenderedText({ html }: { html: string }) {
  const t = useT();
  const copyLabel = t("copy.code");
  const copiedLabel = t("copy.copied");
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
      btn.textContent = copyLabel;
      const onClick = async (e: Event) => {
        e.preventDefault();
        const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
        if (await copyText(code)) {
          btn.textContent = copiedLabel;
          window.setTimeout(() => {
            btn.textContent = copyLabel;
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
  }, [html, copyLabel, copiedLabel]);

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
        <Button variant="ghost" size="sm" type="button" onClick={copyAll}>
          {copied ? t("copy.copied") : t("copy.code")}
        </Button>
      </div>
      <div
        className="rendered-text"
        ref={ref}
        dangerouslySetInnerHTML={{
          __html: displayHTML(DOMPurify.sanitize(html, RICH_TEXT_SANITIZE)),
        }}
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

function relativeTime(diffSec: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, {
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

function formatExpiry(sec: number, locale: string): { absolute: string; relative: string } {
  const d = new Date(sec * 1000);
  const absolute = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
  return { absolute, relative: relativeTime(sec - Date.now() / 1000, locale) };
}

export function ViewPage({ id, keyB64Url, recipientDeleteToken }: Props) {
  const t = useT();
  const { intlLocale } = useI18n();
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [reportEnabled, setReportEnabled] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    fetchConfig()
      .then((cfg) => setReportEnabled(Boolean(cfg.report_enabled)))
      .catch(() => {
        /* hide report if config is unavailable */
      });
  }, []);

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
            message: t("view.decryptFailed"),
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
            message: t("view.decryptFailed"),
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
          <p className="text-sm text-muted-foreground">{t("view.decrypting")}</p>
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
            title={t("view.nothingTitle")}
            description={t("view.nothingBody")}
            cta={{ label: t("view.createOwn"), href: "#/" }}
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
            title={t("view.destroyedTitle")}
            description={t("view.destroyedBody")}
            cta={{ label: t("view.createAnother"), href: "#/" }}
          />
        </CardContent>
      </Card>
    );
  }
  if (status.state === "error") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2 className="font-heading text-xl font-bold tracking-tight">{t("view.couldNotOpen")}</h2>
          <Alert variant="destructive">
            <AlertTitle>{t("view.error")}</AlertTitle>
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
          <Button variant="secondary" asChild>
            <a href="/">{t("view.goHome")}</a>
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
        keyB64Url={keyB64Url}
        recipientDeleteToken={recipientDeleteToken}
        reportEnabled={reportEnabled}
        onDestroyed={() => setStatus({ state: "destroyed" })}
      />
    );
  }

  const { payload, viewsRemaining, expiresAt } = status;
  const opensLimited = viewsRemaining !== null;
  const expiry = formatExpiry(expiresAt, intlLocale);
  let opensLine: string | null = null;
  if (opensLimited) {
    opensLine =
      viewsRemaining === 0
        ? t("view.goneOpens")
        : viewsRemaining === 1
          ? t("view.moreOpens1")
          : t("view.moreOpensN", { n: viewsRemaining });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <ViewChrome
          reportEnabled={reportEnabled}
          id={id}
          keyB64Url={keyB64Url}
          recipientDeleteToken={recipientDeleteToken}
          kind={payload.kind}
          onDestroyed={() => setStatus({ state: "destroyed" })}
        />
        <SelfDestructCard opensLine={opensLine} expiry={expiry} />
        {payload.kind === "text" && <RenderedText html={payload.data} />}
        {payload.kind === "image" && (
          <div className="space-y-2 text-center">
            <img
              alt={payload.filename ?? "image"}
              className="mx-auto max-w-full rounded-lg"
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
      </CardContent>
    </Card>
  );
}

type S3Status = Extract<Status, { state: "s3file" }>;

function S3FileView({
  status,
  id,
  keyB64Url,
  recipientDeleteToken,
  reportEnabled,
  onDestroyed,
}: {
  status: S3Status;
  id: string;
  keyB64Url: string;
  recipientDeleteToken?: string;
  reportEnabled: boolean;
  onDestroyed: () => void;
}) {
  const t = useT();
  const { intlLocale } = useI18n();
  const { url, meta, key, header, viewsRemaining, expiresAt } = status;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [phase, setPhase] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [playBlob, setPlayBlob] = useState<Blob | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const expiry = formatExpiry(expiresAt, intlLocale);
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
        ? t("view.goneOpens")
        : viewsRemaining === 1
          ? t("view.moreOpens1")
          : t("view.moreOpensN", { n: viewsRemaining });
  }

  async function onDownload() {
    setMessage(null);
    const useFsa = hasFileSystemAccess();
    if (!useFsa && header.size > FALLBACK_MAX_BYTES) {
      setPhase("error");
      setMessage(
        t("view.streamFail", { size: humanSize(header.size) }),
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
        t("view.tooLargeOpen", { size: humanSize(header.size) }),
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
        <ViewChrome
          reportEnabled={reportEnabled}
          id={id}
          keyB64Url={keyB64Url}
          recipientDeleteToken={recipientDeleteToken}
          kind={isVideo ? "video" : isImage ? "image" : "file"}
          onDestroyed={onDestroyed}
        />
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
              {header.filename || t("view.download")}
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              {humanSize(header.size)} · {t("view.decryptedInBrowser")}
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
                  ? t("view.readyPlay")
                  : t("view.downloaded")
                : t("view.decryptingDl")}
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
              <Button onClick={onPlay}>{isImage ? t("view.decryptView") : t("view.decryptPlay")}</Button>
            )}
            <Button variant="secondary" onClick={onDownload}>
              {isVideo ? t("view.downloadVideo") : isImage ? t("view.downloadImage") : t("view.decryptDownload")}
            </Button>
          </div>
        )}
        {phase === "downloading" && (
          <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
            {t("create.cancel")}
          </Button>
        )}

      </CardContent>
    </Card>
  );
}

const MAX_REPORT_MESSAGE = 2000;

function reportViewUrl(id: string, keyB64Url: string, recipientDeleteToken?: string): string {
  const token = recipientDeleteToken ? `/${recipientDeleteToken}` : "";
  return `${window.location.origin}/#/v/${id}/${keyB64Url}${token}`;
}

function ViewChrome({
  reportEnabled,
  id,
  keyB64Url,
  recipientDeleteToken,
  kind,
  onDestroyed,
}: {
  reportEnabled: boolean;
  id: string;
  keyB64Url: string;
  recipientDeleteToken?: string;
  kind: string;
  onDestroyed: () => void;
}) {
  const t = useT();
  const [reportOpen, setReportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const canReport = reportEnabled && !reported;
  const canDelete = Boolean(recipientDeleteToken);
  const showMore = canReport || canDelete || reported;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <DecryptedLocallyBadge />
        {showMore && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" type="button" aria-label={t("view.more")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {reportEnabled && (
                <DropdownMenuItem
                  disabled={reported}
                  onSelect={() => {
                    if (!reported) setReportOpen(true);
                  }}
                >
                  {reported ? t("view.reported") : t("view.report")}
                </DropdownMenuItem>
              )}
              {reportEnabled && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                  {t("share.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {reportEnabled && (
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          id={id}
          keyB64Url={keyB64Url}
          recipientDeleteToken={recipientDeleteToken}
          kind={kind}
          onSent={() => setReported(true)}
        />
      )}
      {recipientDeleteToken && (
        <DeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          id={id}
          token={recipientDeleteToken}
          onDestroyed={onDestroyed}
        />
      )}
    </>
  );
}

function ReportDialog({
  open,
  onOpenChange,
  id,
  keyB64Url,
  recipientDeleteToken,
  kind,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id: string;
  keyB64Url: string;
  recipientDeleteToken?: string;
  kind: string;
  onSent: () => void;
}) {
  const t = useT();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm(e: MouseEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendContentReport({
        view_url: reportViewUrl(id, keyB64Url, recipientDeleteToken),
        message: message.trim() || undefined,
        kind,
      });
      onSent();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("view.reportTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("view.reportBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`report-message-${id}`}>{t("view.reportMsg")}</Label>
          <Textarea
            id={`report-message-${id}`}
            value={message}
            maxLength={MAX_REPORT_MESSAGE}
            disabled={busy}
            placeholder={t("view.reportWhy")}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("create.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? t("share.sending") : t("view.sendAdmins")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteDialog({
  open,
  onOpenChange,
  id,
  token,
  onDestroyed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id: string;
  token: string;
  onDestroyed: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm(e: MouseEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSecret(id, token);
      onDestroyed();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("view.deleteForever")}</AlertDialogTitle>
          <AlertDialogDescription>{t("view.deleteForeverBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("create.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? t("view.deleting") : t("share.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ImagePreview({ blob, filename }: { blob: Blob; filename?: string }) {
  const t = useT();
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="flex flex-col items-center gap-3">
      <img alt={filename ?? t("create.kindImage")} className="max-w-full rounded-[14px]" src={url} />
      <Button asChild>
        <a href={url} download={filename ?? "image"}>
          {t("view.downloadImage")}
        </a>
      </Button>
    </div>
  );
}

function VideoPlayer({ blob, filename }: { blob: Blob; filename?: string }) {
  const t = useT();
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="flex flex-col items-center gap-3">
      {!failed ? (
        <video
          className="max-h-[min(70vh,720px)] w-full max-w-full rounded-[14px] bg-black"
          controls
          playsInline
          preload="metadata"
          src={url}
          onError={() => setFailed(true)}
        />
      ) : (
        <p className="max-w-prose text-center text-sm text-muted-foreground">
          {t("view.videoFail")}
        </p>
      )}
      <Button asChild>
        <a href={url} download={filename ?? "video"}>
          {t("view.downloadVideo")}
        </a>
      </Button>
    </div>
  );
}

function FileDownload({ payload }: { payload: SecretPayload }) {
  const t = useT();
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
          {payload.filename ?? t("view.download")}
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">{humanSize(blob.size)}</div>
      </div>
      <Button asChild>
        <a href={url} download={payload.filename ?? "download"}>
          {t("view.download")}
        </a>
      </Button>
    </div>
  );
}
