import { ApiError } from "@darna/api-client";
import i18next, { type TFunction } from "i18next";

export { ApiError };

/** Localizes an error by its API `code` (falls back to a generic message). */
export function errorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    if (err.code === "validation_failed" || err.code === "invalid_sale_terms") {
      const general = generalValidationMessage(err);
      if (general) return general;
    }
    if (err.code === "too_many_failed_logins") {
      const minutes = lockoutMinutes(err);
      return minutes === null ? t("errors.too_many_failed_logins") : t("errors.lockedMinutes", { count: minutes });
    }
    const key = `errors.${err.code}`;
    const msg = t(key, { defaultValue: "" });
    if (msg) return msg;
    if (err.status === 401) return t("errors.unauthorized");
    if (err.status >= 500) return t("errors.internal_error");
    return t("errors.generic");
  }
  if (err instanceof TypeError) return t("errors.network");
  return t("errors.generic");
}

export function errorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? err.code : undefined;
}

interface ValidationDetail {
  loc?: (string | number)[];
  msg?: string;
  /** Pydantic error type or a Darna rule code, e.g. "string_too_short", "installments_required". */
  type?: string;
  /** Scalar limits for the message, e.g. { min_length: 2 }. */
  ctx?: Record<string, string | number | boolean>;
}

const details = (err: ApiError): ValidationDetail[] => (Array.isArray(err.details) ? (err.details as ValidationDetail[]) : []);

/**
 * Maps FastAPI validation details to form fields: loc ["body","sale_terms","owner_cash_price","amount"]
 * becomes "sale_terms.owner_cash_price.amount". Model-level errors (loc ["body"]) are not field errors.
 */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || (err.code !== "validation_failed" && err.code !== "invalid_sale_terms")) return {};
  const out: Record<string, string> = {};
  for (const d of details(err)) {
    const loc = (d.loc ?? []).filter((p) => p !== "body" && p !== "query" && p !== "path");
    if (!loc.length) continue;
    const key = loc.join(".");
    const text = validationText(d);
    if (text && !out[key]) out[key] = text;
  }
  return out;
}

/**
 * Localizes one validation detail by its `type` (with `ctx` limits interpolated). The API's own
 * `msg` is English, so it is used only as an English fallback for types we have no string for.
 */
export function validationText(d: ValidationDetail): string | null {
  if (d.type) {
    const msg = i18next.t(`apiValidation.${d.type}`, { ...d.ctx, defaultValue: "" });
    if (msg) return msg;
  }
  if (i18next.language !== "ar" && d.msg) return d.msg.replace(/^Value error, /, "");
  return d.type || d.msg ? i18next.t("apiValidation.invalid") : null;
}

function generalValidationMessage(err: ApiError): string | null {
  const all = details(err);
  // Model-level detail (loc ["body"]); for sale terms every detail describes the terms as a whole.
  const general = err.code === "invalid_sale_terms" ? all[0] : all.find((d) => (d.loc ?? []).filter((p) => p !== "body").length === 0);
  if (!general) return null;
  const text = validationText(general);
  // In Arabic, an unrecognized rule falls back to the code-level message instead of a generic one.
  return text && !(i18next.language === "ar" && text === i18next.t("apiValidation.invalid")) ? text : null;
}

/** Whole minutes left on a sign-in lockout (`details.retry_after_seconds`), rounded up; null when absent. */
export function lockoutMinutes(err: ApiError): number | null {
  const secs = (err.details as { retry_after_seconds?: unknown } | undefined)?.retry_after_seconds;
  return typeof secs === "number" && Number.isFinite(secs) && secs >= 0 ? Math.max(1, Math.ceil(secs / 60)) : null;
}
