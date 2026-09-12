import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { fetchSecret } from "./api";
import { decryptBytes, base64UrlToBytes } from "./crypto";
import { decodePayload, base64ToBlob, type SecretPayload } from "./payload";
import { humanSize } from "./options";

interface Props {
    id: string;
    keyB64Url: string;
}

type Status =
    | { state: "loading" }
    | { state: "gone" }
    | { state: "error"; message: string }
    | { state: "ok"; payload: SecretPayload; viewsRemaining: number | null };

export function ViewPage({ id, keyB64Url }: Props) {
    const [status, setStatus] = useState<Status>({ state: "loading" });
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return; // consume exactly one view per page load
        started.current = true;

        (async () => {
            try {
                const secret = await fetchSecret(id);
                if (!secret) {
                    setStatus({ state: "gone" });
                    return;
                }
                const key = base64UrlToBytes(keyB64Url);
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
                setStatus({ state: "ok", payload, viewsRemaining: secret.views_remaining });
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

    const { payload, viewsRemaining } = status;

    return (
        <div className="card">
            <div className="view-banner">
                <span className="badge">Decrypted locally</span>
                {viewsRemaining !== null && (
                    <span className="muted small">
            {viewsRemaining === 0
                ? "This was the last time this link can be opened."
                : `${viewsRemaining} view(s) remaining after this one.`}
          </span>
                )}
            </div>

            {payload.kind === "text" && (
                <div
                    className="rendered-text"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(payload.data) }}
                />
            )}

            {payload.kind === "image" && (
                <div className="media">
                    <img
                        alt={payload.filename ?? "image"}
                        src={URL.createObjectURL(base64ToBlob(payload.data, payload.mime ?? "image/*"))}
                    />
                    <p className="muted small">{payload.filename}</p>
                </div>
            )}

            {payload.kind === "file" && (
                <FileDownload payload={payload} />
            )}

            <div className="actions">
                <a className="btn ghost" href="#/">
                    Create your own
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
