import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../../src/api/client";
import { errorMessage } from "../../src/api/errors";
import { qk, useMyListings, useMyProperties, useProjects } from "../../src/api/queries";
import { useAuth } from "../../src/auth/AuthProvider";
import { Badge, Button, Card, EmptyState, Notice, QueryView, Row, Screen, Section, SignInRequired, T } from "../../src/components";
import { mediaUrl } from "../../src/config";
import { formatMoney, formatNumber } from "../../src/i18n/format";
import { useLanguage } from "../../src/i18n/LanguageProvider";
import { CLAIM_TONE, LISTING_TONE } from "../../src/lib/tones";
import { useTheme } from "../../src/theme";


export default function OwnerHub() {
  return (
    <SignInRequired>
      <Hub />
    </SignInRequired>
  );
}

function Hub() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const qc = useQueryClient();
  const { colors, radii } = useTheme();
  const { me, refreshMe } = useAuth();
  const props = useMyProperties();
  const listings = useMyListings();
  const projects = useProjects();
  const identity = me?.verification.identity ?? "none";
  const verified = identity === "approved";
  const districtName = (id: string) => {
    const d = projects.data?.flatMap((p) => p.districts).find((x) => x.id === id);
    return d ? (lang === "ar" ? d.name_ar : d.name_en) : "";
  };
  const withdraw = useMutation({
    mutationFn: async (claimId: string) => unwrap(await api.POST("/properties/claims/{claim_id}/withdraw", { params: { path: { claim_id: claimId } } })),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.myProperties }),
  });

  return (
    <Screen
      refreshing={props.isRefetching || listings.isRefetching}
      onRefresh={() => {
        void props.refetch();
        void listings.refetch();
        void refreshMe();
      }}
    >
      <Card style={{ backgroundColor: colors.primary }}>
        <T variant="title" style={{ color: colors.onPrimary }}>{t("owner.hubTitle")}</T>
        <T style={{ color: colors.onPrimary, opacity: 0.9 }}>{t("owner.hubBody")}</T>
        {[t("owner.step1"), t("owner.step2"), t("owner.step3"), t("owner.step4")].map((s, i) => (
          <T key={s} style={{ color: colors.onPrimary }}>{`${formatNumber(i + 1, lang)}. ${s}`}</T>
        ))}
      </Card>

      <Section title={t("owner.identity")}>
        <Card testID="identity-card">
          <Row style={{ justifyContent: "space-between" }}>
            <T variant="bodyStrong">{verified ? t("owner.identityVerified") : t("verify.title")}</T>
            <Badge
              label={t(`enum.verificationStatus.${identity}`, { defaultValue: identity })}
              tone={verified ? "verified" : identity === "rejected" ? "danger" : identity === "none" ? "neutral" : "warning"}
              icon={verified ? "shield-checkmark" : undefined}
            />
          </Row>
          {!verified && !["submitted", "under_review"].includes(identity) ? (
            <Button title={t("owner.verifyIdentity")} icon="id-card-outline" onPress={() => router.push("/owner/verify")} testID="verify-identity" />
          ) : null}
        </Card>
      </Section>

      <Section title={t("owner.properties")} action={<Button title={t("owner.registerProperty")} size="sm" variant="secondary" icon="add" onPress={() => router.push("/owner/property-new")} testID="register-property" />}>
        {withdraw.isError ? <Notice tone="danger">{errorMessage(withdraw.error, t)}</Notice> : null}
        <QueryView
          query={props}
          isEmpty={(d) => !d.length}
          empty={<EmptyState icon="business-outline" title={t("owner.noProperties")} body={t("owner.noPropertiesBody")} />}
        >
          {(data) =>
            data.map(({ property: p, claim, live_listing_id, live_listing_status }) => (
              <Card key={claim.id}>
                <Row style={{ justifyContent: "space-between" }}>
                  <T variant="bodyStrong" style={{ flex: 1 }}>
                    {`${t(`enum.propertyType.${p.property_type}`)} · ${districtName(p.district_id)} · ${t("deal.groupLabel")} ${p.group_code} · ${p.building_code}${p.unit_code ? ` / ${p.unit_code}` : ""}`}
                  </T>
                </Row>
                <Row wrap>
                  <Badge label={`${t("owner.claim")}: ${t(`enum.claimStatus.${claim.status}`)}`} tone={CLAIM_TONE[claim.status]} />
                  <Badge label={t(`enum.capacity.${claim.capacity}`)} tone="neutral" />
                  {live_listing_status ? <Badge label={t("owner.liveListing", { status: t(`enum.listingStatus.${live_listing_status}`) })} tone={LISTING_TONE[live_listing_status]} /> : null}
                </Row>
                {claim.decision_note ? <T variant="caption" tone="muted">{claim.decision_note}</T> : null}
                <Row wrap>
                  {live_listing_id ? (
                    <Button title={t("owner.manage")} size="sm" onPress={() => router.push(`/owner/listing/${live_listing_id}`)} />
                  ) : claim.status === "approved" ? (
                    <Button title={t("owner.createListing")} size="sm" icon="add" onPress={() => router.push(`/owner/listing-new?propertyId=${p.id}`)} testID={`create-listing-${p.id}`} />
                  ) : (
                    <T variant="caption" tone="muted">{t("owner.claimNeedsApproval")}</T>
                  )}
                  {["submitted", "under_review", "disputed"].includes(claim.status) ? (
                    <Button title={t("owner.withdrawClaim")} size="sm" variant="ghost" onPress={() => withdraw.mutate(claim.id)} loading={withdraw.isPending && withdraw.variables === claim.id} />
                  ) : null}
                </Row>
              </Card>
            ))
          }
        </QueryView>
      </Section>

      <Section title={t("owner.listings")}>
        <QueryView query={listings} isEmpty={(d) => !d.length} empty={<T tone="muted">{t("owner.noListings")}</T>}>
          {(data) =>
            data.map((l) => (
              <Card key={l.id} onPress={() => router.push(`/owner/listing/${l.id}`)} accessibilityLabel={l.title} testID={`my-listing-${l.id}`}>
                <Row style={{ alignItems: "flex-start" }}>
                  <Image source={{ uri: mediaUrl(l.cover_photo_url) }} style={{ width: 72, height: 72, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }} contentFit="cover" />
                  <View style={{ flex: 1, gap: 4 }}>
                    <T variant="bodyStrong" numberOfLines={1}>{l.title}</T>
                    <Badge label={t(`enum.listingStatus.${l.status}`)} tone={LISTING_TONE[l.status]} />
                    <T variant="caption" tone="muted">{formatMoney(l.sale_cash_price ?? l.monthly_rent, lang)}</T>
                  </View>
                </Row>
                {l.moderation_note ? <Notice tone="warning">{t("owner.moderationNote", { note: l.moderation_note })}</Notice> : null}
                <Row wrap gap={14}>
                  {(["views", "favorites", "conversations", "pending_viewings", "pending_offers", "active_deals"] as const).map((k) => (
                    <View key={k}>
                      <T variant="bodyStrong">{formatNumber(l.stats[k], lang)}</T>
                      <T variant="caption" tone="muted">{t(`owner.stats.${k}`)}</T>
                    </View>
                  ))}
                </Row>
              </Card>
            ))
          }
        </QueryView>
      </Section>
    </Screen>
  );
}
