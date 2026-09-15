import { useEffect, useState } from "react";
import { CreatePage } from "./CreatePage";
import { HomepageStats } from "./HomepageStats";
import { ViewPage } from "./ViewPage";
import { DeletePage } from "./DeletePage";
import { AdminPage } from "./AdminPage";
import { FaqPage } from "./FaqPage";
import { PrivacyPage } from "./PrivacyPage";
import { brand } from "./brand";
import { SwissFlag } from "./brand/default/SwissFlag";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Kicker } from "@/components/kit";
import { cn } from "@/lib/utils";

type Route =
  | { name: "create" }
  | { name: "view"; id: string; key: string; recipientDeleteToken?: string }
  | { name: "delete"; id: string; token: string }
  | { name: "faq" }
  | { name: "privacy" }
  | { name: "admin" };

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#/, "");
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "admin") {
    return { name: "admin" };
  }
  if (parts[0] === "faq") {
    return { name: "faq" };
  }
  if (parts[0] === "privacy") {
    return { name: "privacy" };
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

function NavLink({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <a
      href={href}
      className={cn(
        "rounded-[9px] px-2.5 py-1.5 font-sans text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "text-primary hover:text-primary",
      )}
    >
      {children}
    </a>
  );
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
  const sendActive = route.name === "create" || route.name === "view" || route.name === "delete";
  const sourceHref =
    brand.footerLinks.find((l) => /github\.com/i.test(l.href))?.href ??
    brand.footerLinks[0]?.href;

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <div className="mx-auto w-full max-w-[720px] px-5 pt-7 pb-18 sm:px-5">
        <nav className="mb-7 flex flex-nowrap items-center gap-1">
          <a
            className="mr-auto inline-flex min-w-0 shrink items-center gap-2 whitespace-nowrap"
            href="#/"
            aria-label={brand.name}
          >
            <Wordmark />
          </a>
          <NavLink href="#/" active={sendActive}>
            Send
          </NavLink>
          <NavLink href="#/faq" active={route.name === "faq"}>
            How it works
          </NavLink>
          <NavLink href="#/privacy" active={route.name === "privacy"}>
            Privacy
          </NavLink>
          <ThemeToggle />
        </nav>

        <main className="flex-1">
          {route.name === "create" && (
            <>
              <section className="mb-7">
                <Kicker className="mb-2">Secure transfer</Kicker>
                <h1 className="mb-3.5 font-heading text-[clamp(27px,7.6vw,40px)] leading-[1.1] font-extrabold tracking-tight text-balance">
                  Share a secret only the recipient can read.
                </h1>
                <p className="mb-3 max-w-[48ch] text-[17px] leading-snug text-muted-foreground text-pretty">
                  Text, images, video and files are encrypted in your browser and
                  decrypted in theirs. The key lives only in the link — it never
                  reaches the server, which stores nothing but ciphertext.
                </p>
                <p className="mb-5 max-w-[48ch] text-[17px] leading-snug text-muted-foreground text-pretty">
                  Swiss storage, no analytics. The service is sovereign: hosted
                  in Switzerland, and stored secrets do not leave the country.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">XChaCha20-Poly1305</Badge>
                  <Badge variant="secondary">256-bit · quantum-safe</Badge>
                  <Badge variant="secondary">Zero-knowledge server</Badge>
                  <Badge variant="secondary">No analytics</Badge>
                  <Badge variant="secondary" className="gap-1.5">
                    <SwissFlag />
                    Hosted in Switzerland
                  </Badge>
                  {sourceHref && (
                    <Badge variant="secondary" asChild>
                      <a href={sourceHref} target="_blank" rel="noreferrer">
                        Open Source
                      </a>
                    </Badge>
                  )}
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
          {route.name === "faq" && <FaqPage />}
          {route.name === "privacy" && <PrivacyPage />}
          {route.name === "admin" && <AdminPage />}
        </main>

        <footer className="mt-9 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
            <span>No analytics · hosted in Switzerland</span>
            <span className="flex flex-wrap items-center gap-3">
              {brand.footerLinks.map((l) => (
                <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
                  {l.label}
                </a>
              ))}
            </span>
          </div>
          {brand.footerCredit && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <span>{brand.footerCredit.text}</span>
              {brand.footerCredit.flag && <brand.footerCredit.flag />}
              <a href={brand.footerCredit.linkHref} target="_blank" rel="noreferrer">
                {brand.footerCredit.linkLabel}
              </a>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
