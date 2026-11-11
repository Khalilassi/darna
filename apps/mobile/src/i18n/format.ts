import { formatEGP } from "@darna/design-tokens";
import type { Language } from "./language";

/** Locale used for Intl formatting. Arabic uses Egyptian Arabic, which renders Arabic-Indic digits. */
export const intlLocale = (lang: Language) => (lang === "ar" ? "ar-EG" : "en-EG");

export const toNumber = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function formatMoney(v: string | number | null | undefined, lang: Language, compact = false): string {
  return formatEGP(v, lang, { compact });
}

export function formatNumber(v: string | number | null | undefined, lang: Language, maxFractionDigits = 0): string {
  const n = toNumber(v);
  if (n === null) return "—";
  return new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: maxFractionDigits }).format(n);
}

export function formatPercent(fraction: string | number | null | undefined, lang: Language, digits = 0): string {
  const n = toNumber(fraction);
  if (n === null) return "—";
  return new Intl.NumberFormat(intlLocale(lang), { style: "percent", maximumFractionDigits: digits }).format(n);
}

export function formatArea(sqm: string | number | null | undefined, lang: Language): string {
  const n = formatNumber(sqm, lang);
  return lang === "ar" ? `${n} م²` : `${n} m²`;
}

export function formatDate(iso: string | null | undefined, lang: Language, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocale(lang), {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(d);
}

export function formatTime(iso: string, lang: Language): string {
  return new Intl.DateTimeFormat(intlLocale(lang), { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "3 days ago" style relative time. */
export function formatRelative(iso: string | null | undefined, lang: Language, now: Date = new Date()): string {
  if (!iso) return "";
  const diff = (new Date(iso).getTime() - now.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(intlLocale(lang), { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(iso, lang);
}

/** Converts Western digits to Arabic-Indic digits (for strings Intl does not format, e.g. codes). */
export function localizeDigits(s: string, lang: Language): string {
  if (lang !== "ar") return s;
  return s.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

/** Parses user input that may contain Arabic-Indic digits or thousands separators. */
export function parseAmountInput(s: string): number | null {
  const western = s
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٬,\s]/g, "")
    .replace(/٫/g, ".");
  if (!western) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(western)) return null;
  const n = Number(western);
  return Number.isFinite(n) ? n : null;
}
