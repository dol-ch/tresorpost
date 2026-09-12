import { useRef, useState } from "react";
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
import { createSecret } from "./api";
import { EXPIRY_OPTIONS, MAX_FILE_BYTES, humanSize } from "./options";

export function CreatePage() {
    const [kind, setKind] = useState<SecretKind>("text");
    const [file, setFile] = useState<File | null>(null);
    const [expiresIn, setExpiresIn] = useState<number>(EXPIRY_OPTIONS[4].seconds); // 1 hour
    const [limitViews, setLimitViews] = useState(false);
    const [maxViews, setMaxViews] = useState<number>(1);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const editorRef = useRef<EditorHandle>(null);

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
        if (file.size > MAX_FILE_BYTES) {
            throw new Error(`File is too large (${humanSize(file.size)}). Max is 5 MB.`);
        }
        const data = await fileToBase64(file);
        return { kind, data, filename: file.name, mime: file.type || "application/octet-stream" };
    }

    async function onCreate() {
        reset();
        setBusy(true);
        try {
            const payload = await buildPayload();
            const key = generateKey();
            const plaintext = encodePayload(payload);
            const enc = encryptBytes(key, plaintext);

            const id = await createSecret({
                ciphertext: enc.ciphertext,
                nonce: enc.nonce,
                expires_in: expiresIn,
                max_views: limitViews ? Math.max(1, Math.floor(maxViews)) : null,
            });

            const keyUrl = bytesToBase64Url(key);
            const url = `${window.location.origin}/#/v/${id}/${keyUrl}`;
            setShareUrl(url);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    async function copy() {
        if (!shareUrl) return;
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard may be blocked; user can select manually */
        }
    }

    function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const f = e.target.files?.[0] ?? null;
        setError(null);
        if (f && f.size > MAX_FILE_BYTES) {
            setError(`File is too large (${humanSize(f.size)}). Max is 5 MB.`);
        }
        setFile(f);
    }

    if (shareUrl) {
        return (
            <div className="card result">
                <h2>Your encrypted link is ready</h2>
                <p className="muted">
                    Share this link. The decryption key lives only in the part after
                    <code>#</code> and is never sent to the server.
                </p>
                <div className="share-row">
                    <input className="share-input" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
                    <button className="btn" onClick={copy}>
                        {copied ? "Copied!" : "Copy"}
                    </button>
                </div>
                <div className="actions">
                    <a className="btn ghost" href={shareUrl} target="_blank" rel="noreferrer">
                        Open link
                    </a>
                    <button className="btn ghost" onClick={() => { reset(); setFile(null); }}>
                        Create another
                    </button>
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
                    <option value="file">File (max 5 MB)</option>
                </select>
            </div>

            {kind === "text" ? (
                <div className="field">
                    <label>Message</label>
                    <RichTextEditor ref={editorRef} />
                </div>
            ) : (
                <div className="field">
                    <label>{kind === "image" ? "Image" : "File"} (max 5 MB)</label>
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

            <button className="btn primary" onClick={onCreate} disabled={busy}>
                {busy ? "Encrypting…" : "Create encrypted link"}
            </button>
        </div>
    );
}
