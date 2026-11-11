import Link from "next/link";
import { formatEGP } from "@darna/design-tokens";
import type { ListingCard as Card } from "@/lib/api";
import { label, type Dict, type Locale } from "@/lib/i18n";

export function ListingCard({ l, locale, t }: { l: Card; locale: Locale; t: Dict }) {
  const project = locale === "ar" ? l.project_name_ar : l.project_name_en;
  const district = locale === "ar" ? l.district_name_ar : l.district_name_en;
  const isRent = l.purpose === "rent";
  const price = isRent ? l.monthly_rent : l.sale_cash_price;
  return (
    <article className="listing-card">
      <Link href={`/${locale}/listings/${l.id}`} className="listing-link">
        <div className="listing-media">
          {l.cover_photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.cover_photo_url} alt="" loading="lazy" width={600} height={400} />
          ) : (
            <div className="media-placeholder" aria-hidden />
          )}
          <div className="chips">
            {l.featured && <span className="chip chip-accent">{t.listings.featured}</span>}
            <span className="chip">{label(t.enums.purpose, l.purpose)}</span>
          </div>
        </div>
        <div className="listing-body">
          <p className="price">
            {formatEGP(price, locale)}
            {isRent && <span className="per"> {t.listings.perMonth}</span>}
          </p>
          <h3 className="listing-title">{l.title}</h3>
          <p className="muted small">
            {district} · {project}
          </p>
          <p className="specs small">
            <span>{label(t.enums.property_type, l.property_type)}</span>
            {l.bedrooms != null && <span>{t.listings.beds(l.bedrooms)}</span>}
            {l.bathrooms != null && <span>{t.listings.baths(l.bathrooms)}</span>}
            <span>
              {Number(l.area_sqm).toLocaleString(locale === "ar" ? "ar-EG" : "en-EG")} {t.listings.sqm}
            </span>
          </p>
          {l.owner_verified && <p className="verified small">✓ {t.listings.verifiedOwner}</p>}
        </div>
      </Link>
    </article>
  );
}
