import { useEffect, useState } from "react";
import { CreatePage } from "./CreatePage";
import { HomepageStats } from "./HomepageStats";
import { ViewPage } from "./ViewPage";
import { DeletePage } from "./DeletePage";
import { AdminPage } from "./AdminPage";
import { brand } from "./brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type Route =
  | { name: "create" }
  | { name: "view"; id: string; key: string; recipientDeleteToken?: string }
  | { name: "delete"; id: string; token: string }
  | { name: "admin" };

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#/, "");
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "admin") {
    return { name: "admin" };
  }
  if (parts[0] === "d" && parts[1] && parts[2]) {
    return { name: "delete", id: parts[1], token: parts.slice(2).join("/") };
  }
  if ((parts[0] === "s" || parts[0] === "v") && parts[1] && parts[2]) {
    return {
      name: "view",
      id: parts[1],
      key: parts[2],
      recipientDeleteToken: parts[3],
    };
  }
  return { name: "create" };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseRoute());

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.title = `${brand.name} — encrypted transfer`;
  }, []);

  const Wordmark = brand.Wordmark;

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
          <a className="min-w-0" href="#/" aria-label={brand.name}>
            <Wordmark />
          </a>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {brand.tagline}
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-10">
        {route.name === "create" && (
          <>
            <section className="mb-8 space-y-4">
              <Badge variant="secondary">Secure transfer</Badge>
              <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Share a secret only the recipient can read.
              </h1>
              <p className="max-w-2xl text-muted-foreground text-pretty">
                Text, images, video and files are encrypted in your browser and
                decrypted in theirs. The key lives only in the link — it never
                reaches the server, which stores nothing but ciphertext.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">XChaCha20-Poly1305</Badge>
                <Badge variant="outline">256-bit · quantum-safe</Badge>
                <Badge variant="outline">Zero-knowledge server</Badge>
              </div>
            </section>
            <CreatePage />
            <HomepageStats />
          </>
        )}
        {route.name === "view" && (
          <ViewPage
            id={route.id}
            keyB64Url={route.key}
            recipientDeleteToken={route.recipientDeleteToken}
          />
        )}
        {route.name === "delete" && <DeletePage id={route.id} token={route.token} />}
        {route.name === "admin" && <AdminPage />}
      </main>

      <footer className="mt-auto">
        <Separator />
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground">
          <span>Zero-knowledge · keys stay in the URL fragment</span>
          <span className="flex flex-wrap items-center gap-1">
            {brand.footerLinks.map((l) => (
              <Button key={l.href} variant="link" size="sm" className="h-auto px-1" asChild>
                <a href={l.href} target="_blank" rel="noreferrer">
                  {l.label}
                </a>
              </Button>
            ))}
          </span>
        </div>
      </footer>
    </div>
  );
}
