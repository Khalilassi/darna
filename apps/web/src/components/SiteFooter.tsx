import Link from "next/link";
import { brand } from "@darna/design-tokens";
import type { Dict, Locale } from "@/lib/i18n";

export function SiteFooter({ locale, t }: { locale: Locale; t: Dict }) {
  return (
    <footer className="site-footer">
      <div className="container stack gap-md">
        <div className="footer-top">
          <strong>{locale === "ar" ? brand.nameAr : brand.name}</strong>
          <nav aria-label="Footer" className="footer-nav">
            <Link href={`/${locale}/listings`}>{t.nav.listings}</Link>
            <Link href={`/${locale}#trust`}>{t.nav.trust}</Link>
            <Link href={`/${locale}#faq`}>{t.nav.faq}</Link>
          </nav>
        </div>
        <p className="disclaimer">{t.footer.disclaimer}</p>
        <p className="muted small">
          {t.footer.demo} © {new Date().getFullYear()} {brand.name}. {t.footer.rights}
        </p>
      </div>
    </footer>
  );
}
