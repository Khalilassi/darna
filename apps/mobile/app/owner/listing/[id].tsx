import React, { useState } from "react";
import { Alert, Platform, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { api, unwrap } from "../../../src/api/client";
import { errorMessage } from "../../../src/api/errors";
import { qk, useMyListing, useVerifications } from "../../../src/api/queries";
import {
  Badge, Button, Card, DocumentUploader, ErrorState, Icon, IconButton, KeyValue, LoadingState, Notice, PriceBreakdown, Row, Screen, Section, SignInRequired, T,
} from "../../../src/components";
import { mediaUrl } from "../../../src/config";
import { formatDate, formatNumber } from "../../../src/i18n/format";
import { useLanguage } from "../../../src/i18n/LanguageProvider";
import { ownerActions } from "../../../src/lib/listing";
import { LISTING_TONE } from "../../../src/lib/tones";
import { pickImage, uploadListingPhoto } from "../../../src/lib/upload";
import { useTheme } from "../../../src/theme";

type Action = Schemas["ActionIn"]["action"];
const EDITABLE: Schemas["ListingStatus"][] = ["draft", "rejected", "paused"];

function confirmThen(message: string, fn: () => void) {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(message) ?? true) fn();
    return;
  }
  Alert.alert(message, undefined, [{ text: "Cancel", style: "cancel" }, { text: "OK", style: "destructive", onPress: fn }]);
}

export default function ManageListing() {
  return (
    <SignInRequired>
      <Manage />
    </SignInRequired>
  );
}

function Manage() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const qc = useQueryClient();
  const { colors, radii } = useTheme();
  const q = useMyListing(id);
  const verifications = useVerifications();
  const [error, setError] = useState<string | null>(null);
  const [finDocs, setFinDocs] = useState<Schemas["DocumentOut"][]>([]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.myListing(id) });
    void qc.invalidateQueries({ queryKey: qk.myListings });
  };
  const act = useMutation({
    mutationFn: async (action: Action) => unwrap(await api.POST("/listings/{listing_id}/actions", { params: { path: { listing_id: id } }, body: { action } })),
    onSuccess: (l) => {
      qc.setQueryData(qk.myListing(id), l);
      setError(null);
      refresh();
    },
    onError: (e) => setError(errorMessage(e, t)),
  });
  const addPhoto = useMutation({
    mutationFn: async () => {
      const f = await pickImage();
      if (!f) return null;
      return uploadListingPhoto(id, f);
    },
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e, t)),
  });
  const delPhoto = useMutation({
    mutationFn: async (photoId: string) => unwrap(await api.DELETE("/listings/{listing_id}/photos/{photo_id}", { params: { path: { listing_id: id, photo_id: photoId } } })),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e, t)),
  });
  const finVerify = useMutation({
    mutationFn: async () => unwrap(await api.POST("/verifications/financial", { body: { listing_id: id, document_ids: finDocs.map((d) => d.id) } })),
    onSuccess: () => {
      setFinDocs([]);
      void qc.invalidateQueries({ queryKey: qk.verifications });
    },
  });

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const l = q.data;
  const editable = EDITABLE.includes(l.status);
  const actions = ownerActions(l);
  const finRequests = (verifications.data ?? []).filter((v) => v.kind === "financial" && v.listing_id === l.id);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {created ? <Notice tone="success">{t("listingForm.created")}</Notice> : null}
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Badge label={t(`enum.listingStatus.${l.status}`)} tone={LISTING_TONE[l.status]} testID="manage-status" />
          <T variant="caption" tone="muted">{t("manage.version", { v: formatNumber(l.version, lang) })}</T>
        </Row>
        <T variant="heading">{l.title}</T>
        <T variant="caption" tone="muted">{`${lang === "ar" ? l.district_name_ar : l.district_name_en} · ${l.group_code} · ${l.building_code}${l.unit_code ? ` / ${l.unit_code}` : ""}`}</T>
        {l.moderation_note ? <Notice tone="warning">{t("owner.moderationNote", { note: l.moderation_note })}</Notice> : null}
        {error ? <Notice tone="danger" testID="manage-error">{error}</Notice> : null}
        <Row wrap>
          {actions.map((a) => (
            <Button
              key={a}
              title={t(`manage.${a}`)}
              size="sm"
              variant={a === "withdraw" ? "danger" : a === "pause" ? "outline" : "primary"}
              loading={act.isPending && act.variables === a}
              disabled={act.isPending}
              onPress={() => (a === "withdraw" ? confirmThen(t("manage.withdrawConfirm"), () => act.mutate(a)) : act.mutate(a))}
              testID={`manage-${a}`}
            />
          ))}
          {editable ? <Button title={t("manage.edit")} size="sm" variant="secondary" icon="create-outline" onPress={() => router.push(`/owner/listing-edit/${l.id}`)} /> : null}
          {l.status === "active" || l.status === "under_offer" ? (
            <Button title={t("manage.viewPublic")} size="sm" variant="ghost" onPress={() => router.push(`/listing/${l.id}`)} />
          ) : null}
        </Row>
        {!editable ? <T variant="caption" tone="muted">{t("manage.editHint")}</T> : null}
      </Card>

      <Section title={t("manage.stats")}>
        <View style={styles.stats}>
          {(["views", "favorites", "conversations", "pending_viewings", "pending_offers", "active_deals"] as const).map((k) => (
            <View key={k} style={[styles.stat, { backgroundColor: colors.surface, borderRadius: radii.md, borderColor: colors.border }]}>
              <T variant="title">{formatNumber(l.stats[k], lang)}</T>
              <T variant="caption" tone="muted">{t(`owner.stats.${k}`)}</T>
            </View>
          ))}
        </View>
        <Card onPress={() => router.push(`/owner/performance/${l.id}`)} accessibilityLabel={t("manage.openPerformance")} testID="open-performance">
          <Row>
            <Icon name="stats-chart-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="bodyStrong">{t("manage.openPerformance")}</T>
              <T variant="caption" tone="muted">{t("manage.openPerformanceBody")}</T>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.textMuted} />
          </Row>
        </Card>
      </Section>

      <Section title={t("manage.photos")} action={editable ? <Button title={t("manage.addPhoto")} size="sm" icon="camera-outline" onPress={() => addPhoto.mutate()} loading={addPhoto.isPending} testID="add-photo" /> : undefined}>
        {!l.photos.length ? <T variant="caption" tone="muted">{t("manage.photoHint")}</T> : null}
        <View style={styles.photos}>
          {l.photos.map((p) => (
            <View key={p.id}>
              <Image source={{ uri: mediaUrl(p.url) }} style={{ width: 104, height: 78, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }} contentFit="cover" />
              {editable ? (
                <View style={styles.photoDel}>
                  <IconButton icon="trash" label={t("manage.deletePhoto")} size={16} background="rgba(255,255,255,0.9)" color={colors.danger} onPress={() => delPhoto.mutate(p.id)} />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </Section>

      <Section title={t("fin.title")}>
        <Card>
          <PriceBreakdown sale={l.sale_breakdown} rent={l.rent_breakdown} minLeaseMonths={l.rent_terms?.min_lease_months} />
        </Card>
      </Section>

      {l.sale_terms ? (
        <Section title={t("manage.financial")}>
          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <T tone="muted" style={{ flex: 1 }}>{t("manage.financialBody")}</T>
              {l.financials_verified ? <Badge label={t("listing.financialsVerified")} tone="verified" icon="shield-checkmark" /> : null}
            </Row>
            {finRequests.map((v) => (
              <KeyValue key={v.id} label={formatDate(v.created_at, lang)} help={v.decision_note ?? undefined} value={<Badge label={t(`enum.verificationStatus.${v.status}`)} tone={v.status === "approved" ? "verified" : v.status === "rejected" ? "danger" : "info"} />} />
            ))}
            <DocumentUploader label={t("manage.financialKind")} kinds={["developer_statement", "payment_receipt", "maintenance_receipt"]} docs={finDocs} onChange={setFinDocs} />
            {finVerify.isError ? <Notice tone="danger">{errorMessage(finVerify.error, t)}</Notice> : null}
            {finVerify.isSuccess ? <Notice tone="success">{t("verify.submitted")}</Notice> : null}
            <Button title={t("manage.requestFinancial")} variant="secondary" disabled={!finDocs.length} loading={finVerify.isPending} onPress={() => finVerify.mutate()} />
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { minWidth: "30%", flexGrow: 1, padding: 12, borderWidth: StyleSheet.hairlineWidth },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoDel: { position: "absolute", top: 2, end: 2 },
});
