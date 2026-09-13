import { useState } from "react";
import { deleteSecret } from "./api";

export function DeletePage({ id, token }: { id: string; token: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      await deleteSecret(id, token);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card result">
        <p className="eyebrow">
          <span className="num">03</span>&nbsp;&nbsp;— Deleted
        </p>
        <h2>This note is gone</h2>
        <p className="muted small">
          Ciphertext has been removed from the server. Anyone with the share
          link will see that it is no longer available.
        </p>
        <a className="btn primary" href="#/">
          Create another
        </a>
      </div>
    );
  }

  return (
    <div className="card">
      <p className="eyebrow">
        <span className="num">03</span>&nbsp;&nbsp;— Delete
      </p>
      <h2>Destroy this note now?</h2>
      <p className="muted small">
        This cannot be undone. Recipients will no longer be able to open the
        share link.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="btn primary" onClick={onConfirm} disabled={busy}>
          {busy ? "Deleting…" : "Yes, delete it"}
        </button>
        <a className="btn ghost" href="#/">
          Cancel
        </a>
      </div>
    </div>
  );
}
