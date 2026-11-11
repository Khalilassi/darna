import { formatEGP } from "@darna/design-tokens";
import type { LineItem, RentBreakdown, SaleBreakdown } from "@/lib/api";
import { label, type Dict, type Locale } from "@/lib/i18n";
import { ProvenanceBadge } from "./ProvenanceBadge";

function fmtDate(d: string | null | undefined, locale: Locale) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", { year: "numeric", month: "short", day: "numeric" });
}

function Figure({ label: l, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={emphasis ? "figure figure-strong" : "figure"}>
      <dt>{l}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LineItems({ items, locale, t }: { items: LineItem[]; locale: Locale; t: Dict }) {
  if (!items.length) return null;
  return (
    // Scrolls horizontally on phones, so it must be keyboard-focusable (WCAG 2.1.1) and named for screen readers.
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t.finance.breakdown}>
      <table className="cost-table">
        <caption>{t.finance.breakdown}</caption>
        <thead>
          <tr>
            <th scope="col">{t.finance.item}</th>
            <th scope="col">{t.finance.amount}</th>
            <th scope="col">{t.finance.whenPaid}</th>
            <th scope="col">{t.finance.source}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((li, i) => (
            <tr key={`${li.code}-${i}`} data-code={li.code} className={li.counted_in === "excluded" ? "excluded" : undefined}>
              <th scope="row">
                {label(t.codes, li.code)}
                {li.note && <span className="muted small block">{label(t.notes, li.note)}</span>}
                {li.counted_in === "excluded" && <span className="muted small block">{t.finance.excluded}</span>}
                {li.counted_in === "estimates" && <span className="muted small block">{t.finance.estimateCounted}</span>}
              </th>
              <td className="amount">{li.amount == null ? t.provenance.unknown : formatEGP(li.amount, locale)}</td>
              <td className="small">
                {t.finance.timing[li.timing]}
                <span className="muted block">{label(t.finance.payer as Record<string, string>, li.payer)}</span>
              </td>
              <td>
                <ProvenanceBadge value={li.provenance} t={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Unconfirmed({ codes, warnings, t }: { codes: string[]; warnings: string[]; t: Dict }) {
  return (
    <>
      {codes.length > 0 && (
        <div className="notice notice-warning" role="note" aria-label={t.finance.notConfirmedTitle}>
          <strong>{t.finance.notConfirmedTitle}</strong>
          <ul>
            {codes.map((c) => (
              <li key={c} data-unconfirmed={c}>
                {label(t.codes, c)}
              </li>
            ))}
          </ul>
          <p className="small">{t.finance.notConfirmedBody}</p>
        </div>
      )}
      {warnings.filter((w) => w !== "unconfirmed_fees").length > 0 && (
        <ul className="warnings">
          {warnings
            .filter((w) => w !== "unconfirmed_fees")
            .map((w) => (
              <li key={w}>{label(t.warnings, w)}</li>
            ))}
        </ul>
      )}
    </>
  );
}

export function SaleSummary({ b, locale, t }: { b: SaleBreakdown; locale: Locale; t: Dict }) {
  const egp = (v: string | null | undefined) => formatEGP(v, locale);
  const hasEstimates = Number(b.estimated_extra) > 0;
  return (
    <section className="finance card" aria-labelledby="finance-title">
      <header className="finance-head">
        <h2 id="finance-title">{t.finance.title}</h2>
        <span className="muted small">
          {label(t.enums.payment_mode, b.payment_mode)} · {t.finance.asOf(fmtDate(b.as_of, locale))}
        </span>
      </header>
      <dl className="figures">
        <Figure label={t.detail.cashPrice} value={egp(b.owner_cash_price)} emphasis />
        <Figure label={t.finance.sale.initialCash} value={egp(b.initial_cash_required)} emphasis />
        <Figure label={t.finance.sale.knownTotal} value={egp(b.known_total_cost)} />
        {hasEstimates && <Figure label={t.finance.sale.withEstimates} value={egp(b.total_with_estimates)} />}
        {Number(b.future_liabilities) > 0 && <Figure label={t.finance.sale.future} value={egp(b.future_liabilities)} />}
        {b.next_installment && (
          <Figure label={t.finance.sale.nextInstallment} value={`${egp(b.next_installment.amount)} · ${fmtDate(b.next_installment.due_date, locale)}`} />
        )}
        {b.final_installment_date && <Figure label={t.finance.sale.finalInstallment} value={fmtDate(b.final_installment_date, locale)} />}
        {Number(b.overdue_total) > 0 && <Figure label={t.finance.sale.overdue} value={egp(b.overdue_total)} />}
        {b.price_per_sqm && <Figure label={t.detail.pricePerSqm} value={egp(b.price_per_sqm)} />}
      </dl>
      <Unconfirmed codes={b.unconfirmed} warnings={b.warnings} t={t} />
      <LineItems items={b.line_items} locale={locale} t={t} />
      <p className="muted small">{t.finance.disclaimer}</p>
    </section>
  );
}

export function RentSummary({ b, locale, t }: { b: RentBreakdown; locale: Locale; t: Dict }) {
  const egp = (v: string | null | undefined) => formatEGP(v, locale);
  return (
    <section className="finance card" aria-labelledby="finance-title">
      <header className="finance-head">
        <h2 id="finance-title">{t.finance.title}</h2>
      </header>
      <dl className="figures">
        <Figure label={t.finance.rent.monthly} value={egp(b.monthly_rent)} emphasis />
        <Figure label={t.finance.rent.moveIn} value={egp(b.move_in_cash_required)} emphasis />
        <Figure label={t.finance.rent.deposit} value={egp(b.security_deposit)} />
        {Number(b.refundable) > 0 && <Figure label={t.finance.rent.refundable} value={egp(b.refundable)} />}
        {b.min_term_rent_total && (
          <Figure
            label={t.finance.rent.minTerm}
            value={`${egp(b.min_term_rent_total)}${b.min_term_rent_assumes_increase ? ` (${t.finance.rent.assumesIncrease})` : ""}`}
          />
        )}
      </dl>
      <Unconfirmed codes={b.unconfirmed} warnings={b.warnings} t={t} />
      <LineItems items={b.line_items} locale={locale} t={t} />
      <p className="muted small">{t.finance.disclaimer}</p>
    </section>
  );
}
