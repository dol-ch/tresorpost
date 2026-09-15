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
  mimeForUpload,
  type SecretKind,
  type SecretPayload,
} from "./payload";
import { createSecret, fetchConfig, sendShareEmail } from "./api";
import { uploadLargeFile } from "./largeFile";
import { EXPIRY_OPTIONS, MAX_FILE_BYTES, humanSize } from "./options";
import { copyText } from "./clipboard";
import { FileDropzone } from "@/components/file-dropzone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Kicker } from "@/components/kit";

function progressPct(done: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

const TYPE_OPTIONS: { value: SecretKind; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "file", label: "File" },
];

export function CreatePage() {
  const [kind, setKind] = useState<SecretKind>("text");
  const [file, setFile] = useState<File | null>(null);
  const [expiresIn, setExpiresIn] = useState<number>(EXPIRY_OPTIONS[1].seconds);
  const [limitViews, setLimitViews] = useState(false);
  const [maxViews, setMaxViews] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedDelete, setCopiedDelete] = useState(false);
  const [allowDelete, setAllowDelete] = useState(true);
  const [allowRecipientDelete, setAllowRecipientDelete] = useState(false);
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

  const useS3 =
    s3Enabled &&
    (kind === "file" ||
      kind === "video" ||
      (kind === "image" && file !== null && file.size > maxFileBytes));
  const effectiveMax = s3Enabled && kind !== "text" ? maxS3FileBytes : maxFileBytes;
  const maxLabel = humanSize(effectiveMax);
  const fileMaxLabel = humanSize(s3Enabled ? maxS3FileBytes : maxFileBytes);
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
        ? `${window.location.origin}/#/v/${id}/${keyUrl}/${recipientDeleteToken}`
        : `${window.location.origin}/#/v/${id}/${keyUrl}`;
      setShareUrl(url);
      setDeleteUrl(
        deleteToken
          ? `${window.location.origin}/#/d/${id}/${deleteToken}`
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

  function onFile(next: File | null) {
    setError(null);
    if (next && next.size > effectiveMax) {
      setError(`File is too large (${humanSize(next.size)}). Max is ${maxLabel}.`);
    }
    setFile(next);
  }

  if (shareUrl) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4.5">
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
          <Button
            type="button"
            onClick={async () => {
              if (await copyText(shareUrl)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button variant="secondary" asChild>
            <a href={shareUrl} target="_blank" rel="noreferrer">
              Open link
            </a>
          </Button>

          <div className="mt-1 h-px bg-border" />
          <Kicker>Email this link</Kicker>
          <p className="-mt-3 text-[13.5px] text-muted-foreground">
            Send the same link by email. It will self-destruct after the
            timer you chose.
          </p>
          <form
            className="flex flex-col gap-2.5"
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
            <Input
              type="email"
              autoComplete="email"
              required
              placeholder="recipient@example.com"
              value={emailTo}
              disabled={emailBusy}
              onChange={(e) => setEmailTo(e.target.value)}
            />
            {emailError && (
              <Alert variant="destructive">
                <AlertDescription>{emailError}</AlertDescription>
              </Alert>
            )}
            {emailSent && !emailError && (
              <p className="text-[13.5px] text-muted-foreground">Sent. You can email someone else.</p>
            )}
            <Button type="submit" variant="secondary" disabled={emailBusy}>
              {emailBusy ? "Sending…" : "Send email"}
            </Button>
          </form>

          {deleteUrl && (
            <>
              <div className="mt-1 h-px bg-border" />
              <Kicker>Keep this to delete the note</Kicker>
              <p className="-mt-3 text-[13.5px] text-muted-foreground">
                Do not send this with the share link — anyone holding it can
                destroy the note before it is opened.
              </p>
              <Input readOnly value={deleteUrl} className="font-mono text-[13px]" />
              <Button
                variant="secondary"
                type="button"
                onClick={async () => {
                  if (await copyText(deleteUrl)) {
                    setCopiedDelete(true);
                    setTimeout(() => setCopiedDelete(false), 1500);
                  }
                }}
              >
                {copiedDelete ? "Copied" : "Copy delete link"}
              </Button>
              <Button variant="secondary" className="text-destructive" asChild>
                <a href={deleteUrl}>Delete this note</a>
              </Button>
            </>
          )}

          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              reset();
              setFile(null);
            }}
          >
            Create another
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-[22px]">
        <div>
          <Kicker className="mb-2">Type</Kicker>
          <Segmented
            aria-label="Secret type"
            value={kind}
            onChange={(v) => {
              setKind(v);
              setFile(null);
              setError(null);
            }}
            options={TYPE_OPTIONS}
          />
        </div>

        {kind === "text" ? (
          <div>
            <Kicker className="mb-2">Message</Kicker>
            <RichTextEditor ref={editorRef} />
          </div>
        ) : (
          <div>
            <Kicker className="mb-2">
              {kind === "image" ? "Image" : kind === "video" ? "Video" : "File"} (max{" "}
              {maxLabel})
            </Kicker>
            <FileDropzone
              label={`Drop ${kind === "image" ? "an image" : kind === "video" ? "a video" : "a file"} here, or click to browse`}
              file={file}
              accept={
                kind === "image"
                  ? "image/*"
                  : kind === "video"
                    ? "video/*,.mov,.avi,.mkv,.webm,.mp4,.m4v,.ogv,.3gp"
                    : undefined
              }
              onFile={onFile}
            />
            {kind === "image" && !s3Enabled && (
              <p className="mt-2 text-[13px] text-muted-foreground">
                Without S3, images are limited to {humanSize(maxFileBytes)}. Phone
                photos are often larger — set S3_* in .env.
              </p>
            )}
          </div>
        )}

        <div>
          <Kicker className="mb-2">Self-destruct after</Kicker>
          <Segmented
            aria-label="Self-destruct after"
            value={expiresIn}
            onChange={setExpiresIn}
            options={EXPIRY_OPTIONS.map((o) => ({ value: o.seconds, label: o.label }))}
          />
        </div>

        <div className="flex flex-col gap-4 rounded-[14px] bg-muted p-4">
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

          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-medium">Let me delete this note later</div>
              <div className="mt-0.5 text-[13px] text-muted-foreground">
                A private delete link — not part of the share URL.
              </div>
            </div>
            <Switch checked={allowDelete} onCheckedChange={setAllowDelete} />
          </div>

          <div className="h-px bg-border" />

          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-medium">Recipient can permanently delete</div>
              <div className="mt-0.5 text-[13px] text-muted-foreground">
                Adds a destroy button on the open page.
              </div>
            </div>
            <Switch checked={allowRecipientDelete} onCheckedChange={setAllowRecipientDelete} />
          </div>
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
