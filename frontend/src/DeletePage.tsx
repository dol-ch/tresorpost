import { useState } from "react";
import { deleteSecret } from "./api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/kit";
import { useT } from "./i18n";

export function DeletePage({ id, token }: { id: string; token: string }) {
  const t = useT();
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
            title={t("delete.destroyedTitle")}
            description={t("delete.destroyedBody")}
            cta={{ label: t("share.another"), href: "#/" }}
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
            {t("delete.title")}
          </h2>
          <p className="text-[14.5px] text-muted-foreground">
            {t("delete.body")}
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button variant="secondary" className="text-destructive" onClick={onConfirm} disabled={busy}>
          {busy ? t("view.deleting") : t("delete.yes")}
        </Button>
        <Button variant="secondary" asChild>
          <a href="/">{t("delete.cancel")}</a>
        </Button>
      </CardContent>
    </Card>
  );
}
