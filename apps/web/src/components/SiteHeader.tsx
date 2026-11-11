import Link from "next/link";
import { brand } from "@darna/design-tokens";
import type { Dict, Locale } from "@/lib/i18n";
import { LanguageSwitch } from "./LanguageSwitch";

export function SiteHeader({ locale, t }: { locale: Locale; t: Dict }) {
  return (
    <header className="site-header">
      <a href="#main" className="skip-link">
        {t.nav.skip}
      </a>
      <div className="container header-inner">
        <Link href={`/${locale}`} className="logo" aria-label={`${locale === "ar" ? brand.nameAr : brand.name} — ${t.nav.home}`}>
          <span className="logo-mark" aria-hidden>
            د
          </span>
          <span>{locale === "ar" ? brand.nameAr : brand.name}</span>
        </Link>
        <nav aria-label={t.nav.home} className="header-nav">
          <Link href={`/${locale}/listings`}>{t.nav.listings}</Link>
          <Link href={`/${locale}#how`} className="hide-sm">
            {t.nav.how}
          </Link>
          <Link href={`/${locale}#faq`} className="hide-sm">
            {t.nav.faq}
          </Link>
          <LanguageSwitch locale={locale} label={t.nav.switchLang} />
        </nav>
      </div>
    </header>
  );
}
