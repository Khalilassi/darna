import Link from "next/link";
import { StoreButtons } from "@/components/StoreButtons";
import { getDict, isLocale, type Locale } from "@/lib/i18n";
import { notFound } from "next/navigation";

export default async function Landing({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const t = getDict(locale);
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <p className="eyebrow">{t.hero.eyebrow}</p>
          <h1>{t.hero.title}</h1>
          <p className="lead">{t.hero.subtitle}</p>
          <div className="cta-row">
            <Link className="btn btn-primary btn-lg" href={`/${locale}/listings`}>
              {t.hero.ctaBrowse}
            </Link>
            <a className="btn btn-outline btn-lg" href="#app">
              {t.hero.ctaApp}
            </a>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="value-title">
        <div className="container">
          <h2 id="value-title" className="section-title">
            {t.value.title}
          </h2>
          <ul className="value-grid">
            {t.value.items.map((v, i) => (
              <li key={v.title} className="card value">
                <span className="value-num" aria-hidden>
                  {(i + 1).toLocaleString(locale === "ar" ? "ar-EG" : "en")}
                </span>
                <h3>{v.title}</h3>
                <p>{v.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how" className="section section-muted" aria-labelledby="how-title">
        <div className="container">
          <h2 id="how-title" className="section-title">
            {t.how.title}
          </h2>
          <div className="how-grid">
            {[t.how.buyers, t.how.owners].map((track) => (
              <div key={track.title} className="card">
                <h3>{track.title}</h3>
                <ol className="steps">
                  {track.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="trust" className="section" aria-labelledby="trust-title">
        <div className="container">
          <h2 id="trust-title" className="section-title">
            {t.trust.title}
          </h2>
          <p className="lead narrow">{t.trust.intro}</p>
          <dl className="trust-grid">
            {t.trust.labels.map((l) => (
              <div key={l.key} className="card trust-item">
                <dt>
                  <span className={`prov prov-${l.key}`}>{l.title}</span>
                </dt>
                <dd>{l.body}</dd>
              </div>
            ))}
          </dl>
          <div className="notice notice-info">
            <strong>{t.trust.disclaimerTitle}</strong>
            <p>{t.trust.disclaimer}</p>
          </div>
        </div>
      </section>

      <section id="faq" className="section section-muted" aria-labelledby="faq-title">
        <div className="container narrow">
          <h2 id="faq-title" className="section-title">
            {t.faq.title}
          </h2>
          <div className="faq">
            {t.faq.items.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="app" className="section" aria-labelledby="app-title">
        <div className="container app-box card">
          <div>
            <h2 id="app-title" className="section-title">
              {t.app.title}
            </h2>
            <p>{t.app.body}</p>
          </div>
          <StoreButtons t={t} />
        </div>
      </section>
    </>
  );
}
