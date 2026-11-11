import React from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Schemas } from "@darna/api-client";
import { formatDate, formatMoney, formatPercent, toNumber } from "../i18n/format";
import { useLanguage } from "../i18n/LanguageProvider";
import type { Language } from "../i18n/language";
import { useTheme } from "../theme";
import { Badge, type BadgeTone } from "./Badge";
import { Divider, KeyValue } from "./Layout";
import { Notice } from "./Notice";
import { T } from "./T";

type LineItem = Schemas["LineItem"];
type Provenance = Schemas["Provenance"];

const PROVENANCE_TONE: Record<Provenance, BadgeTone> = {
  verified: "verified",
  seller_provided: "neutral",
  estimate: "warning",
  unknown: "danger",
};

/** Localized label for a line-item / fee code; unknown codes are humanized ("club_fee" -> "Club fee"). */
export function lineItemLabel(code: string, t: TFunction): string {
  const fallback = code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return t(`lineItem.${code}`, { defaultValue: fallback });
}

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const { t } = useTranslation();
  return (
    <Badge
      label={t(`provenance.${provenance}`)}
      tone={PROVENANCE_TONE[provenance]}
      icon={provenance === "verified" ? "shield-checkmark" : undefined}
      testID={`provenance-${provenance}`}
    />
  );
}

/** "transfer_fee: based on 2025 rates" -> "Developer transfer fee: based on 2025 rates". */
function localizeAssumption(text: string, t: TFunction): string {
  const m = /^([a-z0-9_]+): (.*)$/.exec(text);
  return m ? `${lineItemLabel(m[1], t)}: ${m[2]}` : text;
}

function LineItemRow({ item, lang, t }: { item: LineItem; lang: Language; t: TFunction }) {
  const unconfirmed = item.timing === "unconfirmed" || item.amount === null;
  return (
    <View style={styles.item} testID={`line-${item.code}`}>
      <View style={styles.itemHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="bodyStrong">{lineItemLabel(item.code, t)}</T>
          <T variant="caption" tone="muted">
            {[
              unconfirmed ? null : t(item.timing === "future" ? "fin.future" : "fin.atSigning"),
              item.payer !== "buyer" ? t("fin.paidBy", { payer: t(`enum.payer.${item.payer}`) }) : null,
            ].filter(Boolean).join(" · ")}
          </T>
        </View>
        {unconfirmed ? (
          <T variant="bodyStrong" tone="warning" testID="not-confirmed">{t("fin.notConfirmed")}</T>
        ) : (
          <T variant="bodyStrong" style={item.counted_in === "excluded" ? styles.excludedAmount : undefined}>{formatMoney(item.amount, lang)}</T>
        )}
      </View>
      <View style={styles.itemMeta}>
        <ProvenanceBadge provenance={item.provenance} />
        {item.counted_in === "estimates" ? <Badge label={t("fin.estimatedExtra")} tone="warning" /> : null}
        {item.counted_in === "excluded" && !unconfirmed ? <Badge label={t("fin.excluded")} tone="neutral" /> : null}
      </View>
      {unconfirmed ? <T variant="caption" tone="muted">{t("fin.notConfirmedHelp")}</T> : null}
      {item.note ? <T variant="caption" tone="muted">{t(`fin.${item.note}`, { defaultValue: item.note })}</T> : null}
      {item.assumption ? <T variant="caption" tone="warning" testID="assumption">{t("fin.assumption", { text: item.assumption })}</T> : null}
    </View>
  );
}

function Warnings({ codes }: { codes: string[] }) {
  const { t } = useTranslation();
  if (!codes.length) return null;
  return (
    <View style={{ gap: 8 }}>
      {codes.map((c) => (
        <Notice key={c} tone={c === "price_below_amount_paid" || c === "overdue_installments" ? "warning" : "info"} testID={`warning-${c}`}>
          {t(`warnings.${c}`, { defaultValue: c })}
        </Notice>
      ))}
    </View>
  );
}

export function SaleBreakdownView({ b }: { b: Schemas["SaleBreakdown"] }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const { colors, radii } = useTheme();
  const hasEstimates = (toNumber(b.estimated_extra) ?? 0) > 0;
  const verifiedShare = toNumber(b.verified_share) ?? 0;
  return (
    <View style={styles.wrap} testID="sale-breakdown">
      <View style={[styles.hero, { backgroundColor: colors.primaryMuted, borderRadius: radii.lg }]}>
        <T variant="label" tone="primary">{t("fin.initialCash")}</T>
        <T variant="display" testID="initial-cash">{formatMoney(b.initial_cash_required, lang)}</T>
        <T variant="caption" tone="muted">{t("fin.initialCashHelp")}</T>
      </View>
      <Warnings codes={b.warnings} />
      <View style={styles.rows}>
        <KeyValue label={t("fin.ownerCashPrice")} value={formatMoney(b.owner_cash_price, lang)} />
        {b.payment_mode === "installments" ? (
          <KeyValue label={t("fin.futureLiabilities")} value={formatMoney(b.future_liabilities, lang)} />
        ) : null}
        {(toNumber(b.overdue_total) ?? 0) > 0 ? <KeyValue label={t("fin.overdueTotal")} value={formatMoney(b.overdue_total, lang)} /> : null}
        <Divider />
        <KeyValue label={t("fin.knownTotal")} help={t("fin.knownTotalHelp")} value={formatMoney(b.known_total_cost, lang)} strong />
        {hasEstimates ? (
          <>
            <KeyValue label={t("fin.estimatedExtra")} value={`+ ${formatMoney(b.estimated_extra, lang)}`} tone="muted" />
            <KeyValue label={t("fin.totalWithEstimates")} value={formatMoney(b.total_with_estimates, lang)} />
          </>
        ) : null}
        <KeyValue label={t("fin.pricePerSqm")} value={formatMoney(b.price_per_sqm, lang)} tone="muted" />
        {b.owner_premium !== null && b.owner_premium !== undefined ? (
          <KeyValue label={t("fin.ownerPremium")} value={formatMoney(b.owner_premium, lang)} tone="muted" />
        ) : null}
        {verifiedShare > 0 ? (
          <T variant="caption" tone="success">{t("fin.verifiedShare", { pct: formatPercent(verifiedShare, lang) })}</T>
        ) : null}
      </View>

      {b.payment_mode === "installments" && b.schedule_summary.length ? (
        <View style={styles.rows} testID="schedule">
          <T variant="heading">{t("fin.schedule")}</T>
          {b.next_installment ? (
            <KeyValue
              label={t("fin.nextInstallment")}
              value={t("fin.nextInstallmentValue", { amount: formatMoney(b.next_installment.amount, lang), date: formatDate(b.next_installment.due_date, lang) })}
            />
          ) : null}
          {b.final_installment_date ? <KeyValue label={t("fin.finalInstallment")} value={formatDate(b.final_installment_date, lang)} /> : null}
          {b.schedule_summary.map((s) => (
            <KeyValue
              key={`${s.schedule}-${s.year}`}
              label={new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en", { useGrouping: false }).format(s.year)}
              help={t("fin.scheduleRow", { count: s.count, schedule: lineItemLabel(s.schedule, t) })}
              value={formatMoney(s.total, lang)}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.rows}>
        <T variant="heading">{t("fin.lineItems")}</T>
        {b.line_items.map((li, i) => (
          <React.Fragment key={`${li.code}-${i}`}>
            {i ? <Divider /> : null}
            <LineItemRow item={li} lang={lang} t={t} />
          </React.Fragment>
        ))}
      </View>
      <Assumptions items={b.assumptions} />
    </View>
  );
}

export function RentBreakdownView({ b, minLeaseMonths }: { b: Schemas["RentBreakdown"]; minLeaseMonths?: number }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const { colors, radii } = useTheme();
  const assumptions = b.assumptions.filter((a) => !a.startsWith("min_term_rent_total"));
  return (
    <View style={styles.wrap} testID="rent-breakdown">
      <View style={[styles.hero, { backgroundColor: colors.primaryMuted, borderRadius: radii.lg }]}>
        <T variant="label" tone="primary">{t("fin.moveIn")}</T>
        <T variant="display" testID="move-in">{formatMoney(b.move_in_cash_required, lang)}</T>
        <T variant="caption" tone="muted">{t("fin.moveInHelp")}</T>
      </View>
      <Warnings codes={b.warnings} />
      <View style={styles.rows}>
        <KeyValue label={t("fin.monthly")} value={formatMoney(b.monthly_rent, lang)} />
        <KeyValue label={t("fin.advanceRent")} value={formatMoney(b.advance_rent, lang)} />
        <KeyValue label={t("fin.deposit")} help={t("fin.refundable_per_lease_terms")} value={formatMoney(b.security_deposit, lang)} />
        <Divider />
        <KeyValue
          label={minLeaseMonths ? `${t("fin.minTermTotal")} · ${t("common.months", { count: minLeaseMonths })}` : t("fin.minTermTotal")}
          help={b.min_term_rent_assumes_increase ? t("fin.minTermIncrease") : undefined}
          value={formatMoney(b.min_term_rent_total, lang)}
          strong
        />
      </View>
      <View style={styles.rows}>
        <T variant="heading">{t("fin.lineItems")}</T>
        {b.line_items.map((li, i) => (
          <React.Fragment key={`${li.code}-${i}`}>
            {i ? <Divider /> : null}
            <LineItemRow item={li} lang={lang} t={t} />
          </React.Fragment>
        ))}
      </View>
      <Assumptions items={assumptions} />
    </View>
  );
}

function Assumptions({ items }: { items: string[] }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <View style={styles.rows} testID="assumptions">
      <T variant="heading">{t("fin.assumptions")}</T>
      {items.map((a) => (
        <T key={a} variant="caption" tone="muted">{`• ${localizeAssumption(a, t)}`}</T>
      ))}
    </View>
  );
}

/** Financial breakdown for a listing: sale and/or rent, with provenance on every line. */
export function PriceBreakdown({
  sale, rent, minLeaseMonths,
}: { sale?: Schemas["SaleBreakdown"] | null; rent?: Schemas["RentBreakdown"] | null; minLeaseMonths?: number }) {
  return (
    <View style={{ gap: 24 }}>
      {sale ? <SaleBreakdownView b={sale} /> : null}
      {rent ? <RentBreakdownView b={rent} minLeaseMonths={minLeaseMonths} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  hero: { padding: 16, gap: 4 },
  rows: { gap: 10 },
  item: { gap: 6, paddingVertical: 4 },
  itemHead: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  itemMeta: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  excludedAmount: { opacity: 0.6 },
});
