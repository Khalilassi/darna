import type { TFunction } from "i18next";
import type { Schemas } from "@darna/api-client";
import { formatMoney, formatNumber, toNumber } from "../i18n/format";
import type { Language } from "../i18n/language";
import type { Filters } from "../state/filters";

export type SearchFiltersIn = Schemas["SearchFilters-Input"];

/** Saved-search name limit enforced by the API. */
export const MAX_NAME = 80;

/** Explore filters -> the API's SearchFilters (sort is not part of a saved search; empty values dropped). */
export function toSearchFilters(f: Filters): SearchFiltersIn {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === "sort") continue;
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out as SearchFiltersIn;
}

/** Fields used in a name; satisfied by both Explore filters and saved `SearchFilters` from the API. */
type Describable = {
  purpose?: "sale" | "rent" | null;
  property_type?: string[];
  bedrooms_min?: number | null;
  bathrooms_min?: number | null;
  price_min?: number | string | null;
  price_max?: number | string | null;
  area_min?: number | string | null;
  payment_mode?: string | null;
  furnished?: boolean | null;
  q?: string | null;
};

/**
 * Short human name for a set of filters, e.g. "For sale · Apartment · B1 · 2+ beds · Up to EGP 5M".
 * Used as the default name when saving a search and as the summary line of each saved search.
 */
export function describeFilters(f: Describable, t: TFunction, lang: Language, ctx: { districtName?: string | null } = {}): string {
  const tr = t as unknown as (key: string, opts?: Record<string, unknown>) => string;
  const parts: string[] = [];
  if (f.purpose) parts.push(tr(`savedSearch.name.${f.purpose}`));
  const types = f.property_type ?? [];
  if (types.length === 1 || types.length === 2) parts.push(types.map((p) => tr(`enum.propertyType.${p}`)).join(", "));
  else if (types.length > 2) parts.push(tr("savedSearch.name.types", { count: types.length }));
  if (ctx.districtName) parts.push(ctx.districtName);
  if (f.bedrooms_min) parts.push(tr("savedSearch.name.beds", { value: formatNumber(f.bedrooms_min, lang) }));
  const min = toNumber(f.price_min ?? null);
  const max = toNumber(f.price_max ?? null);
  if (min !== null && max !== null) parts.push(tr("savedSearch.name.priceBetween", { min: formatMoney(min, lang, true), max: formatMoney(max, lang, true) }));
  else if (max !== null) parts.push(tr("savedSearch.name.priceMax", { value: formatMoney(max, lang, true) }));
  else if (min !== null) parts.push(tr("savedSearch.name.priceMin", { value: formatMoney(min, lang, true) }));
  if (f.payment_mode) parts.push(tr(`enum.paymentMode.${f.payment_mode}`));
  if (f.furnished === true) parts.push(tr("savedSearch.name.furnished"));
  if (f.q?.trim()) parts.push(`“${f.q.trim()}”`);
  const name = parts.length ? parts.join(" · ") : tr("savedSearch.name.all");
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1).trimEnd()}…` : name;
}
