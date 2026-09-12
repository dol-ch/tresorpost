import { useEffect, useState } from "react";
import { CreatePage } from "./CreatePage";
import { ViewPage } from "./ViewPage";

type Route =
  | { name: "create" }
  | { name: "view"; id: string; key: string };

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#/, "");
  // Expected view route: /v/<id>/<key>
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "v" && parts[1] && parts[2]) {
    return { name: "view", id: parts[1], key: parts.slice(2).join("/") };
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

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          Tresorpost
        </a>
        <span className="tagline">end-to-end encrypted · quantum-safe · self-destructing</span>
      </header>

      <main className="main">
        {route.name === "create" ? (
          <>
            <div className="intro">
              <h1>Share a secret that only the recipient can read</h1>
              <p className="muted">
                Text, images and files are encrypted in your browser with
                256-bit XChaCha20-Poly1305. The key never touches the server —
                it lives only in the link you share.
              </p>
            </div>
            <CreatePage />
          </>
        ) : (
          <ViewPage id={route.id} keyB64Url={route.key} />
        )}
      </main>

      <footer className="footer muted small">
        Zero-knowledge server · keys stay in the URL fragment · built with Rust + Vite
      </footer>
    </div>
  );
}
