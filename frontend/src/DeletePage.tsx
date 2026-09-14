import { useState } from "react";
import { deleteSecret } from "./api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
        <CardHeader>
          <CardTitle>This note is gone</CardTitle>
          <CardDescription>
            Ciphertext has been removed from the server. Anyone with the share
            link will see that it is no longer available.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <a href="#/">Create another</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Destroy this note now?</CardTitle>
        <CardDescription>
          This cannot be undone. Recipients will no longer be able to open the
          share link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="destructive" onClick={onConfirm} disabled={busy}>
          {busy ? "Deleting…" : "Yes, delete it"}
        </Button>
        <Button variant="outline" asChild>
          <a href="#/">Cancel</a>
        </Button>
      </CardFooter>
    </Card>
  );
}
