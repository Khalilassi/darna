/**
 * Calendar-date helpers for `YYYY-MM-DD` values (the API's date format). Pure: no React, no native
 * modules, so they are unit-tested directly. Dates are calendar days, not instants: conversions use
 * the device's local calendar so a picked day never shifts across a timezone boundary.
 */
import { formatDate } from "../i18n/format";
import type { Language } from "../i18n/language";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strictly parses `YYYY-MM-DD` into a local-midnight Date, rejecting impossible days (2026-02-30). */
export function parseISODate(iso: string | null | undefined): Date | null {
  const m = ISO_RE.exec((iso ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Local calendar day of `d` as `YYYY-MM-DD`. */
export function toISODate(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const isValidISODate = (iso: string | null | undefined) => parseISODate(iso) !== null;

/** Today as `YYYY-MM-DD` (local calendar). */
export const todayISO = (now: Date = new Date()) => toISODate(now);

/** Adds whole days to an ISO date (local calendar). */
export function addDaysISO(iso: string, days: number): string {
  const d = parseISODate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** ISO strings compare lexicographically in calendar order. */
export function rangeViolation(iso: string, { min, max }: { min?: string; max?: string }): "min" | "max" | null {
  if (!isValidISODate(iso)) return null;
  if (min && isValidISODate(min) && iso < min) return "min";
  if (max && isValidISODate(max) && iso > max) return "max";
  return null;
}

/** Clamps a date into [min, max] (used as the picker's initial value). */
export function clampISO(iso: string, { min, max }: { min?: string; max?: string }): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

/** Localized display ("Dec 1, 2026" / "١ ديسمبر ٢٠٢٦"); empty string for no/invalid value. */
export function displayDate(iso: string | null | undefined, lang: Language): string {
  return isValidISODate(iso) ? formatDate(iso!.trim(), lang) : "";
}

/**
 * Normalizes text a user might type into a date input (web fallback, pasted values): accepts Arabic-Indic
 * digits and `/` or `.` separators in Y-M-D order. Returns `YYYY-MM-DD` or null.
 */
export function normalizeDateInput(s: string): string | null {
  const western = s
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[/.]/g, "-");
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(western);
  if (!m) return null;
  const iso = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  return isValidISODate(iso) ? iso : null;
}
