import React from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { mediaUrl } from "../config";
import { formatArea, formatMoney } from "../i18n/format";
import { useLanguage } from "../i18n/LanguageProvider";
import { useTheme } from "../theme";
import { Badge } from "./Badge";
import { IconButton } from "./Button";
import { Card } from "./Card";
import { Icon } from "./Icon";
import { T } from "./T";

type CardData = Pick<
  Schemas["ListingCard"],
  | "id" | "title" | "purpose" | "status" | "cover_photo_url" | "featured" | "owner_verified" | "financials_verified"
  | "district_name_en" | "district_name_ar" | "project_name_en" | "project_name_ar" | "group_code" | "property_type"
  | "bedrooms" | "bathrooms" | "area_sqm" | "sale_cash_price" | "sale_initial_cash" | "sale_payment_mode" | "monthly_rent"
>;

export interface ListingCardProps {
  listing: CardData;
  onPress?: () => void;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  selected?: boolean;
  compact?: boolean;
}

/** Headline price: sale cash price, or monthly rent for rent-only listings. */
export function headlinePrice(l: Pick<CardData, "purpose" | "sale_cash_price" | "monthly_rent">) {
  if (l.purpose === "rent") return { amount: l.monthly_rent, monthly: true };
  return { amount: l.sale_cash_price, monthly: false };
}

export function ListingCard({ listing: l, onPress, favorite, onToggleFavorite, selected, compact }: ListingCardProps) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const { colors } = useTheme();
  const price = headlinePrice(l);
  const district = lang === "ar" ? l.district_name_ar : l.district_name_en;
  const project = lang === "ar" ? l.project_name_ar : l.project_name_en;
  const uri = mediaUrl(l.cover_photo_url);
  const priceText = `${formatMoney(price.amount, lang)}${price.monthly ? ` ${t("common.perMonth")}` : ""}`;
  return (
    <Card
      onPress={onPress}
      padded={false}
      testID={`listing-card-${l.id}`}
      accessibilityLabel={`${l.title}, ${priceText}, ${district}`}
      style={selected ? { borderColor: colors.primary, borderWidth: 2 } : undefined}
    >
      <View style={[styles.imageWrap, { height: compact ? 150 : 210, backgroundColor: colors.surfaceMuted }]}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} accessibilityIgnoresInvertColors />
        ) : (
          <View style={styles.noPhoto}>
            <Icon name="image-outline" size={32} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.topRow}>
          <View style={styles.badges}>
            {l.featured ? <Badge label={t("listing.featured")} tone="featured" icon="megaphone-outline" testID="badge-featured" /> : null}
            {l.status === "under_offer" ? <Badge label={t("listing.underOffer")} tone="dark" /> : null}
          </View>
          {onToggleFavorite ? (
            <IconButton
              icon={favorite ? "heart" : "heart-outline"}
              label={favorite ? t("listing.unfavorite") : t("listing.favorite")}
              onPress={onToggleFavorite}
              color={favorite ? colors.danger : "#1E1C18"}
              background="rgba(255,255,255,0.92)"
              testID={`fav-${l.id}`}
            />
          ) : null}
        </View>
        <View style={styles.bottomRow}>
          <Badge label={t(`enum.purpose.${l.purpose}`)} tone="dark" />
        </View>
      </View>
      <View style={[styles.body, { gap: compact ? 4 : 6 }]}>
        <View style={styles.priceRow}>
          <T variant="price" testID="listing-price" numberOfLines={1} style={{ flexShrink: 1 }}>
            {formatMoney(price.amount, lang)}
            {price.monthly ? <T variant="caption" tone="muted">{` ${t("common.perMonth")}`}</T> : null}
          </T>
          {selected ? <Icon name="checkmark-circle" color={colors.primary} size={22} /> : null}
        </View>
        {l.purpose !== "rent" && l.sale_payment_mode === "installments" && l.sale_initial_cash ? (
          <T variant="caption" tone="accent">{t("listing.initialCash", { value: formatMoney(l.sale_initial_cash, lang) })}</T>
        ) : null}
        {l.purpose === "sale_and_rent" && l.monthly_rent ? (
          <T variant="caption" tone="muted">{`${t("enum.purpose.rent")}: ${formatMoney(l.monthly_rent, lang)} ${t("common.perMonth")}`}</T>
        ) : null}
        <T variant="bodyStrong" numberOfLines={1}>{l.title}</T>
        <View style={styles.specs}>
          <Spec icon="bed-outline" text={t("listing.beds", { count: l.bedrooms })} />
          <Spec icon="water-outline" text={t("listing.baths", { count: l.bathrooms })} />
          <Spec icon="resize-outline" text={formatArea(l.area_sqm, lang)} />
        </View>
        <View style={styles.footer}>
          <Icon name="location-outline" size={14} color={colors.textMuted} />
          <T variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {`${t(`enum.propertyType.${l.property_type}`)} · ${district} · ${project}`}
          </T>
          {l.owner_verified ? <Badge label={t("listing.verifiedOwner")} tone="verified" icon="shield-checkmark" testID="badge-owner-verified" /> : null}
        </View>
        {l.financials_verified && !compact ? (
          <Badge label={t("listing.financialsVerified")} tone="verified" icon="document-text-outline" testID="badge-fin-verified" />
        ) : null}
      </View>
    </Card>
  );
}

function Spec({ icon, text }: { icon: React.ComponentProps<typeof Icon>["name"]; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.spec}>
      <Icon name={icon} size={15} color={colors.textMuted} />
      <T variant="caption" tone="muted">{text}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  imageWrap: { width: "100%", overflow: "hidden" },
  noPhoto: { flex: 1, alignItems: "center", justifyContent: "center" },
  topRow: { position: "absolute", top: 10, start: 10, end: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  badges: { gap: 6, flexShrink: 1 },
  bottomRow: { position: "absolute", bottom: 10, start: 10 },
  body: { padding: 14 },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  specs: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  spec: { flexDirection: "row", alignItems: "center", gap: 4 },
  footer: { flexDirection: "row", alignItems: "center", gap: 6 },
});
