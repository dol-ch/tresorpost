import { useEffect, useState, type MouseEvent } from "react";
import { CreatePage } from "./CreatePage";
import { ViewPage } from "./ViewPage";
import { DeletePage } from "./DeletePage";
import { AdminPage } from "./AdminPage";
import { FaqPage } from "./FaqPage";
import { PrivacyPage } from "./PrivacyPage";
import { brand } from "./brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { applySeo } from "./seo";
import { useI18n } from "./i18n";

type Route =
  | { name: "create" }
  | { name: "view"; id: string; key: string; recipientDeleteToken?: string }
  | { name: "delete"; id: string; token: string }
  | { name: "faq" }
  | { name: "privacy" }
  | { name: "admin" };

function isGitHubHost(href: string): boolean {
  try {
    const { hostname } = new URL(href);
    const normalized = hostname.toLowerCase();
    return normalized === "github.com" || normalized.endsWith(".github.com");
  } catch {
    return false;
  }
}

function pathnameKey(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function parseRoute(): Route {
  const path = pathnameKey();
  if (path === "/faq") return { name: "faq" };
  if (path === "/privacy") return { name: "privacy" };
  if (path === "/admin") return { name: "admin" };

  const hash = window.location.hash.replace(/^#/, "");
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "admin") return { name: "admin" };
  if (parts[0] === "faq") return { name: "faq" };
  if (parts[0] === "privacy") return { name: "privacy" };
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

/** Move legacy `#/faq` style marketing URLs onto real paths crawlers can index. */
function migrateHashMarketingUrls() {
  const parts = window.location.hash.replace(/^#/, "").split("/").filter(Boolean);
  const map: Record<string, string> = { faq: "/faq", privacy: "/privacy", admin: "/admin" };
  const dest = parts[0] ? map[parts[0]] : undefined;
  if (dest && pathnameKey() === "/") {
    window.history.replaceState(null, "", dest);
  }
}

function onInternalClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey
  ) {
    return;
  }
  event.preventDefault();
  const next = new URL(href, window.location.origin);
  const dest =
    next.pathname === "/" && !next.search && !next.hash
      ? "/"
      : `${next.pathname}${next.search}${next.hash}`;
  window.history.pushState(null, "", dest);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function NavLink({
  href,
  active,
  children,
  onClick,
}: {
  href: string;
  active: boolean;
  children: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <a
      href={href}
      onClick={(event) => (onClick ? onClick(event) : onInternalClick(event, href))}
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
  const [route, setRoute] = useState<Route>(parseRoute);
  const [composeKey, setComposeKey] = useState(0);
  const { t, locale } = useI18n();

  function goHome(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    window.history.pushState(null, "", "/");
    setComposeKey((k) => k + 1);
    setRoute({ name: "create" });
  }

  useEffect(() => {
    migrateHashMarketingUrls();
    setRoute(parseRoute());
    const onChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, []);

  useEffect(() => {
    const name = brand.name;
    if (route.name === "faq") {
      applySeo({
        title: t("seo.faqTitle").replace("Tresorpost", name),
        description: t("seo.faqDesc"),
        path: "/faq",
        locale,
      });
      return;
    }
    if (route.name === "privacy") {
      applySeo({
        title: t("seo.privacyTitle").replace("Tresorpost", name),
        description: t("seo.privacyDesc"),
        path: "/privacy",
        locale,
      });
      return;
    }
    if (route.name === "view" || route.name === "delete" || route.name === "admin") {
      applySeo({
        title: t("seo.noindexTitle").replace("Tresorpost", name),
        description: t("seo.homeDesc"),
        path: "/",
        noindex: true,
        locale,
      });
      return;
    }
    applySeo({
      title: t("seo.homeTitle").replace("Tresorpost", name),
      description: t("seo.homeDesc"),
      path: "/",
      locale,
    });
  }, [route, t, locale]);

  const Wordmark = brand.Wordmark;
  const sendActive = route.name === "create" || route.name === "view" || route.name === "delete";

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <div className="mx-auto w-full max-w-[720px] px-5 pt-7 pb-18 sm:px-5">
        <nav className="mb-7 flex flex-nowrap items-center gap-1" aria-label={t("nav.primary")}>
          <a
            className="mr-auto inline-flex min-w-0 shrink items-center gap-2 whitespace-nowrap"
            href="/"
            onClick={goHome}
            aria-label={brand.name}
          >
            <Wordmark />
          </a>
          <NavLink href="/" active={sendActive} onClick={goHome}>
            {t("nav.send")}
          </NavLink>
          <NavLink href="/faq" active={route.name === "faq"}>
            {t("nav.how")}
          </NavLink>
          <NavLink href="/privacy" active={route.name === "privacy"}>
            {t("nav.privacy")}
          </NavLink>
          <ThemeToggle />
        </nav>

        <main className="flex-1">
          {route.name === "create" && (
            <>
              <section className="mb-7">
                <h1 className="mb-3.5 font-heading text-[clamp(27px,7.6vw,40px)] leading-[1.1] font-extrabold tracking-tight text-balance">
                  {t("hero.title")}
                </h1>
                <p className="mb-7 max-w-[48ch] text-[17px] leading-snug text-muted-foreground text-pretty">
                  {t("hero.lead")}
                </p>
              </section>
              <CreatePage key={composeKey} />
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
            <span>{t("footer.hosted")}</span>
            <span className="flex flex-wrap items-center gap-3">
              <a href="/faq" onClick={(event) => onInternalClick(event, "/faq")}>
                {t("nav.how")}
              </a>
              <a href="/privacy" onClick={(event) => onInternalClick(event, "/privacy")}>
                {t("nav.privacy")}
              </a>
              {brand.footerLinks.map((l) => (
                <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
                  {isGitHubHost(l.href) ? t("footer.source") : l.label}
                </a>
              ))}
            </span>
          </div>
          {brand.footerCredit && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <span>{t("footer.madeIn")}</span>
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
