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
  kindFromFile,
  mimeForUpload,
  type SecretKind,
  type SecretPayload,
} from "./payload";
import { createSecret, fetchConfig, sendShareEmail } from "./api";
import { uploadLargeFile } from "./largeFile";
import { EXPIRY_OPTIONS, MAX_FILE_BYTES, humanSize } from "./options";
import { copyText } from "./clipboard";
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

function kindNoun(kind: Exclude<SecretKind, "text">): string {
  if (kind === "image") return "Image";
  if (kind === "video") return "Video";
  return "File";
}

function optionsSummary(opts: {
  limitViews: boolean;
  maxViews: number;
  allowDelete: boolean;
  allowRecipientDelete: boolean;
}): string {
  const bits: string[] = [];
  if (opts.limitViews) {
    bits.push(opts.maxViews === 1 ? "max 1 open" : `max ${opts.maxViews} opens`);
  }
  if (opts.allowDelete) bits.push("delete link");
  if (opts.allowRecipientDelete) bits.push("recipient can delete");
  return bits.length ? bits.join(" · ") : "Defaults";
}

export function CreatePage() {
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
  const [shareOrigin, setShareOrigin] = useState(() => window.location.origin);

  const editorRef = useRef<EditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [composeDrag, setComposeDrag] = useState(false);
  const [editorEmpty, setEditorEmpty] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    fetchConfig()
      .then((cfg) => {
        if (cfg.max_file_bytes > 0) setMaxFileBytes(cfg.max_file_bytes);
        setS3Enabled(cfg.s3_enabled);
        setMaxS3FileBytes(cfg.max_s3_file_bytes);
        setEmailEnabled(Boolean(cfg.email_enabled));
        if (cfg.short_origin) {
          setShareOrigin(cfg.short_origin.replace(/\/$/, ""));
        }
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
  const effectiveMax = s3Enabled && kind !== "text" ? maxS3FileBytes : maxFileBytes;
  const maxLabel = humanSize(effectiveMax);
  const fileTooBig = !!file && file.size > effectiveMax;

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
        throw new Error("Write something before creating a link.");
      }
      return { kind: "text", data: html };
    }
    if (!file) throw new Error("Choose a file first.");
    if (file.size > effectiveMax) {
      throw new Error(`File is too large (${humanSize(file.size)}). Max is ${maxLabel}.`);
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
        if (!file) throw new Error("Choose a file first.");
        if (file.size > effectiveMax) {
          throw new Error(`File is too large (${humanSize(file.size)}). Max is ${maxLabel}.`);
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
      const url = recipientDeleteToken
        ? `${shareOrigin}/#/v/${id}/${keyUrl}/${recipientDeleteToken}`
        : `${shareOrigin}/#/v/${id}/${keyUrl}`;
      setShareUrl(url);
      setDeleteUrl(
        deleteToken
          ? `${shareOrigin}/#/d/${id}/${deleteToken}`
          : null,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const failed =
        /failed to fetch|networkerror|load failed/i.test(msg)
          ? "Could not reach the server. If this is a large image, the reverse proxy may be rejecting the body — configure S3 or raise client_max_body_size."
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
    if (next && next.size > (s3Enabled ? maxS3FileBytes : maxFileBytes)) {
      const cap = s3Enabled ? maxS3FileBytes : maxFileBytes;
      setError(`File is too large (${humanSize(next.size)}). Max is ${humanSize(cap)}.`);
    }
    setFile(next);
    if (next) setEditorOpen(false);
  }

  if (shareUrl) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Kicker>Share</Kicker>
          <h2 className="-mt-1 font-heading text-2xl font-bold tracking-tight">
            Your encrypted link is ready
          </h2>
          <p className="-mt-2 text-[14.5px] text-muted-foreground">
            Send it any way you like — or let them scan the code. The
            quantum-safe 256-bit key lives only after the{" "}
            <code className="font-mono text-xs">#</code> and never reaches the
            server.
          </p>

          {qr && (
            <div className="flex flex-col items-center gap-2 py-1">
              <img
                src={qr}
                alt="QR code for the encrypted link"
                className="size-[150px] rounded-[16px] bg-muted p-2.5"
              />
              <p className="-mt-1.5 text-[12.5px] font-semibold tracking-[0.03em] text-muted-foreground uppercase">
                Scan to open
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
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="secondary" className="min-w-0 flex-1" asChild>
              <a href={shareUrl} target="_blank" rel="noreferrer">
                Open
              </a>
            </Button>
          </div>

          {emailEnabled && (
            <>
              <div className="mt-0.5 h-px bg-border" />
              <Kicker>Email this link</Kicker>
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
                    {emailBusy ? "Sending…" : "Send"}
                  </Button>
                </div>
                {emailError && (
                  <p className="text-[13px] text-destructive">{emailError}</p>
                )}
                {emailSent && !emailError && (
                  <p className="text-[13px] text-muted-foreground">Sent.</p>
                )}
              </form>
            </>
          )}

          {deleteUrl && (
            <>
              <div className="mt-0.5 h-px bg-border" />
              <Kicker>Delete this note</Kicker>
              <p className="-mt-3 text-[13px] text-muted-foreground">
                Keep this private — it destroys the ciphertext before anyone opens it.
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
                  {copiedDelete ? "Copied" : "Copy"}
                </Button>
                <Button variant="destructive" className="min-w-0 flex-1" asChild>
                  <a href={deleteUrl}>Delete</a>
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
            Create another
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
            composeDrag || (editorOpen && !file)
              ? "overflow-hidden rounded-[14px] border-[1.5px] border-primary bg-card"
              : "overflow-hidden rounded-[14px] border border-border bg-card"
          }
          onDragOver={(e) => {
            e.preventDefault();
            setComposeDrag(true);
          }}
          onDragLeave={() => setComposeDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setComposeDrag(false);
            const dropped = e.dataTransfer.files?.[0] ?? null;
            if (dropped) takeFile(dropped);
          }}
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
                    {fileKind ? kindNoun(fileKind) : "File"} · {humanSize(file.size)} · encrypted in your
                    browser
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove file"
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
                    One note holds one thing. Go back and delete your text, or it
                    will be lost.
                  </span>
                </p>
              )}
            </div>
          ) : !editorOpen && editorEmpty ? (
            <textarea
              readOnly
              rows={5}
              placeholder="Write a message, or drop a file here…"
              aria-label="Write a message"
              className="min-h-[140px] w-full resize-none border-0 bg-transparent p-3.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
              onFocus={() => setEditorOpen(true)}
            />
          ) : null}
          {(editorOpen || !editorEmpty) && (
            <div className={file ? "hidden" : undefined}>
              <RichTextEditor
                ref={editorRef}
                autoFocus={!file}
                onEmptyChange={setEditorEmpty}
                onBlurAway={() => {
                  if (file) return;
                  if (editorRef.current?.isEmpty() === false) return;
                  setEditorOpen(false);
                }}
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-2.5">
            {file ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4" strokeWidth={1.8} />
                Replace file
              </Button>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-[10px] px-1.5 py-1 text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4" strokeWidth={1.8} />
                Attach a file
              </button>
            )}
            <span className="truncate text-[12.5px] text-muted-foreground">
              {fileKind ? `Sent as ${fileKind}` : "Sent as text"}
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
          <Kicker className="mb-2">Self-destruct after</Kicker>
          <Segmented
            aria-label="Self-destruct after"
            value={expiresIn}
            onChange={setExpiresIn}
            options={EXPIRY_OPTIONS.map((o) => ({ value: o.seconds, label: o.label }))}
          />
        </div>

        <div className="rounded-[14px] bg-muted">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen((open) => !open)}
          >
            <span className="text-[15px] font-medium">Options</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] text-muted-foreground">
                {optionsSummary({
                  limitViews,
                  maxViews,
                  allowDelete,
                  allowRecipientDelete,
                })}
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
                <div className="text-[15px] font-medium">Limit number of opens</div>
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
                <div className="text-[15px] font-medium">Keep a private delete link</div>
                <Switch checked={allowDelete} onCheckedChange={setAllowDelete} />
              </div>

              <div className="h-px bg-border" />

              <div className="flex items-center justify-between gap-3">
                <div className="text-[15px] font-medium">Recipient can delete it</div>
                <Switch checked={allowRecipientDelete} onCheckedChange={setAllowRecipientDelete} />
              </div>
            </div>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Could not create the link</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {progress && (
          <div className="space-y-2" role="status" aria-live="polite">
            <Progress value={progressPct(progress.done, progress.total)} />
            <p className="text-center text-xs text-muted-foreground">
              Encrypting &amp; uploading: {humanSize(Math.max(0, progress.done))} /{" "}
              {humanSize(progress.total)} ({progressPct(progress.done, progress.total)}%)
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
          {busy ? (useS3 ? "Uploading…" : "Encrypting…") : "Create encrypted link"}
        </Button>
        {busy && useS3 && (
          <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
            Cancel
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
