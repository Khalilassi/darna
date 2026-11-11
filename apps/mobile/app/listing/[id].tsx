import React, { useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { useListing, useToggleFavorite } from "../../src/api/queries";
import { useAuth } from "../../src/auth/AuthProvider";
import {
  Badge, Button, Card, Divider, ErrorState, Icon, IconButton, LoadingState, Notice, PriceBreakdown, Row, Section, T,
} from "../../src/components";
import { CashComparisonTool } from "../../src/features/CashComparison";
import { PriceHistorySection } from "../../src/features/PriceHistory";
import { mediaUrl } from "../../src/config";
import { formatArea, formatDate, formatMoney, formatNumber, localizeDigits } from "../../src/i18n/format";
import { useLanguage } from "../../src/i18n/LanguageProvider";
import { useCompare } from "../../src/state/compare";
import { useTheme } from "../../src/theme";

type Detail = Schemas["ListingDetail"];

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useListing(id);
  const { colors } = useTheme();
  if (q.isPending) return <View style={[styles.flex, { backgroundColor: colors.background }]}><LoadingState /></View>;
  if (q.isError) return <View style={[styles.flex, { backgroundColor: colors.background }]}><BackBar /><ErrorState error={q.error} onRetry={() => void q.refetch()} /></View>;
  return <ListingView l={q.data} refetch={() => void q.refetch()} />;
}

function BackBar() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 12 }}>
      <IconButton icon="chevron-back" label={t("listing.back")} onPress={() => (router.canGoBack() ? router.back() : router.replace("/explore"))} />
    </View>
  );
}

function Gallery({ photos, title }: { photos: Detail["photos"]; title: string }) {
  const { width } = useWindowDimensions();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { lang } = useLanguage();
  const [index, setIndex] = useState(0);
  const w = Math.min(width, 900);
  const h = Math.round(w * 0.72);
  if (!photos.length)
    return (
      <View style={[styles.noPhotos, { height: h * 0.7, backgroundColor: colors.surfaceMuted }]}>
        <Icon name="image-outline" size={40} color={colors.textMuted} />
        <T tone="muted">{t("listing.noPhotos")}</T>
      </View>
    );
  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(Math.abs(e.nativeEvent.contentOffset.x) / w))}
        onScroll={Platform.OS === "web" ? (e) => setIndex(Math.round(Math.abs(e.nativeEvent.contentOffset.x) / w)) : undefined}
        scrollEventThrottle={64}
        accessibilityLabel={title}
      >
        {photos.map((p, i) => (
          <Image
            key={p.id}
            source={{ uri: mediaUrl(p.url) }}
            style={{ width: w, height: h }}
            contentFit="cover"
            transition={150}
            accessibilityLabel={`${title} – ${t("listing.photoCount", { index: i + 1, total: photos.length })}`}
          />
        ))}
      </ScrollView>
      <View style={styles.counter}>
        <Badge tone="dark" label={t("listing.photoCount", { index: formatNumber(index + 1, lang), total: formatNumber(photos.length, lang) })} icon="images-outline" />
      </View>
    </View>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  const { colors, radii } = useTheme();
  return (
    <View style={[styles.spec, { backgroundColor: colors.surface, borderRadius: radii.md, borderColor: colors.border }]}>
      <T variant="caption" tone="muted">{label}</T>
      <T variant="bodyStrong">{value}</T>
    </View>
  );
}

function ListingView({ l, refetch }: { l: Detail; refetch: () => void }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, radii, spacing } = useTheme();
  const { status } = useAuth();
  const compare = useCompare();
  const fav = useToggleFavorite();
  const signedIn = status === "signedIn";
  const requireAuth = (fn: () => void) => () => (signedIn ? fn() : router.push("/login"));
  const district = lang === "ar" ? l.district_name_ar : l.district_name_en;
  const project = lang === "ar" ? l.project_name_ar : l.project_name_en;
  const isSale = l.purpose !== "rent";
  const isRent = l.purpose !== "sale";
  const openDeal = l.my_open_deal_ids[0];
  const accepting = l.status === "active";
  const notify = (msg: string) => (Platform.OS === "web" ? globalThis.alert?.(msg) : Alert.alert(msg));

  const specs: [string, string][] = [
    [t("listing.type"), t(`enum.propertyType.${l.property_type}`)],
    [t("listing.bedrooms"), formatNumber(l.bedrooms, lang)],
    [t("listing.bathrooms"), formatNumber(l.bathrooms, lang)],
    [t("listing.builtArea"), formatArea(l.area_sqm, lang)],
    ...(l.garden_sqm ? [[t("listing.garden"), formatArea(l.garden_sqm, lang)] as [string, string]] : []),
    ...(l.floor !== null ? [[t("listing.floor"), l.floor === 0 ? t("listing.groundFloor") : formatNumber(l.floor, lang)] as [string, string]] : []),
    [t("listing.finishing"), t(`enum.finishing.${l.finishing}`)],
    [t("listing.delivery"), t(`enum.delivery.${l.delivery_status}`)],
    ...(l.orientation ? [[t("listing.orientation"), t(`enum.orientation.${l.orientation}`)] as [string, string]] : []),
    ...(l.furnished !== null ? [[t("listing.furnished"), l.furnished ? t("common.yes") : t("common.no")] as [string, string]] : []),
  ];

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} testID="listing-detail">
        <View>
          <Gallery photos={l.photos} title={l.title} />
          <View style={[styles.overlay, { top: insets.top + 8 }]}>
            <IconButton icon="chevron-back" label={t("listing.back")} background="rgba(255,255,255,0.92)" color="#1E1C18" onPress={() => (router.canGoBack() ? router.back() : router.replace("/explore"))} />
            <Row>
              <IconButton
                icon={compare.has(l.id) ? "git-compare" : "git-compare-outline"}
                label={compare.has(l.id) ? t("listing.inCompare") : t("listing.addCompare")}
                background="rgba(255,255,255,0.92)"
                color="#1E1C18"
                onPress={() => {
                  if (!compare.toggle(l.id)) notify(t("listing.compareFull"));
                }}
                testID="toggle-compare"
              />
              {!l.is_owner ? (
                <IconButton
                  icon={l.is_favorite ? "heart" : "heart-outline"}
                  label={l.is_favorite ? t("listing.unfavorite") : t("listing.favorite")}
                  background="rgba(255,255,255,0.92)"
                  color={l.is_favorite ? colors.danger : "#1E1C18"}
                  onPress={requireAuth(() => fav.mutate({ id: l.id, on: !l.is_favorite }, { onSettled: refetch }))}
                  testID="toggle-favorite"
                />
              ) : null}
            </Row>
          </View>
        </View>

        <View style={{ padding: spacing.lg, gap: spacing.xl, maxWidth: 900, width: "100%", alignSelf: "center" }}>
          <View style={{ gap: 8 }}>
            <Row wrap>
              <Badge label={t(`enum.purpose.${l.purpose}`)} tone="primary" />
              {l.status === "under_offer" ? <Badge label={t("listing.underOffer")} tone="warning" /> : null}
              {l.featured ? <Badge label={t("listing.featured")} tone="featured" icon="megaphone-outline" /> : null}
            </Row>
            {isSale && l.sale_cash_price ? (
              <View>
                <T variant="caption" tone="muted">{t("listing.cashPrice")}</T>
                <T variant="display" testID="detail-price">{formatMoney(l.sale_cash_price, lang)}</T>
                {l.sale_price_per_sqm ? <T tone="muted">{t("listing.perSqm", { value: formatMoney(l.sale_price_per_sqm, lang) })}</T> : null}
              </View>
            ) : null}
            {isRent && l.monthly_rent ? (
              <View>
                <T variant="caption" tone="muted">{t("listing.monthlyRent")}</T>
                <T variant={isSale ? "title" : "display"} testID="detail-rent">{`${formatMoney(l.monthly_rent, lang)} ${t("common.perMonth")}`}</T>
              </View>
            ) : null}
            <T variant="title">{l.title}</T>
            <Row>
              <Icon name="location-outline" size={16} color={colors.textMuted} />
              <T tone="muted" style={{ flex: 1 }}>{`${district} · ${t("listing.group", { code: localizeDigits(l.group_code, lang) })} · ${project}`}</T>
            </Row>
            <Row wrap>
              {l.owner_verified ? (
                <Badge label={t("listing.verifiedOwner")} tone="verified" icon="shield-checkmark" testID="detail-owner-verified" />
              ) : (
                <Badge label={t("listing.ownerNotVerified")} tone="neutral" icon="shield-outline" />
              )}
              {l.financials_verified ? (
                <Badge label={t("listing.financialsVerified")} tone="verified" icon="document-text" />
              ) : (
                <Badge label={t("listing.sellerProvided")} tone="neutral" icon="document-text-outline" />
              )}
            </Row>
            {l.featured ? <T variant="caption" tone="muted">{t("listing.featuredHelp")}</T> : null}
          </View>

          <Section title={t("listing.specs")}>
            <View style={styles.specGrid}>
              {specs.map(([k, v]) => <Spec key={k} label={k} value={v} />)}
            </View>
            <Notice tone="neutral" icon="lock-closed-outline">{t("listing.privacyNote")}</Notice>
          </Section>

          {l.description ? (
            <Section title={t("listing.description")}>
              <T>{l.description}</T>
            </Section>
          ) : null}

          <Section title={t("fin.title")}>
            <T variant="caption" tone="muted">{isSale ? t("fin.saleSubtitle") : t("fin.rentSubtitle")}</T>
            <View style={[styles.finCard, { backgroundColor: colors.surface, borderRadius: radii.lg, borderColor: colors.border }]}>
              <PriceBreakdown sale={l.sale_breakdown} rent={l.rent_breakdown} minLeaseMonths={l.rent_terms?.min_lease_months} />
            </View>
            {l.sale_breakdown && l.sale_breakdown.payment_mode === "installments" ? <CashComparisonTool listingId={l.id} /> : null}
          </Section>

          <PriceHistorySection listingId={l.id} purpose={isSale ? "sale" : "rent"} />

          <Card>
            <Row>
              <Icon name="stats-chart-outline" color={colors.primary} />
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">{t("market.compareTitle", { district })}</T>
                <T variant="caption" tone="muted">{t("market.compareBody")}</T>
              </View>
            </Row>
            <Button
              title={t("market.compareWithDistrict")}
              variant="secondary"
              size="sm"
              icon="bar-chart-outline"
              onPress={() =>
                router.push(`/market?purpose=${isSale ? "sale" : "rent"}&project=${encodeURIComponent(l.project_id)}&district=${encodeURIComponent(l.district_id)}&property_type=${l.property_type}`)
              }
              testID="compare-district"
            />
          </Card>

          <Card>
            <Row>
              <View style={[styles.avatar, { backgroundColor: colors.primaryMuted }]}>
                <T variant="heading" tone="primary">{l.owner_display_name.slice(0, 1).toUpperCase()}</T>
              </View>
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">{t("listing.listedBy", { name: l.owner_display_name })}</T>
                {l.published_at ? <T variant="caption" tone="muted">{t("listing.published", { date: formatDate(l.published_at, lang) })}</T> : null}
              </View>
            </Row>
            <Divider />
            <Notice tone="warning" icon="shield-half-outline">{t("listing.safety")}</Notice>
            <Button
              title={t("listing.report")}
              variant="ghost"
              size="sm"
              icon="flag-outline"
              onPress={requireAuth(() => router.push(`/support?subject_type=listing&subject_id=${l.id}&category=listing_issue`))}
            />
          </Card>
        </View>
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: insets.bottom + 12, backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        {l.is_owner ? (
          <>
            <T variant="caption" tone="muted" center>{t("listing.yourListing")}</T>
            <Button title={t("listing.manageListing")} fullWidth onPress={() => router.push("/owner")} />
          </>
        ) : !signedIn ? (
          <Button title={t("listing.signInToAct")} icon="log-in-outline" fullWidth onPress={() => router.push("/login")} testID="detail-signin" />
        ) : (
          <>
            <Row gap={10}>
              <Button
                title={l.my_conversation_id ? t("listing.openChat") : t("listing.message")}
                icon="chatbubble-ellipses-outline"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => router.push(l.my_conversation_id ? `/conversation/${l.my_conversation_id}` : `/contact/${l.id}`)}
                testID="detail-message"
              />
              <Button
                title={t("listing.requestViewing")}
                icon="calendar-outline"
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => router.push(`/viewing/${l.id}`)}
                testID="detail-viewing"
              />
            </Row>
            {openDeal ? (
              <Button title={t("listing.openDeal")} icon="briefcase-outline" fullWidth onPress={() => router.push(`/deal/${openDeal}`)} testID="detail-open-deal" />
            ) : (
              <Button
                title={t("listing.makeOffer")}
                icon="pricetag-outline"
                fullWidth
                disabled={!accepting}
                onPress={() => router.push(`/offer/${l.id}`)}
                testID="detail-offer"
              />
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noPhotos: { alignItems: "center", justifyContent: "center", gap: 8 },
  counter: { position: "absolute", bottom: 12, end: 12 },
  overlay: { position: "absolute", start: 12, end: 12, flexDirection: "row", justifyContent: "space-between" },
  specGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  spec: { minWidth: "30%", flexGrow: 1, padding: 12, gap: 2, borderWidth: StyleSheet.hairlineWidth },
  finCard: { padding: 16, borderWidth: StyleSheet.hairlineWidth },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  actions: { position: "absolute", start: 0, end: 0, bottom: 0, padding: 12, paddingHorizontal: 16, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
