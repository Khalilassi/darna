import React from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { usePriceHistory } from "../api/queries";
import { Badge } from "../components/Badge";
import { Divider, Row, Section } from "../components/Layout";
import { MiniBars } from "../components/MiniBars";
import { T } from "../components/T";
import { formatDate, formatMoney, formatPercent, intlLocale } from "../i18n/format";
import { useLanguage } from "../i18n/LanguageProvider";
import { priceSteps } from "../lib/market";

/** "Asking price history": one line for a single point, a step chart + list when the price changed. */
export function PriceHistoryView({ points, purpose }: { points: Schemas["PricePoint"][]; purpose: "sale" | "rent" }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const steps = priceSteps(points, purpose === "rent" ? "monthly_rent" : "sale_cash_price");
  if (!steps.length) return null;
  const money = (n: number) => (purpose === "rent" ? `${formatMoney(n, lang)} ${t("common.perMonth")}` : formatMoney(n, lang));
  const first = steps[0];
  if (steps.length === 1)
    return (
      <T tone="muted" testID="price-history-single">{t("priceHistory.listedAt", { price: money(first.price), date: formatDate(first.at, lang) })}</T>
    );
  const last = steps[steps.length - 1];
  const total = (last.price - first.price) / first.price;
  return (
    <View style={{ gap: 12 }} testID="price-history">
      <T tone="muted">
        {t(total < 0 ? "priceHistory.summaryDown" : "priceHistory.summaryUp", { pct: formatPercent(Math.abs(total), lang, 1), price: money(first.price) })}
      </T>
      <MiniBars
        height={80}
        bars={steps.map((s, i) => ({
          key: `${i}`,
          label: new Intl.DateTimeFormat(intlLocale(lang), { month: "short", day: "numeric" }).format(new Date(s.at)),
          value: s.price,
          valueLabel: formatMoney(s.price, lang, true),
          accessibilityLabel: `${formatDate(s.at, lang)}: ${money(s.price)}`,
          highlight: i === steps.length - 1,
        }))}
      />
      {steps.map((s, i) => (
        <View key={i} style={{ gap: 8 }}>
          {i ? <Divider /> : null}
          <Row>
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong">{money(s.price)}</T>
              <T variant="caption" tone="muted">{`${t(s.change === null ? "priceHistory.listed" : "priceHistory.changed")} · ${formatDate(s.at, lang)}`}</T>
            </View>
            {s.change !== null ? (
              <Badge
                tone={s.change < 0 ? "success" : "warning"}
                icon={s.change < 0 ? "trending-down" : "trending-up"}
                label={`${s.change < 0 ? "−" : "+"}${formatPercent(Math.abs(s.change), lang, 1)}`}
              />
            ) : null}
          </Row>
        </View>
      ))}
    </View>
  );
}

export function PriceHistorySection({ listingId, purpose }: { listingId: string; purpose: "sale" | "rent" }) {
  const { t } = useTranslation();
  const q = usePriceHistory(listingId);
  if (!q.data?.length) return null;
  return (
    <Section title={t("priceHistory.title")}>
      <PriceHistoryView points={q.data} purpose={purpose} />
      <T variant="caption" tone="muted">{t("priceHistory.note")}</T>
    </Section>
  );
}
