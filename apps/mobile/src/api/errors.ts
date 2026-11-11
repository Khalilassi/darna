import { ApiError } from "@darna/api-client";
import i18next, { type TFunction } from "i18next";

export { ApiError };

/** Localizes an error by its API `code` (falls back to a generic message). */
export function errorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    if (err.code === "validation_failed") {
      // Model-level messages from the API are English-only; show them only in English.
      const general = generalValidationMessage(err);
      if (general && i18next.language !== "ar") return general;
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
}

const details = (err: ApiError): ValidationDetail[] => (Array.isArray(err.details) ? (err.details as ValidationDetail[]) : []);

/**
 * Maps FastAPI validation details to form fields: loc ["body","sale_terms","owner_cash_price","amount"]
 * becomes "sale_terms.owner_cash_price.amount". Model-level errors (loc ["body"]) are not field errors.
 */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.code !== "validation_failed") return {};
  const out: Record<string, string> = {};
  for (const d of details(err)) {
    const loc = (d.loc ?? []).filter((p) => p !== "body" && p !== "query" && p !== "path");
    if (!loc.length || !d.msg) continue;
    const key = loc.join(".");
    if (!out[key]) out[key] = d.msg.replace(/^Value error, /, "");
  }
  return out;
}

function generalValidationMessage(err: ApiError): string | null {
  const general = details(err).find((d) => (d.loc ?? []).filter((p) => p !== "body").length === 0 && d.msg);
  return general?.msg ? general.msg.replace(/^Value error, /, "") : null;
}
