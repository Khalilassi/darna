import type { TFunction } from "i18next";
import { parseAmountInput } from "../i18n/format";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(v: string, t: TFunction): string | undefined {
  if (!v.trim()) return t("validation.required");
  return EMAIL_RE.test(v.trim()) ? undefined : t("validation.email");
}

/** Mirrors the API rule: 10+ characters and not only letters or only digits. */
export function validatePassword(v: string, t: TFunction): string | undefined {
  if (v.length < 10) return t("validation.passwordLength");
  if (/^[A-Za-z]+$/.test(v) || /^\d+$/.test(v)) return t("validation.passwordMix");
  return undefined;
}

export function validatePhone(v: string, t: TFunction): string | undefined {
  if (!v.trim()) return undefined;
  return /^\+?[0-9]{8,15}$/.test(v.trim()) ? undefined : t("validation.phone");
}

export function validateAmount(v: string, t: TFunction, { required = true } = {}): string | undefined {
  if (!v.trim()) return required ? t("validation.required") : undefined;
  const n = parseAmountInput(v);
  return n === null || n <= 0 ? t("validation.amount") : undefined;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function validateDate(v: string, t: TFunction, { required = false, future = false } = {}): string | undefined {
  if (!v.trim()) return required ? t("validation.required") : undefined;
  if (!DATE_RE.test(v.trim()) || Number.isNaN(new Date(`${v.trim()}T00:00:00`).getTime())) return t("validation.date");
  if (future && new Date(`${v.trim()}T23:59:59`) < new Date()) return t("validation.futureDate");
  return undefined;
}

export function validateInt(v: string, t: TFunction, min: number, max: number, { required = true } = {}): string | undefined {
  if (!v.trim()) return required ? t("validation.required") : undefined;
  const n = parseAmountInput(v);
  if (n === null || !Number.isInteger(n)) return t("validation.integer");
  return n < min || n > max ? t("validation.range", { min, max }) : undefined;
}

export const hasErrors = (e: Record<string, string | undefined>) => Object.values(e).some(Boolean);
