import ar from "./dict/ar";
import en, { type Dict } from "./dict/en";

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(v: string | undefined | null): v is Locale {
  return v === "en" || v === "ar";
}

export function getDict(locale: Locale): Dict {
  return locale === "ar" ? ar : en;
}

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** hreflang alternates for a locale-agnostic path such as "/listings/123". */
export function alternates(locale: Locale, path: string) {
  return {
    canonical: `${SITE_URL}/${locale}${path}`,
    languages: { en: `${SITE_URL}/en${path}`, ar: `${SITE_URL}/ar${path}`, "x-default": `${SITE_URL}/en${path}` },
  };
}

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—";
  return map[key] ?? key.replace(/_/g, " ");
}

export type { Dict };
