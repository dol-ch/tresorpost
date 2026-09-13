import { useEffect, useState } from "react";
import { CreatePage } from "./CreatePage";
import { ViewPage } from "./ViewPage";
import { DeletePage } from "./DeletePage";
import { AdminPage } from "./AdminPage";
import { brand } from "./brand";

type Route =
  | { name: "create" }
  | { name: "view"; id: string; key: string }
  | { name: "delete"; id: string; token: string }
  | { name: "admin" };

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#/, "");
  // Expected view route: /v/<id>/<key> (also accepts legacy /s/…).
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "admin") {
    return { name: "admin" };
  }
  if (parts[0] === "d" && parts[1] && parts[2]) {
    return { name: "delete", id: parts[1], token: parts.slice(2).join("/") };
  }
  if ((parts[0] === "s" || parts[0] === "v") && parts[1] && parts[2]) {
    return { name: "view", id: parts[1], key: parts.slice(2).join("/") };
  }
  return { name: "create" };
}

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme());
  const toggle = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("et_theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
      aria-label="Toggle theme"
    >
      {theme === "light" ? (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" />
        </svg>
      )}
    </button>
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

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/" aria-label={brand.name}>
          <Wordmark />
        </a>
        <div className="topbar-right">
          <span className="tagline">{brand.tagline}</span>
          <ThemeToggle />
        </div>
      </header>

      <main className="main">
        {route.name === "create" && (
          <>
            <section className="intro">
              <p className="eyebrow">
                <span className="num">01</span>&nbsp;&nbsp;— Secure transfer
              </p>
              <h1>Share a secret only the recipient can read.</h1>
              <p>
                Text, images and files are encrypted in your browser and
                decrypted in theirs. The key lives only in the link — it never
                reaches the server, which stores nothing but ciphertext.
              </p>
              <div className="spec">
                <span>
                  Cipher <b>XChaCha20-Poly1305</b>
                </span>
                <span>
                  Key <b>256-bit</b>
                </span>
                <span>
                  Server <b>zero-knowledge</b>
                </span>
              </div>
            </section>
            <CreatePage />
          </>
        )}
        {route.name === "view" && <ViewPage id={route.id} keyB64Url={route.key} />}
        {route.name === "delete" && <DeletePage id={route.id} token={route.token} />}
        {route.name === "admin" && <AdminPage />}
      </main>

      <footer className="footer">
        <span>Zero-knowledge · keys stay in the URL fragment</span>
        <span className="footer-links">
          {brand.footerLinks.map((l, i) => (
            <span key={l.href}>
              {i > 0 && " · "}
              <a href={l.href} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            </span>
          ))}
        </span>
      </footer>
    </div>
  );
}
