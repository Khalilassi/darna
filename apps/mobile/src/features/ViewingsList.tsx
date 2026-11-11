import React, { useState } from "react";
import { FlatList, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { api, unwrap } from "../api/client";
import { errorMessage } from "../api/errors";
import { qk, useViewings } from "../api/queries";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Notice, Row, T, type BadgeTone } from "../components";
import { formatDate } from "../i18n/format";
import { useLanguage } from "../i18n/LanguageProvider";
import { useTheme } from "../theme";

type Viewing = Schemas["ViewingWithListing"];
type Action = Schemas["ViewingAction"]["action"];

const STATUS_TONE: Record<Schemas["ViewingStatus"], BadgeTone> = {
  requested: "warning", confirmed: "success", declined: "danger", cancelled: "neutral", completed: "verified", no_show: "danger",
};

export function ViewingsList() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const { spacing } = useTheme();
  const qc = useQueryClient();
  const q = useViewings();
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: Action }) =>
      unwrap(await api.POST("/viewings/{viewing_id}/actions", { params: { path: { viewing_id: id } }, body: { action } })),
    onSuccess: () => setError(null),
    onError: (e) => setError(errorMessage(e, t)),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.viewings }),
  });

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) return <EmptyState icon="calendar-outline" title={t("viewing.empty")} body={t("viewing.emptyBody")} />;
  return (
    <FlatList
      data={q.data}
      keyExtractor={(v) => v.id}
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      ListHeaderComponent={error ? <Notice tone="danger">{error}</Notice> : undefined}
      renderItem={({ item: v }) => {
        const actions = v.allowed_actions ?? [];
        return (
          <Card onPress={() => router.push(`/listing/${v.listing_id}`)} accessibilityLabel={v.listing_title} testID={`viewing-${v.id}`}>
            <Row style={{ justifyContent: "space-between" }}>
              <T variant="caption" tone="muted">{v.my_role === "owner" ? t("viewing.requestedFromYou") : t("viewing.youRequested")}</T>
              <Badge label={t(`enum.viewingStatus.${v.status}`)} tone={STATUS_TONE[v.status]} />
            </Row>
            <T variant="bodyStrong" numberOfLines={1}>{v.listing_title}</T>
            <T variant="heading">{formatDate(v.proposed_at, lang, true)}</T>
            {v.note ? <T variant="caption" tone="muted">{`“${v.note}”`}</T> : null}
            {actions.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {actions.map((a) => (
                  <Button
                    key={a}
                    size="sm"
                    title={t(`viewing.${a}`)}
                    variant={a === "confirm" || a === "complete" ? "primary" : a === "cancel" || a === "decline" ? "danger" : "outline"}
                    loading={act.isPending && act.variables?.id === v.id && act.variables.action === a}
                    onPress={() => act.mutate({ id: v.id, action: a })}
                  />
                ))}
              </View>
            ) : null}
          </Card>
        );
      }}
    />
  );
}
