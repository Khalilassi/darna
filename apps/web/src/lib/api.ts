import { createApiClient, unwrap, type Schemas } from "@darna/api-client";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type ListingCard = Schemas["ListingCard"];
export type ListingDetail = Schemas["ListingDetail"];
export type SaleBreakdown = Schemas["SaleBreakdown"];
export type RentBreakdown = Schemas["RentBreakdown"];
export type LineItem = Schemas["LineItem"];
export type Provenance = Schemas["Provenance"];

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

const client = createApiClient({ baseUrl: API_URL });
const TIMEOUT_MS = 6000;

async function attempt<T>(fn: () => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<Result<T>> {
  try {
    return { ok: true, data: unwrap(await fn()) };
  } catch (e) {
    const status = typeof (e as { status?: unknown }).status === "number" ? (e as { status: number }).status : 0;
    return { ok: false, status, message: e instanceof Error ? e.message : "unavailable" };
  }
}

export interface BrowseQuery {
  purpose?: "sale" | "rent";
  sort?: "newest" | "price_asc" | "price_desc" | "area_desc";
  page?: number;
  page_size?: number;
}

/** Public listings search. Never throws: returns { ok: false } when the API is unreachable. */
export function fetchListings(query: BrowseQuery, locale = "en") {
  return attempt(() =>
    client.GET("/listings", {
      params: { query },
      headers: { "Accept-Language": locale },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
}

export function fetchListing(id: string, locale = "en") {
  return attempt(() =>
    client.GET("/listings/{listing_id}", {
      params: { path: { listing_id: id } },
      headers: { "Accept-Language": locale },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);
