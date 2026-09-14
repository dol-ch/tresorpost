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
import { createSecret, fetchConfig } from "./api";
import { uploadLargeFile } from "./largeFile";
import { EXPIRY_OPTIONS, MAX_FILE_BYTES, humanSize } from "./options";
import { copyText } from "./clipboard";
import { FileDropzone } from "@/components/file-dropzone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function progressPct(done: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

export function CreatePage() {
  const [kind, setKind] = useState<SecretKind>("text");
  const [file, setFile] = useState<File | null>(null);
  const [expiresIn, setExpiresIn] = useState<number>(EXPIRY_OPTIONS[4].seconds);
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
        <CardHeader>
          <CardTitle>Your encrypted link is ready</CardTitle>
          <CardDescription>
            Send it any way you like — or let them scan the code. The quantum-safe
            256-bit key lives only after the <code className="font-mono text-xs">#</code> and
            never reaches the server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {qr && (
            <div className="flex flex-col items-center gap-2">
              <img
                src={qr}
                alt="QR code for the encrypted link"
                className="size-36 rounded-md border bg-white p-2"
              />
              <p className="text-xs text-muted-foreground">Scan to open</p>
            </div>
          )}
          <p className="break-all rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed select-all">
            {shareUrl}
          </p>
          <div className="flex flex-col gap-2">
            <Button type="button" onClick={async () => {
              if (await copyText(shareUrl)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}>
              {copied ? "Copied!" : "Copy link"}
            </Button>
            <Button variant="outline" asChild>
              <a href={shareUrl} target="_blank" rel="noreferrer">
                Open link
              </a>
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                reset();
                setFile(null);
              }}
            >
              Create another
            </Button>
          </div>
          {deleteUrl && (
            <div className="space-y-3 border-t pt-4">
              <div>
                <p className="text-sm font-medium">Keep this to delete the note</p>
                <p className="text-sm text-muted-foreground">
                  Do not send this with the share link. Anyone with it can destroy
                  the note before it is opened.
                </p>
              </div>
              <p className="break-all rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed select-all">
                {deleteUrl}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  type="button"
                  onClick={async () => {
                    if (await copyText(deleteUrl)) {
                      setCopiedDelete(true);
                      setTimeout(() => setCopiedDelete(false), 1500);
                    }
                  }}
                >
                  {copiedDelete ? "Copied!" : "Copy delete link"}
                </Button>
                <Button variant="outline" asChild>
                  <a href={deleteUrl}>Delete this note</a>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>Type</FieldLabel>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as SecretKind);
                setFile(null);
                setError(null);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="image">Image</SelectItem>
                <SelectItem value="video">Video (max {fileMaxLabel})</SelectItem>
                <SelectItem value="file">File (max {fileMaxLabel})</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {kind === "text" ? (
            <Field>
              <FieldLabel>Message</FieldLabel>
              <RichTextEditor ref={editorRef} />
            </Field>
          ) : (
            <Field>
              <FieldLabel>
                {kind === "image" ? "Image" : kind === "video" ? "Video" : "File"}{" "}
                (max {maxLabel})
              </FieldLabel>
              <FileDropzone
                label={file ? `${humanSize(file.size)}` : "Choose a file"}
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
                <FieldDescription>
                  Without S3, images are limited to {humanSize(maxFileBytes)}. Phone
                  photos are often larger — set S3_* in .env.
                </FieldDescription>
              )}
            </Field>
          )}

          <Field>
            <FieldLabel>Self-destruct after</FieldLabel>
            <Select
              value={String(expiresIn)}
              onValueChange={(v) => setExpiresIn(Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {EXPIRY_OPTIONS.map((o) => (
                  <SelectItem key={o.seconds} value={String(o.seconds)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <FieldSeparator />

          <Field orientation="horizontal">
            <Checkbox
              id="limit-views"
              checked={limitViews}
              onCheckedChange={(v) => setLimitViews(v === true)}
            />
            <FieldContent>
              <FieldLabel htmlFor="limit-views">Limit number of opens</FieldLabel>
              {limitViews && (
                <Input
                  className="mt-2 max-w-24"
                  type="number"
                  min={1}
                  value={maxViews}
                  onChange={(e) => setMaxViews(Math.max(1, Number(e.target.value) || 1))}
                />
              )}
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <Checkbox
              id="allow-delete"
              checked={allowDelete}
              onCheckedChange={(v) => setAllowDelete(v === true)}
            />
            <FieldContent>
              <FieldLabel htmlFor="allow-delete">Let me delete this note later</FieldLabel>
              <FieldDescription>
                You get a private delete link. It is not part of the share URL.
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <Checkbox
              id="recipient-delete"
              checked={allowRecipientDelete}
              onCheckedChange={(v) => setAllowRecipientDelete(v === true)}
            />
            <FieldContent>
              <FieldLabel htmlFor="recipient-delete">
                Recipient can permanently delete
              </FieldLabel>
              <FieldDescription>
                Puts a destroy button on the open page. Anyone with the share link
                can wipe the ciphertext from the server.
              </FieldDescription>
            </FieldContent>
          </Field>

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
        </FieldGroup>
      </CardContent>
      <CardFooter className="flex-col gap-2 sm:flex-col">
        <Button
          className="w-full"
          onClick={onCreate}
          disabled={busy || fileTooBig || (kind !== "text" && !file)}
        >
          {busy ? (useS3 ? "Uploading…" : "Encrypting…") : "Create encrypted link"}
        </Button>
        {busy && useS3 && (
          <Button variant="outline" className="w-full" onClick={() => abortRef.current?.abort()}>
            Cancel
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
