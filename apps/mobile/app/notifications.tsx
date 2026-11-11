import React from "react";
import { FlatList, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../src/api/client";
import { qk, useNotifications } from "../src/api/queries";
import { Button, Card, EmptyState, ErrorState, Icon, LoadingState, Row, SignInRequired, T } from "../src/components";
import { formatRelative } from "../src/i18n/format";
import { useLanguage } from "../src/i18n/LanguageProvider";
import { notificationHref } from "../src/lib/notifications";
import { useTheme } from "../src/theme";

export default function Notifications() {
  return (
    <SignInRequired>
      <List />
    </SignInRequired>
  );
}

function List() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const qc = useQueryClient();
  const { colors, spacing } = useTheme();
  const q = useNotifications();
  const readAll = useMutation({
    mutationFn: async () => unwrap(await api.POST("/notifications/read-all")),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.notifications }),
  });
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          headerRight: q.data.unread
            ? () => <Button title={t("notifications.markAll")} variant="ghost" size="sm" onPress={() => readAll.mutate()} loading={readAll.isPending} />
            : undefined,
        }}
      />
      <FlatList
        data={q.data.items}
        keyExtractor={(n) => n.id}
        onRefresh={() => void q.refetch()}
        refreshing={q.isRefetching}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, flexGrow: 1 }}
        ListEmptyComponent={<EmptyState icon="notifications-outline" title={t("notifications.empty")} body={t("notifications.emptyBody")} />}
        renderItem={({ item: n }) => {
          const href = notificationHref(n);
          return (
            <Card onPress={href ? () => router.push(href) : undefined} accessibilityLabel={t(`notifications.types.${n.type}`, { defaultValue: t("notifications.types.generic") })}>
              <Row>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: n.read_at ? "transparent" : colors.primary }} />
                <T variant={n.read_at ? "body" : "bodyStrong"} style={{ flex: 1 }}>
                  {t(`notifications.types.${n.type}`, { defaultValue: t("notifications.types.generic") })}
                </T>
                {href ? <Icon name="chevron-forward" size={16} color={colors.textMuted} /> : null}
              </Row>
              <T variant="caption" tone="muted">{formatRelative(n.created_at, lang)}</T>
            </Card>
          );
        }}
      />
    </View>
  );
}
