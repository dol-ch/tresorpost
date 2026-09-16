export type Locale = "de" | "en" | "uk";

export const LOCALES: Locale[] = ["de", "en", "uk"];
export const DEFAULT_LOCALE: Locale = "de";

export const INTL_LOCALE: Record<Locale, string> = {
  de: "de-CH",
  en: "en-GB",
  uk: "uk-UA",
};

/** First matching tag in the browser list; anything else falls back to German. */
export function detectLocale(langs: readonly string[] = []): Locale {
  for (const raw of langs) {
    const primary = raw.trim().toLowerCase().split("-")[0];
    if (primary === "de") return "de";
    if (primary === "en") return "en";
    if (primary === "uk") return "uk";
  }
  return DEFAULT_LOCALE;
}

export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key]),
  );
}
