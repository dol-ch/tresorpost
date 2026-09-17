import { useEffect, useRef, useState, type DragEvent } from "react";
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
  kindFromFile,
  mimeForUpload,
  type SecretKind,
  type SecretPayload,
} from "./payload";
import { createSecret, fetchConfig, mintDeleteUrl, mintShareUrl, sendShareEmail } from "./api";
import { uploadLargeFile } from "./largeFile";
import { EXPIRY_OPTIONS, MAX_FILE_BYTES, humanSize, uploadMaxBytes } from "./options";
import { copyText } from "./clipboard";
import { useT, type Translate } from "./i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Kicker } from "@/components/kit";
import { ChevronDown, CircleAlert, File as FileIcon, Paperclip, X } from "lucide-react";

function progressPct(done: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

function kindNoun(kind: Exclude<SecretKind, "text">, t: Translate): string {
  if (kind === "image") return t("create.kindImage");
  if (kind === "video") return t("create.kindVideo");
  return t("create.kindFile");
}

function dataTransferHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  if (dt.files.length > 0) return true;
  return Array.from(dt.types).includes("Files");
}

function firstDroppedFile(dt: DataTransfer | null): File | null {
  return dt?.files?.[0] ?? null;
}

function optionsSummary(
  opts: {
    limitViews: boolean;
    maxViews: number;
    allowDelete: boolean;
    allowRecipientDelete: boolean;
  },
  t: Translate,
): string {
  const bits: string[] = [];
  if (opts.limitViews) {
    bits.push(
      opts.maxViews === 1 ? t("create.optMax1") : t("create.optMaxN", { n: opts.maxViews }),
    );
  }
  if (opts.allowDelete) bits.push(t("create.optDeleteLink"));
  if (opts.allowRecipientDelete) bits.push(t("create.optRecipientDelete"));
  return bits.length ? bits.join(" · ") : t("create.optDefaults");
}

export function CreatePage() {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const fileKind = file ? kindFromFile(file) : null;
  const kind: SecretKind = fileKind ?? "text";
  const [expiresIn, setExpiresIn] = useState<number>(EXPIRY_OPTIONS[1].seconds);
  const [limitViews, setLimitViews] = useState(false);
  const [maxViews, setMaxViews] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedDelete, setCopiedDelete] = useState(false);
  const [allowDelete, setAllowDelete] = useState(false);
  const [allowRecipientDelete, setAllowRecipientDelete] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [deleteUrl, setDeleteUrl] = useState<string | null>(null);
  const [maxFileBytes, setMaxFileBytes] = useState<number>(MAX_FILE_BYTES);
  const [s3Enabled, setS3Enabled] = useState(false);
  const [maxS3FileBytes, setMaxS3FileBytes] = useState<number>(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const editorRef = useRef<EditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [composeDrag, setComposeDrag] = useState(false);
  const [editorEmpty, setEditorEmpty] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    const blockBrowserFileOpen = (e: Event) => {
      e.preventDefault();
    };
    window.addEventListener("dragover", blockBrowserFileOpen);
    window.addEventListener("drop", blockBrowserFileOpen);
    return () => {
      window.removeEventListener("dragover", blockBrowserFileOpen);
      window.removeEventListener("drop", blockBrowserFileOpen);
    };
  }, []);

  useEffect(() => {
    fetchConfig()
      .then((cfg) => {
        if (cfg.max_file_bytes > 0) setMaxFileBytes(cfg.max_file_bytes);
        setS3Enabled(cfg.s3_enabled);
        setMaxS3FileBytes(cfg.max_s3_file_bytes);
        setEmailEnabled(Boolean(cfg.email_enabled));
      })
      .catch(() => {
        /* keep the default limit if config is unavailable */
      });
  }, []);

  const useS3 =
    s3Enabled &&
    kind !== "text" &&
    (kind === "file" ||
      kind === "video" ||
      (kind === "image" && file !== null && file.size > maxFileBytes));
  const uploadMax = uploadMaxBytes(s3Enabled, maxS3FileBytes, maxFileBytes);
  const maxLabel = humanSize(uploadMax);
  const fileTooBig = !!file && file.size > uploadMax;

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
    setDeleteUrl(null);
    setError(null);
    setCopied(false);
    setCopiedDelete(false);
    setEmailTo("");
    setEmailBusy(false);
    setEmailError(null);
    setEmailSent(false);
  }

  async function buildPayload(): Promise<SecretPayload> {
    if (kind === "text") {
      const html = editorRef.current?.getHTML() ?? "";
      if (!html || editorRef.current?.isEmpty()) {
        throw new Error(t("create.writeFirst"));
      }
      return { kind: "text", data: html };
    }
    if (!file) throw new Error(t("create.chooseFile"));
    if (file.size > uploadMax) {
      throw new Error(t("create.tooLarge", { size: humanSize(file.size), cap: maxLabel }));
    }
    const data = await fileToBase64(file);
    return { kind, data, filename: file.name, mime: mimeForUpload(file, kind) };
  }

  async function onCreate() {
    reset();
    setBusy(true);
    const maxViewsVal = limitViews ? Math.max(1, Math.floor(maxViews)) : null;
    try {
      let id: string;
      let key: Uint8Array;
      let deleteToken: string | undefined;
      let recipientDeleteToken: string | undefined;

      if (useS3) {
        if (!file) throw new Error(t("create.chooseFile"));
        if (file.size > uploadMax) {
          throw new Error(t("create.tooLarge", { size: humanSize(file.size), cap: maxLabel }));
        }
        const ac = new AbortController();
        abortRef.current = ac;
        setProgress({ done: 0, total: file.size });
        const res = await uploadLargeFile({
          file,
          kind: kind === "video" ? "video" : kind === "image" ? "image" : "file",
          expiresIn,
          maxViews: maxViewsVal,
          allowDelete,
          allowRecipientDelete,
          onProgress: (done, total) =>
            setProgress((p) => ({ done: Math.max(p?.done ?? 0, done), total })),
          signal: ac.signal,
        });
        id = res.id;
        key = res.key;
        deleteToken = res.delete_token;
        recipientDeleteToken = res.recipient_delete_token;
      } else {
        const payload = await buildPayload();
        key = generateKey();
        const plaintext = encodePayload(payload);
        const enc = encryptBytes(key, plaintext);
        const created = await createSecret({
          ciphertext: enc.ciphertext,
          nonce: enc.nonce,
          expires_in: expiresIn,
          max_views: maxViewsVal,
          kind: payload.kind,
          allow_delete: allowDelete,
          allow_recipient_delete: allowRecipientDelete,
        });
        id = created.id;
        deleteToken = created.delete_token;
        recipientDeleteToken = created.recipient_delete_token;
      }

      const keyUrl = bytesToBase64Url(key);
      setShareUrl(
        mintShareUrl(window.location.origin, id, keyUrl, recipientDeleteToken),
      );
      setDeleteUrl(
        deleteToken
          ? mintDeleteUrl(window.location.origin, id, deleteToken)
          : null,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const failed =
        /failed to fetch|networkerror|load failed/i.test(msg)
          ? t("create.networkFail")
          : msg;
      setError(failed);
    } finally {
      abortRef.current = null;
      setProgress(null);
      setBusy(false);
    }
  }

  function takeFile(next: File | null) {
    setError(null);
    if (next && next.size > uploadMax) {
      setError(t("create.tooLarge", { size: humanSize(next.size), cap: maxLabel }));
    }
    setFile(next);
    if (next) setEditorOpen(false);
  }

  function onComposeFileDrag(e: DragEvent) {
    if (!dataTransferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setComposeDrag(true);
  }

  function onComposeDragLeave(e: DragEvent) {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (
      e.clientX >= box.left &&
      e.clientX <= box.right &&
      e.clientY >= box.top &&
      e.clientY <= box.bottom
    ) {
      return;
    }
    setComposeDrag(false);
  }

  function onComposeDrop(e: DragEvent) {
    if (!dataTransferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setComposeDrag(false);
    const dropped = firstDroppedFile(e.dataTransfer);
    if (dropped) takeFile(dropped);
  }

  if (shareUrl) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Kicker>{t("share.kicker")}</Kicker>
          <h2 className="-mt-1 font-heading text-2xl font-bold tracking-tight">
            {t("share.title")}
          </h2>
          <p className="-mt-2 text-[14.5px] text-muted-foreground">
            {t("share.lead")}
          </p>

          {qr && (
            <div className="flex flex-col items-center gap-2 py-1">
              <img
                src={qr}
                alt={t("share.qrAlt")}
                className="size-[150px] rounded-[16px] bg-muted p-2.5"
              />
              <p className="-mt-1.5 text-[12.5px] font-semibold tracking-[0.03em] text-muted-foreground uppercase">
                {t("share.scan")}
              </p>
            </div>
          )}

          <Input readOnly value={shareUrl} className="font-mono text-[13px]" />
          <div className="flex gap-2">
            <Button
              className="min-w-0 flex-1"
              type="button"
              onClick={async () => {
                if (await copyText(shareUrl)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              {copied ? t("share.copied") : t("share.copy")}
            </Button>
            <Button variant="secondary" className="min-w-0 flex-1" asChild>
              <a href={shareUrl} target="_blank" rel="noreferrer">
                {t("share.open")}
              </a>
            </Button>
          </div>

          {emailEnabled && (
            <>
              <div className="mt-0.5 h-px bg-border" />
              <Kicker>{t("share.emailKicker")}</Kicker>
              <form
                className="flex flex-col gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!shareUrl || emailBusy) return;
                  setEmailBusy(true);
                  setEmailError(null);
                  setEmailSent(false);
                  try {
                    await sendShareEmail({
                      to: emailTo.trim(),
                      url: shareUrl,
                      expires_in: expiresIn,
                      max_views: limitViews ? maxViews : null,
                    });
                    setEmailSent(true);
                    setEmailTo("");
                  } catch (err) {
                    setEmailError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setEmailBusy(false);
                  }
                }}
              >
                <div className="flex gap-2">
                  <Input
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="name@email.com"
                    value={emailTo}
                    disabled={emailBusy}
                    onChange={(e) => setEmailTo(e.target.value)}
                    className="min-w-0 flex-1"
                  />
                  <Button type="submit" className="shrink-0 px-4" disabled={emailBusy}>
                    {emailBusy ? t("share.sending") : t("share.send")}
                  </Button>
                </div>
                {emailError && (
                  <p className="text-[13px] text-destructive">{emailError}</p>
                )}
                {emailSent && !emailError && (
                  <p className="text-[13px] text-muted-foreground">{t("share.sent")}</p>
                )}
              </form>
            </>
          )}

          {deleteUrl && (
            <>
              <div className="mt-0.5 h-px bg-border" />
              <Kicker>{t("share.deleteKicker")}</Kicker>
              <p className="-mt-3 text-[13px] text-muted-foreground">
                {t("share.deleteLead")}
              </p>
              <Input readOnly value={deleteUrl} className="font-mono text-[13px]" />
              <div className="flex gap-2">
                <Button
                  className="min-w-0 flex-1"
                  type="button"
                  onClick={async () => {
                    if (await copyText(deleteUrl)) {
                      setCopiedDelete(true);
                      setTimeout(() => setCopiedDelete(false), 1500);
                    }
                  }}
                >
                  {copiedDelete ? t("share.copied") : t("share.copy")}
                </Button>
                <Button variant="destructive" className="min-w-0 flex-1" asChild>
                  <a href={deleteUrl}>{t("share.delete")}</a>
                </Button>
              </div>
            </>
          )}

          <button
            type="button"
            className="mt-1 text-center text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => {
              reset();
              setFile(null);
              setEditorEmpty(true);
              setEditorOpen(false);
            }}
          >
            {t("share.another")}
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-[22px]">
        <div
          className={
            composeDrag
              ? "overflow-hidden rounded-[14px] border-[1.5px] border-dashed border-primary bg-primary/8"
              : editorOpen && !file
                ? "overflow-hidden rounded-[14px] border-[1.5px] border-primary bg-card"
                : "overflow-hidden rounded-[14px] border border-border bg-card"
          }
          onDragEnterCapture={onComposeFileDrag}
          onDragOverCapture={onComposeFileDrag}
          onDragLeave={onComposeDragLeave}
          onDropCapture={onComposeDrop}
        >
          {file ? (
            <div className="flex flex-col gap-3 px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-primary/10 text-primary">
                  <FileIcon className="size-5" strokeWidth={1.8} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{file.name}</div>
                  <div className="text-[13px] text-muted-foreground">
                    {fileKind ? kindNoun(fileKind, t) : t("create.kindFile")} · {humanSize(file.size)} · {t("create.encryptedInBrowser")}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("create.removeFile")}
                  onClick={() => {
                    takeFile(null);
                    setEditorOpen(!editorEmpty);
                  }}
                >
                  <X />
                </Button>
              </div>
              {!editorEmpty && (
                <p className="flex items-start gap-2 text-[13px] text-destructive">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
                  <span>
                    {t("create.oneThing")}
                  </span>
                </p>
              )}
            </div>
          ) : !editorOpen && editorEmpty ? (
            <textarea
              readOnly
              rows={5}
              placeholder={t("create.placeholder", { cap: maxLabel })}
              aria-label={t("create.ariaWrite")}
              className="min-h-[140px] w-full resize-none border-0 bg-transparent p-3.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
              onFocus={() => setEditorOpen(true)}
            />
          ) : null}
          {(editorOpen || !editorEmpty) && (
            <div className={file ? "hidden" : undefined}>
              <RichTextEditor
                ref={editorRef}
                autoFocus={!file}
                placeholder={t("editor.placeholder")}
                onEmptyChange={setEditorEmpty}
                onBlurAway={() => {
                  if (file) return;
                  if (editorRef.current?.isEmpty() === false) return;
                  setEditorOpen(false);
                }}
              />
            </div>
          )}
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3.5 py-2.5">
            {file ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4" strokeWidth={1.8} />
                {t("create.replace")}
              </Button>
            ) : (
              <button
                type="button"
                className="inline-flex min-w-0 items-center gap-2 rounded-[10px] px-1.5 py-1 text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                aria-label={t("create.attachAria", { cap: maxLabel })}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4 shrink-0" strokeWidth={1.8} />
                {t("create.attach")}
                <span className="truncate font-normal text-muted-foreground/75">{t("create.upTo", { cap: maxLabel })}</span>
              </button>
            )}
            <span className="truncate text-[12.5px] text-muted-foreground">
              {fileKind
                ? t("create.sentAs", { kind: kindNoun(fileKind, t) })
                : t("create.sentAsText")}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              onChange={(e) => {
                takeFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div>
          <Kicker className="mb-2">{t("create.selfDestruct")}</Kicker>
          <Segmented
            aria-label={t("create.selfDestruct")}
            value={expiresIn}
            onChange={setExpiresIn}
            options={EXPIRY_OPTIONS.map((o, i) => ({
              value: o.seconds,
              label: t(
                (["create.expiry5min", "create.expiry1hour", "create.expiry1day", "create.expiry7days"] as const)[i],
              ),
            }))}
          />
        </div>

        <div className="rounded-[14px] bg-muted">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen((open) => !open)}
          >
            <span className="text-[15px] font-medium">{t("create.options")}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] text-muted-foreground">
                {optionsSummary({
                  limitViews,
                  maxViews,
                  allowDelete,
                  allowRecipientDelete,
                }, t)}
              </span>
              <ChevronDown
                className={
                  optionsOpen
                    ? "size-4 shrink-0 rotate-180 text-muted-foreground"
                    : "size-4 shrink-0 text-muted-foreground"
                }
                strokeWidth={1.8}
              />
            </span>
          </button>
          {optionsOpen && (
            <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[15px] font-medium">{t("create.limitOpens")}</div>
                <Switch checked={limitViews} onCheckedChange={setLimitViews} />
              </div>
              {limitViews && (
                <Input
                  type="number"
                  min={1}
                  className="max-w-25"
                  value={maxViews}
                  onChange={(e) => setMaxViews(Math.max(1, Number(e.target.value) || 1))}
                />
              )}

              <div className="h-px bg-border" />

              <div className="flex items-center justify-between gap-3">
                <div className="text-[15px] font-medium">{t("create.keepDeleteLink")}</div>
                <Switch checked={allowDelete} onCheckedChange={setAllowDelete} />
              </div>

              <div className="h-px bg-border" />

              <div className="flex items-center justify-between gap-3">
                <div className="text-[15px] font-medium">{t("create.recipientDelete")}</div>
                <Switch checked={allowRecipientDelete} onCheckedChange={setAllowRecipientDelete} />
              </div>
            </div>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>{t("create.createError")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {progress && (
          <div className="space-y-2" role="status" aria-live="polite">
            <Progress value={progressPct(progress.done, progress.total)} />
            <p className="text-center text-xs text-muted-foreground">
              {t("create.progress", {
                done: humanSize(Math.max(0, progress.done)),
                total: humanSize(progress.total),
                pct: `${progressPct(progress.done, progress.total)}%`,
              })}
            </p>
          </div>
        )}

        <Button
          className="w-full"
          onClick={onCreate}
          disabled={busy || fileTooBig || (kind !== "text" && !file)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {busy ? (useS3 ? t("create.uploading") : t("create.encrypting")) : t("create.createLink")}
        </Button>
        {busy && useS3 && (
          <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
            {t("create.cancel")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
