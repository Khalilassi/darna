import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiUnavailable } from "@/components/ApiUnavailable";
import { ListingCard } from "@/components/ListingCard";
import { fetchListings, type BrowseQuery } from "@/lib/api";
import { alternates, getDict, isLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;
const SORTS = ["newest", "price_asc", "price_desc", "area_desc"] as const;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDict(locale);
  return { title: t.meta.listingsTitle, description: t.meta.listingsDescription, alternates: alternates(locale, "/listings") };
}

export default async function Browse({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SP> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDict(locale);
  const sp = await searchParams;
  const purposeRaw = one(sp.purpose);
  const purpose = purposeRaw === "sale" || purposeRaw === "rent" ? purposeRaw : undefined;
  const sortRaw = one(sp.sort);
  const sort = (SORTS as readonly string[]).includes(sortRaw ?? "") ? (sortRaw as BrowseQuery["sort"]) : "newest";
  const page = Math.max(1, Math.min(500, Number.parseInt(one(sp.page) ?? "1", 10) || 1));

  const res = await fetchListings({ purpose, sort, page, page_size: PAGE_SIZE }, locale);
  const href = (over: Partial<{ purpose: string | undefined; sort: string; page: number }>) => {
    const q = new URLSearchParams();
    const p = "purpose" in over ? over.purpose : purpose;
    if (p) q.set("purpose", p);
    const s = over.sort ?? sort;
    if (s && s !== "newest") q.set("sort", s);
    const pg = over.page ?? 1;
    if (pg > 1) q.set("page", String(pg));
    const qs = q.toString();
    return `/${locale}/listings${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="container section">
      <div className="browse-head">
        <h1>{t.listings.title}</h1>
        {res.ok && <p className="muted">{t.listings.results(res.data.total)}</p>}
      </div>
      <div className="toolbar">
        <nav className="tabs" aria-label={t.listings.title}>
          {[
            { key: undefined, label: t.listings.all },
            { key: "sale", label: t.listings.sale },
            { key: "rent", label: t.listings.rent },
          ].map((tab) => (
            <Link key={tab.label} href={href({ purpose: tab.key })} aria-current={purpose === tab.key ? "page" : undefined} className="tab">
              {tab.label}
            </Link>
          ))}
        </nav>
        <form className="sort-form" action={`/${locale}/listings`} method="get">
          {purpose && <input type="hidden" name="purpose" value={purpose} />}
          <label htmlFor="sort">{t.listings.sort}</label>
          <select id="sort" name="sort" defaultValue={sort}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t.listings.sorts[s]}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-outline btn-sm">
            {t.listings.apply}
          </button>
        </form>
      </div>

      {!res.ok ? (
        <ApiUnavailable t={t} retryHref={href({ page })} />
      ) : res.data.items.length === 0 ? (
        <p className="empty">{t.listings.empty}</p>
      ) : (
        <>
          <div className="listing-grid">
            {res.data.items.map((l) => (
              <ListingCard key={l.id} l={l} locale={locale} t={t} />
            ))}
          </div>
          {res.data.total > PAGE_SIZE && (
            <nav className="pager" aria-label="Pagination">
              {page > 1 ? (
                <Link className="btn btn-outline btn-sm" href={href({ page: page - 1 })} rel="prev">
                  {t.listings.previous}
                </Link>
              ) : (
                <span />
              )}
              <span className="muted small">{t.listings.page(page, Math.ceil(res.data.total / PAGE_SIZE))}</span>
              {page * PAGE_SIZE < res.data.total ? (
                <Link className="btn btn-outline btn-sm" href={href({ page: page + 1 })} rel="next">
                  {t.listings.next}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
