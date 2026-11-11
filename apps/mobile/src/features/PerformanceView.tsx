import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { Card } from "../components/Card";
import { ChipGroup } from "../components/Choice";
import { Divider } from "../components/Layout";
import { MiniBars, type Bar } from "../components/MiniBars";
import { Notice } from "../components/Notice";
import { EmptyState } from "../components/States";
import { T } from "../components/T";
import { formatNumber, formatPercent, intlLocale } from "../i18n/format";
import { useLanguage } from "../i18n/LanguageProvider";
import type { Language } from "../i18n/language";
import { chartBuckets, hasActivity, METRICS, performanceInsight, type Metric } from "../lib/performance";
import { useTheme } from "../theme";

type Performance = Schemas["Performance"];

const dayDate = (iso: string) => new Date(`${iso}T00:00:00`);
const shortDay = (iso: string, lang: Language) => new Intl.DateTimeFormat(intlLocale(lang), { day: "numeric", month: "short" }).format(dayDate(iso));
const dayNum = (iso: string, lang: Language) => new Intl.DateTimeFormat(intlLocale(lang), { day: "numeric" }).format(dayDate(iso));

/** Period totals, views chart (daily, or weekly beyond a month), funnel and a suggestion-only insight. */
export function PerformanceView({ data }: { data: Performance }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const { colors, radii } = useTheme();
  const [metric, setMetric] = useState<Metric>("views");
  const n = (v: number) => formatNumber(v, lang);
  const totals = data.totals;
  const active = hasActivity(totals);
  const insight = performanceInsight(totals);

  const { weekly, buckets } = chartBuckets(data.series);
  const label = (b: (typeof buckets)[number]) => (weekly ? t("perf.weekOf", { date: shortDay(b.start, lang) }) : shortDay(b.start, lang));
  const bars: Bar[] = buckets.map((b) => ({
    key: b.start,
    label: buckets.length <= 7 ? dayNum(b.start, lang) : "",
    value: b[metric],
    valueLabel: n(b[metric]),
    accessibilityLabel: t("perf.barLabel", { date: label(b), value: n(b[metric]) }),
  }));
  const metricName = t(`perf.metric.${metric}`);
  const peak = buckets.reduce((best, b) => (b[metric] > best[metric] ? b : best), buckets[0]);
  const summary =
    buckets.length && peak
      ? t("perf.chartSummary", {
          metric: metricName,
          from: shortDay(buckets[0].start, lang),
          to: shortDay(buckets[buckets.length - 1].end, lang),
          total: n(totals[metric]),
          max: n(peak[metric]),
          maxAt: label(peak),
        })
      : "";
  const maxFunnel = Math.max(1, ...data.funnel.map((s) => s.count));

  return (
    <View style={{ gap: 16 }}>
      <Card testID="perf-headline">
        <T variant="heading" accessibilityRole="header">{t("perf.headline", { value: n(data.days) })}</T>
        <View style={styles.grid}>
          {METRICS.map((m) => (
            <View key={m} style={[styles.tile, { backgroundColor: colors.surfaceMuted, borderRadius: radii.md }]}>
              <T variant="title" testID={`perf-total-${m}`}>{n(totals[m])}</T>
              <T variant="caption" tone="muted">{t(`perf.metric.${m}`)}</T>
            </View>
          ))}
        </View>
        <Divider />
        <View style={styles.pair}>
          <View style={styles.flex}>
            <T variant="caption" tone="muted">{t("perf.daysOnMarket")}</T>
            <T variant="bodyStrong" testID="perf-days-on-market">{data.days_on_market === null ? t("perf.notPublished") : n(data.days_on_market)}</T>
          </View>
          <View style={styles.flex}>
            <T variant="caption" tone="muted">{t("perf.allTimeViews")}</T>
            <T variant="bodyStrong" testID="perf-all-time-views">{n(data.total_views_all_time)}</T>
          </View>
        </View>
      </Card>

      {!active ? (
        <EmptyState icon="stats-chart-outline" title={t("perf.empty")} body={t("perf.emptyBody")} testID="perf-empty" />
      ) : (
        <>
          {insight ? (
            <Notice tone="info" title={t("perf.insightTitle")} icon="bulb-outline" testID="perf-insight">
              <T variant="caption">{t(`perf.insight.${insight}`)}</T>
              <T variant="caption" tone="muted">{t("perf.insightNote")}</T>
            </Notice>
          ) : null}

          <Card testID="perf-chart">
            <T variant="heading" accessibilityRole="header">{t(weekly ? "perf.chartWeekly" : "perf.chartDaily", { metric: metricName })}</T>
            <ChipGroup
              scroll
              label={t("perf.showMetric")}
              value={metric}
              onChange={(v) => v && setMetric(v)}
              options={METRICS.map((m) => ({ value: m, label: t(`perf.metric.${m}`) }))}
            />
            <View accessible accessibilityRole="image" accessibilityLabel={summary} testID="perf-chart-bars">
              <MiniBars bars={bars} height={110} gap={bars.length > 14 ? 2 : 6} showValues={bars.length <= 14} flatZero />
            </View>
            {buckets.length ? (
              <View style={styles.axis}>
                <T variant="caption" tone="muted">{shortDay(buckets[0].start, lang)}</T>
                <T variant="caption" tone="muted">{shortDay(buckets[buckets.length - 1].end, lang)}</T>
              </View>
            ) : null}
            {weekly ? <T variant="caption" tone="muted">{t("perf.chartWeeklyHint")}</T> : null}
          </Card>

          <Card testID="perf-funnel">
            <T variant="heading" accessibilityRole="header">{t("perf.funnel")}</T>
            <T variant="caption" tone="muted">{t("perf.funnelBody")}</T>
            {data.funnel.map((s, i) => {
              const name = (METRICS as string[]).includes(s.step) ? t(`perf.metric.${s.step}`) : s.step;
              const rate = s.rate_from_previous === null ? t("perf.noRate") : t("perf.stepRate", { rate: formatPercent(s.rate_from_previous, lang) });
              return (
                <View key={s.step} style={styles.step} testID={`perf-step-${s.step}`} accessible accessibilityLabel={`${name}: ${n(s.count)}${i ? `, ${rate}` : ""}`}>
                  <View style={styles.stepHead}>
                    <T variant="bodyStrong" style={styles.flex}>{name}</T>
                    <T variant="bodyStrong" testID={`perf-step-${s.step}-count`}>{n(s.count)}</T>
                  </View>
                  <View style={[styles.track, { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill }]}>
                    <View style={{ width: `${Math.round((s.count / maxFunnel) * 100)}%`, height: "100%", backgroundColor: colors.primary, borderRadius: radii.pill }} />
                  </View>
                  {i ? <T variant="caption" tone="muted" testID={`perf-step-${s.step}-rate`}>{rate}</T> : null}
                </View>
              );
            })}
          </Card>
        </>
      )}

      <T variant="caption" tone="muted" testID="perf-note">{t("perf.note")}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { minWidth: "30%", flexGrow: 1, padding: 10, gap: 2 },
  pair: { flexDirection: "row", gap: 12 },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  step: { gap: 6 },
  stepHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  track: { height: 8, overflow: "hidden" },
});
