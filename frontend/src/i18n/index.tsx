import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { de, type MessageKey } from "./de";
import { en } from "./en";
import { uk } from "./uk";
import {
  DEFAULT_LOCALE,
  detectLocale,
  interpolate,
  INTL_LOCALE,
  type Locale,
} from "./detect";

const catalogs: Record<Locale, Record<MessageKey, string>> = { de, en, uk };

export type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

const I18nContext = createContext<{
  locale: Locale;
  intlLocale: string;
  t: Translate;
}>({
  locale: DEFAULT_LOCALE,
  intlLocale: INTL_LOCALE[DEFAULT_LOCALE],
  t: (key, vars) => interpolate(de[key], vars),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useMemo(
    () =>
      detectLocale(
        typeof navigator === "undefined"
          ? []
          : navigator.languages?.length
            ? [...navigator.languages]
            : navigator.language
              ? [navigator.language]
              : [],
      ),
    [],
  );
  const t: Translate = useMemo(() => {
    const table = catalogs[locale];
    return (key, vars) => interpolate(table[key] ?? de[key], vars);
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(
    () => ({ locale, intlLocale: INTL_LOCALE[locale], t }),
    [locale, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useT(): Translate {
  return useI18n().t;
}

export { detectLocale, interpolate, DEFAULT_LOCALE, INTL_LOCALE };
export type { Locale, MessageKey };
