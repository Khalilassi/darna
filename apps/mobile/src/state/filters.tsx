import React, { createContext, useContext, useMemo, useState } from "react";
import type { Schemas } from "@darna/api-client";

export type SortKey = "newest" | "price_asc" | "price_desc" | "area_desc" | "ppsqm_asc";
export const SORT_KEYS: SortKey[] = ["newest", "price_asc", "price_desc", "area_desc", "ppsqm_asc"];

export interface Filters {
  project_id?: string;
  district_id?: string;
  group_code?: string;
  purpose?: "sale" | "rent";
  property_type: Schemas["PropertyType"][];
  bedrooms_min?: number;
  bathrooms_min?: number;
  area_min?: number;
  area_max?: number;
  price_min?: number;
  price_max?: number;
  floor_min?: number;
  floor_max?: number;
  finishing: Schemas["Finishing"][];
  delivery_status?: Schemas["DeliveryStatus"];
  orientation: Schemas["Orientation"][];
  payment_mode?: Schemas["PaymentMode"];
  furnished?: boolean;
  q?: string;
  sort: SortKey;
}

export const emptyFilters = (keep?: Partial<Filters>): Filters => ({
  property_type: [],
  finishing: [],
  orientation: [],
  sort: "newest",
  ...keep,
});

/** Number of refinements beyond project, purpose, text and sort (shown on the Filters button). */
export function countActiveFilters(f: Filters): number {
  const scalar: (keyof Filters)[] = [
    "district_id", "group_code", "bedrooms_min", "bathrooms_min", "area_min", "area_max", "price_min", "price_max",
    "floor_min", "floor_max", "delivery_status", "payment_mode", "furnished",
  ];
  return (
    scalar.filter((k) => f[k] !== undefined && f[k] !== "").length +
    (f.property_type.length ? 1 : 0) +
    (f.finishing.length ? 1 : 0) +
    (f.orientation.length ? 1 : 0)
  );
}

/** Converts UI filters into the `/listings` query (drops empty values). */
export function toListingQuery(f: Filters, page: number, pageSize = 10) {
  const q: Record<string, unknown> = { page, page_size: pageSize, sort: f.sort };
  for (const [k, v] of Object.entries(f)) {
    if (k === "sort") continue;
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    q[k] = v;
  }
  return q;
}

interface FiltersCtx {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
}
const Ctx = createContext<FiltersCtx | null>(null);

export function FiltersProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<Filters>(emptyFilters());
  const value = useMemo(() => ({ filters, setFilters }), [filters]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFilters() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFilters outside FiltersProvider");
  return v;
}
