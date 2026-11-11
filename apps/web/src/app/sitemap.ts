import type { MetadataRoute } from "next";
import { fetchListings, type ListingCard } from "@/lib/api";
import { LOCALES, SITE_URL } from "@/lib/i18n";

// Regenerated hourly; listing URLs are included only when the API is reachable.
export const revalidate = 3600;

const langs = (path: string) => ({ languages: Object.fromEntries(LOCALES.map((l) => [l, `${SITE_URL}/${l}${path}`])) });

async function allListings(): Promise<ListingCard[]> {
  const out: ListingCard[] = [];
  for (let page = 1; page <= 40; page++) {
    const res = await fetchListings({ page, page_size: 50 });
    if (!res.ok) break;
    out.push(...res.data.items);
    if (out.length >= res.data.total || res.data.items.length === 0) break;
  }
  return out;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticPaths = ["", "/listings"];
  const entries: MetadataRoute.Sitemap = staticPaths.flatMap((p) =>
    LOCALES.map((l) => ({ url: `${SITE_URL}/${l}${p}`, lastModified: now, changeFrequency: "daily" as const, priority: p ? 0.8 : 1, alternates: langs(p) })),
  );
  for (const listing of await allListings()) {
    const p = `/listings/${listing.id}`;
    for (const l of LOCALES) {
      entries.push({
        url: `${SITE_URL}/${l}${p}`,
        lastModified: listing.published_at ? new Date(listing.published_at) : now,
        changeFrequency: "weekly",
        priority: 0.6,
        alternates: langs(p),
      });
    }
  }
  return entries;
}
