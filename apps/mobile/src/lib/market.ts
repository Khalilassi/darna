import type { Schemas } from "@darna/api-client";
import { toNumber } from "../i18n/format";

type PricePoint = Schemas["PricePoint"];
type DistrictSummary = Schemas["DistrictSummary"];

/** A market figure is either a median or explicitly hidden (fewer than `min_sample` listings). Never 0. */
export type FigureView = { kind: "value"; median: number; sample: number } | { kind: "hidden"; sample: number };

export function figureView(f: Schemas["Figure"]): FigureView {
  const median = toNumber(f.median_per_sqm);
  return median === null ? { kind: "hidden", sample: f.sample_size } : { kind: "value", median, sample: f.sample_size };
}

/**
 * Districts to show for a purpose: those with active listings first (figures before hidden ones,
 * then by name); districts with no listings at all are returned separately so the screen can collapse them.
 */
export function splitDistricts(districts: DistrictSummary[], purpose: "sale" | "rent") {
  const withData = districts.filter((d) => d[purpose].sample_size > 0);
  const empty = districts.filter((d) => d[purpose].sample_size === 0);
  withData.sort((a, b) => {
    const av = a[purpose].median_per_sqm === null ? 1 : 0;
    const bv = b[purpose].median_per_sqm === null ? 1 : 0;
    return av - bv || a.district_name_en.localeCompare(b.district_name_en, "en", { numeric: true });
  });
  return { withData, empty };
}

/** "2026-10" -> a Date at the start of that month (UTC-agnostic, for labels only). */
export const monthDate = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1);
};

/** Bar heights as fractions (0..1) of the largest value; null stays null (no data, drawn as a gap). */
export function barFractions(values: (number | null)[]): (number | null)[] {
  const max = Math.max(0, ...values.filter((v): v is number => v !== null));
  return values.map((v) => (v === null ? null : max > 0 ? v / max : 0));
}

export interface PriceStep {
  at: string;
  kind: string;
  price: number;
  /** Fractional change vs the previous point (e.g. -0.05), null for the first point. */
  change: number | null;
}

/** Asking-price series for one field of the price history (`sale_cash_price` or `monthly_rent`). */
export function priceSteps(points: PricePoint[], field: "sale_cash_price" | "monthly_rent"): PriceStep[] {
  const out: PriceStep[] = [];
  const sorted = [...points].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const p of sorted) {
    const price = toNumber(p[field]);
    if (price === null) continue;
    const prev = out[out.length - 1];
    if (prev && prev.price === price) continue; // a change to another field only
    out.push({ at: p.created_at, kind: p.kind, price, change: prev && prev.price ? (price - prev.price) / prev.price : null });
  }
  return out;
}
