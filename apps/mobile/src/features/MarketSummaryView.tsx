import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Divider, Section } from "../components/Layout";
import { MiniBars } from "../components/MiniBars";
import { Notice } from "../components/Notice";
import { T } from "../components/T";
import { formatDate, formatMoney, formatNumber } from "../i18n/format";
import { useLanguage } from "../i18n/LanguageProvider";
import { figureView, monthDate, splitDistricts } from "../lib/market";
import { useTheme } from "../theme";

type Summary = Schemas["MarketSummary"];

/** Median price per m² by district + monthly trend + methodology. `null` medians are shown as hidden, never as 0. */
export function MarketSummaryView({ data, highlightDistrict }: { data: Summary; highlightDistrict?: string | null }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const { colors } = useTheme();
  const [showEmpty, setShowEmpty] = useState(false);
  const purpose = data.purpose;
  const unit = purpose === "rent" ? t("market.perSqmMonth") : t("market.perSqm");
  const { withData, empty } = splitDistricts(data.districts, purpose);
  const name = (d: Schemas["DistrictSummary"]) => (lang === "ar" ? d.district_name_ar : d.district_name_en);
  const isHighlight = (d: Schemas["DistrictSummary"]) => !!highlightDistrict && (d.district_name_en === highlightDistrict || d.district_id === highlightDistrict);
  const ordered = [...withData.filter(isHighlight), ...withData.filter((d) => !isHighlight(d))];
  const hiddenText = t("market.notEnough", { min: formatNumber(data.min_sample, lang) });

  const district = (d: Schemas["DistrictSummary"], i: number) => {
    const f = figureView(d[purpose]);
    return (
      <View key={d.district_id} style={{ gap: 10 }} testID={`district-${d.district_name_en}`}>
        {i ? <Divider /> : null}
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={styles.nameRow}>
              <T variant="bodyStrong">{name(d)}</T>
              {isHighlight(d) ? <Badge label={t("market.thisListing")} tone="featured" icon="location-outline" /> : null}
            </View>
            <T variant="caption" tone="muted">{t("market.basedOn", { count: f.sample, value: formatNumber(f.sample, lang) })}</T>
          </View>
          {f.kind === "value" ? (
            <View style={styles.figure}>
              <T variant="heading" testID={`median-${d.district_name_en}`}>{formatMoney(f.median, lang)}</T>
              <T variant="caption" tone="muted">{unit}</T>
            </View>
          ) : (
            <View style={[styles.hidden, { backgroundColor: colors.surfaceMuted }]} testID={`hidden-${d.district_name_en}`}>
              <T variant="caption" tone="muted" style={{ textAlign: "center" }}>{hiddenText}</T>
            </View>
          )}
        </View>
      </View>
    );
  };

  const trend = data.trend.map((p) => {
    const v = p.median_per_sqm === null ? null : Number(p.median_per_sqm);
    const month = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-EG", { month: "short", year: "2-digit" }).format(monthDate(p.month));
    return {
      key: p.month,
      label: month,
      value: v,
      valueLabel: v === null ? "—" : formatMoney(v, lang, true),
      accessibilityLabel: v === null ? `${month}: ${hiddenText}` : `${month}: ${formatMoney(v, lang)} ${unit}`,
    };
  });

  return (
    <View style={{ gap: 16 }}>
      <Card testID="market-districts">
        <T variant="heading" accessibilityRole="header">{t("market.byDistrict")}</T>
        <T variant="caption" tone="muted">{purpose === "rent" ? t("market.byDistrictRent") : t("market.byDistrictSale")}</T>
        {ordered.length ? ordered.map(district) : <Notice tone="neutral">{t("market.noListings")}</Notice>}
        {empty.length ? (
          <>
            <Divider />
            <Button
              title={showEmpty ? t("market.hideEmpty") : t("market.showEmpty", { count: empty.length, value: formatNumber(empty.length, lang) })}
              variant="ghost"
              size="sm"
              onPress={() => setShowEmpty((s) => !s)}
            />
            {showEmpty ? <T variant="caption" tone="muted">{empty.map(name).join(" · ")}</T> : null}
          </>
        ) : null}
      </Card>

      <Card testID="market-trend">
        <T variant="heading" accessibilityRole="header">{t("market.trend")}</T>
        <T variant="caption" tone="muted">{t("market.trendBody", { unit })}</T>
        {trend.length ? <MiniBars bars={trend} testID="trend" /> : <Notice tone="neutral">{t("market.noTrend")}</Notice>}
        {data.trend.some((p) => p.median_per_sqm === null) ? <T variant="caption" tone="muted">{t("market.trendGap", { min: formatNumber(data.min_sample, lang) })}</T> : null}
      </Card>

      <Section title={t("market.methodology")}>
        <Notice tone="neutral" icon="information-circle-outline" testID="market-methodology">{data.methodology}</Notice>
        <T variant="caption" tone="muted">{t("market.generated", { date: formatDate(data.generated_at, lang, true) })}</T>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  figure: { alignItems: "flex-end" },
  hidden: { maxWidth: 170, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
});
