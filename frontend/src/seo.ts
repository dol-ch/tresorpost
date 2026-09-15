/** Canonical public origin for meta/OG. Self-hosted overlays can ignore these tags. */
export const SITE_ORIGIN = "https://tresorpost.ch";

export const SITE_DESCRIPTION =
  "Quantum-safe, end-to-end encrypted transfer for text, images, video and files. 256-bit encryption in your browser, hosted in Switzerland, no accounts and no analytics.";

type SeoInput = {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
};

function abs(path: string): string {
  if (path.startsWith("http")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_ORIGIN}${p === "/" ? "/" : p}`;
}

function meta(name: string, content: string, attr: "name" | "property" = "name") {
  const sel = attr === "property" ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  let el = document.head.querySelector(sel) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function linkRel(rel: string, href: string) {
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function applySeo({ title, description, path, noindex }: SeoInput) {
  document.title = title;
  meta("description", description);
  meta("robots", noindex ? "noindex, nofollow" : "index, follow");
  const url = abs(path);
  linkRel("canonical", url);
  meta("og:title", title, "property");
  meta("og:description", description, "property");
  meta("og:url", url, "property");
  meta("twitter:title", title);
  meta("twitter:description", description);
  meta("twitter:image", `${SITE_ORIGIN}/og.png`);
  meta("og:image", `${SITE_ORIGIN}/og.png`, "property");
}
