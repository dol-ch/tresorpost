import { useState } from "react";
import { deleteSecret } from "./api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/kit";

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
            description="Ciphertext has been removed from the server. Anyone with the share link will see that it is no longer available."
            cta={{ label: "Create another", href: "#/" }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div>
          <h2 className="mb-1.5 font-heading text-xl font-bold tracking-tight">
            Destroy this note now?
          </h2>
          <p className="text-[14.5px] text-muted-foreground">
            This cannot be undone. Recipients will no longer be able to open the
            share link.
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button variant="secondary" className="text-destructive" onClick={onConfirm} disabled={busy}>
          {busy ? "Deleting…" : "Yes, delete it"}
        </Button>
        <Button variant="secondary" asChild>
          <a href="#/">Cancel</a>
        </Button>
      </CardContent>
    </Card>
  );
}
