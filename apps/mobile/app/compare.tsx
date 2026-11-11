import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { api, unwrap } from "../src/api/client";
import { Badge, Button, EmptyState, ErrorState, IconButton, LoadingState, T } from "../src/components";
import { mediaUrl } from "../src/config";
import { formatArea, formatMoney, formatNumber } from "../src/i18n/format";
import { useLanguage } from "../src/i18n/LanguageProvider";
import { useCompare } from "../src/state/compare";
import { useTheme } from "../src/theme";

type L = Schemas["ListingDetail"];
const COL = 168;

export default function Compare() {
  const { ids: raw } = useLocalSearchParams<{ ids?: string }>();
  const ids = (raw ?? "").split(",").filter(Boolean).slice(0, 4);
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const compare = useCompare();
  const { colors, radii } = useTheme();
  const q = useQuery({
    queryKey: ["compare", ids],
    enabled: ids.length >= 2,
    queryFn: async () => unwrap(await api.GET("/listings/compare", { params: { query: { ids } } })),
  });
  if (ids.length < 2) return <EmptyState icon="git-compare-outline" title={t("compare.title")} body={t("compare.pickMore")} actionLabel={t("saved.explore")} onAction={() => router.replace("/explore")} />;
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const rows: [string, (l: L) => React.ReactNode][] = [
    [t("compare.price"), (l) => (l.sale_cash_price ? formatMoney(l.sale_cash_price, lang) : "—")],
    [t("compare.rent"), (l) => (l.monthly_rent ? formatMoney(l.monthly_rent, lang) : "—")],
    [t("compare.initialCash"), (l) => (l.sale_breakdown ? formatMoney(l.sale_breakdown.initial_cash_required, lang) : "—")],
    [t("compare.knownTotal"), (l) => (l.sale_breakdown ? formatMoney(l.sale_breakdown.known_total_cost, lang) : "—")],
    [t("compare.perSqm"), (l) => (l.sale_breakdown ? formatMoney(l.sale_breakdown.price_per_sqm, lang) : "—")],
    [t("compare.moveIn"), (l) => (l.rent_breakdown ? formatMoney(l.rent_breakdown.move_in_cash_required, lang) : "—")],
    [t("filters.paymentMode"), (l) => (l.sale_payment_mode ? t(`enum.paymentMode.${l.sale_payment_mode as "cash" | "installments"}`) : "—")],
    [t("listing.type"), (l) => t(`enum.propertyType.${l.property_type}`)],
    [t("listing.bedrooms"), (l) => formatNumber(l.bedrooms, lang)],
    [t("listing.bathrooms"), (l) => formatNumber(l.bathrooms, lang)],
    [t("listing.builtArea"), (l) => formatArea(l.area_sqm, lang)],
    [t("listing.garden"), (l) => (l.garden_sqm ? formatArea(l.garden_sqm, lang) : "—")],
    [t("listing.floor"), (l) => (l.floor === null ? "—" : formatNumber(l.floor, lang))],
    [t("listing.finishing"), (l) => t(`enum.finishing.${l.finishing}`)],
    [t("listing.delivery"), (l) => t(`enum.delivery.${l.delivery_status}`)],
    [t("filters.district"), (l) => (lang === "ar" ? l.district_name_ar : l.district_name_en)],
    [t("listing.verifiedOwner"), (l) => (l.owner_verified ? <Badge label={t("listing.verifiedOwner")} tone="verified" icon="shield-checkmark" /> : <T tone="muted">—</T>)],
    [t("listing.financialsVerified"), (l) => (l.financials_verified ? <Badge label={t("provenance.verified")} tone="verified" /> : <T tone="muted">{t("listing.sellerProvided")}</T>)],
  ];

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16 }} testID="compare-screen">
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={styles.row}>
            <View style={styles.labelCol} />
            {q.data.map((l) => (
              <View key={l.id} style={[styles.col, { gap: 6 }]}>
                <Image source={{ uri: mediaUrl(l.cover_photo_url) }} style={{ width: COL - 8, height: 100, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }} contentFit="cover" />
                <T variant="bodyStrong" numberOfLines={2}>{l.title}</T>
                <View style={{ flexDirection: "row", gap: 4 }}>
                  <Button title={t("compare.open")} size="sm" variant="secondary" onPress={() => router.push(`/listing/${l.id}`)} />
                  <IconButton
                    icon="close"
                    label={t("compare.remove")}
                    onPress={() => {
                      if (compare.has(l.id)) compare.toggle(l.id);
                      const rest = ids.filter((x) => x !== l.id);
                      router.setParams({ ids: rest.join(",") });
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
          {rows.map(([label, get], i) => (
            <View key={label} style={[styles.row, { backgroundColor: i % 2 ? "transparent" : colors.surfaceMuted, borderRadius: radii.sm }]}>
              <T variant="caption" tone="muted" style={styles.labelCol}>{label}</T>
              {q.data.map((l) => (
                <View key={l.id} style={styles.col}>
                  {(() => {
                    const v = get(l);
                    return typeof v === "string" ? <T variant="bodyStrong">{v}</T> : v;
                  })()}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  labelCol: { width: 112, paddingHorizontal: 8 },
  col: { width: COL, paddingHorizontal: 4 },
});
