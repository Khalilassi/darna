import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { formatEGP } from "@darna/design-tokens";
import { ApiUnavailable } from "@/components/ApiUnavailable";
import { RentSummary, SaleSummary } from "@/components/FinancialSummary";
import { StoreButtons } from "@/components/StoreButtons";
import { fetchListing, isUuid } from "@/lib/api";
import { alternates, getDict, isLocale, label, type Locale } from "@/lib/i18n";

export const revalidate = 60;

type Params = Promise<{ locale: string; id: string }>;

const load = cache(async (id: string, locale: Locale) => (isUuid(id) ? fetchListing(id, locale) : null));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isLocale(locale)) return {};
  const res = await load(id, locale);
  if (!res?.ok) return { title: getDict(locale).detail.notFound, robots: { index: false } };
  const l = res.data;
  const t = getDict(locale);
  const district = locale === "ar" ? l.district_name_ar : l.district_name_en;
  const project = locale === "ar" ? l.project_name_ar : l.project_name_en;
  const price = l.purpose === "rent" ? `${formatEGP(l.monthly_rent, locale)} ${t.listings.perMonth}` : formatEGP(l.sale_cash_price, locale);
  const description = `${label(t.enums.property_type, l.property_type)} · ${district}, ${project} · ${price}. ${l.description}`.slice(0, 200);
  const images = l.cover_photo_url ? [{ url: l.cover_photo_url, width: 1200, height: 800, alt: l.title }] : [];
  return {
    title: l.title,
    description,
    alternates: alternates(locale, `/listings/${l.id}`),
    openGraph: { type: "website", title: l.title, description, images, locale: locale === "ar" ? "ar_EG" : "en_US" },
    twitter: { card: images.length ? "summary_large_image" : "summary", title: l.title, description, images: images.map((i) => i.url) },
  };
}

export default async function ListingPage({ params }: { params: Params }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDict(locale);
  const res = await load(id, locale);
  if (res === null || (!res.ok && res.status === 404) || (!res.ok && res.status === 422)) notFound();
  if (!res.ok)
    return (
      <div className="container section">
        <ApiUnavailable t={t} retryHref={`/${locale}/listings/${id}`} />
      </div>
    );

  const l = res.data;
  const district = locale === "ar" ? l.district_name_ar : l.district_name_en;
  const project = locale === "ar" ? l.project_name_ar : l.project_name_en;
  const num = (n: number | string) => Number(n).toLocaleString(locale === "ar" ? "ar-EG" : "en-EG");
  const isRent = l.purpose === "rent";
  const photos = [...l.photos].sort((a, b) => a.position - b.position);

  const specs: [string, string][] = [
    [t.detail.fields.type, label(t.enums.property_type, l.property_type)],
    [t.detail.fields.purpose, label(t.enums.purpose, l.purpose)],
    [t.detail.fields.area, `${num(l.area_sqm)} ${t.listings.sqm}`],
    ...(l.garden_sqm ? ([[t.detail.fields.garden, `${num(l.garden_sqm)} ${t.listings.sqm}`]] as [string, string][]) : []),
    ...(l.bedrooms != null ? ([[t.detail.fields.bedrooms, num(l.bedrooms)]] as [string, string][]) : []),
    ...(l.bathrooms != null ? ([[t.detail.fields.bathrooms, num(l.bathrooms)]] as [string, string][]) : []),
    ...(l.floor != null ? ([[t.detail.fields.floor, l.floor === 0 ? t.detail.ground : num(l.floor)]] as [string, string][]) : []),
    [t.detail.fields.finishing, label(t.enums.finishing, l.finishing)],
    [t.detail.fields.delivery, label(t.enums.delivery, l.delivery_status)],
    ...(l.orientation ? ([[t.detail.fields.orientation, label(t.enums.orientation, l.orientation)]] as [string, string][]) : []),
    ...(l.furnished != null ? ([[t.detail.fields.furnished, l.furnished ? t.detail.yes : t.detail.no]] as [string, string][]) : []),
  ];

  return (
    <article className="container section detail">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href={`/${locale}/listings`}>{locale === "ar" ? "→" : "←"} {t.detail.back}</Link>
      </nav>

      {photos.length > 0 && (
        <div className={`gallery gallery-${Math.min(photos.length, 3)}`}>
          {photos.slice(0, 3).map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p.id} src={p.url} alt={i === 0 ? l.title : ""} width={p.width ?? 1200} height={p.height ?? 800} loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : undefined} />
          ))}
        </div>
      )}

      <div className="detail-grid">
        <div className="stack gap-lg">
          <header className="detail-head">
            <p className="muted">
              {district} · {project}
            </p>
            <h1>{l.title}</h1>
            <p className="price price-lg">
              {formatEGP(isRent ? l.monthly_rent : l.sale_cash_price, locale)}
              {isRent && <span className="per"> {t.listings.perMonth}</span>}
            </p>
            {!isRent && l.sale_price_per_sqm && (
              <p className="muted small">
                {t.detail.pricePerSqm}: {formatEGP(l.sale_price_per_sqm, locale)}
              </p>
            )}
            <p className={l.owner_verified ? "verified" : "muted"}>
              {l.owner_verified ? `✓ ${t.detail.verifiedOwner}` : t.detail.unverifiedOwner} · {t.detail.owner} {l.owner_display_name}
            </p>
          </header>

          <section aria-labelledby="overview">
            <h2 id="overview">{t.detail.overview}</h2>
            <p className="prewrap">{l.description}</p>
          </section>

          <section aria-labelledby="specs">
            <h2 id="specs">{t.detail.specs}</h2>
            <dl className="spec-list">
              {specs.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="location">
            <h2 id="location">{t.detail.location}</h2>
            <p>
              {district}, {project}
            </p>
            <p className="muted small">{t.detail.locationNote}</p>
          </section>

          {l.sale_breakdown && <SaleSummary b={l.sale_breakdown} locale={locale} t={t} />}
          {l.rent_breakdown && <RentSummary b={l.rent_breakdown} locale={locale} t={t} />}
        </div>

        <aside className="cta-card card" aria-labelledby="cta-title">
          <h2 id="cta-title">{t.detail.ctaTitle}</h2>
          <p>{t.detail.ctaBody}</p>
          <a className="btn btn-primary btn-block" href="#get-app">
            {t.detail.cta}
          </a>
          <div id="get-app" className="stack gap-sm">
            <StoreButtons t={t} />
          </div>
        </aside>
      </div>
    </article>
  );
}
