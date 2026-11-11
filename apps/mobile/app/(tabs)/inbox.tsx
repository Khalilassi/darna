import React, { useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useConversations } from "../../src/api/queries";
import { Badge, Card, EmptyState, ErrorState, LoadingState, Row, Segmented, SignInRequired, T } from "../../src/components";
import { ViewingsList } from "../../src/features/ViewingsList";
import { formatRelative } from "../../src/i18n/format";
import { useLanguage } from "../../src/i18n/LanguageProvider";
import { useTheme } from "../../src/theme";

export default function Inbox() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [tab, setTab] = useState<"messages" | "viewings">("messages");
  return (
    <SafeAreaView edges={["top"]} style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.head}>
        <T variant="title" accessibilityRole="header">{t("inbox.title")}</T>
        <Segmented value={tab} onChange={setTab} options={[{ value: "messages", label: t("inbox.messages") }, { value: "viewings", label: t("inbox.viewings") }]} />
      </View>
      <SignInRequired icon="chatbubbles-outline">{tab === "messages" ? <Conversations /> : <ViewingsList />}</SignInRequired>
    </SafeAreaView>
  );
}

function Conversations() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const q = useConversations();
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) return <EmptyState icon="chatbubbles-outline" title={t("inbox.empty")} body={t("inbox.emptyBody")} actionLabel={t("saved.explore")} onAction={() => router.push("/explore")} />;
  return (
    <FlatList
      data={q.data}
      keyExtractor={(c) => c.id}
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      renderItem={({ item: c }) => (
        <Card onPress={() => router.push(`/conversation/${c.id}`)} accessibilityLabel={`${c.counterpart_name}, ${c.listing_title}`} testID={`conversation-${c.id}`}>
          <Row>
            <View style={[styles.avatar, { backgroundColor: colors.primaryMuted }]}>
              <T variant="heading" tone="primary">{c.counterpart_name.slice(0, 1).toUpperCase()}</T>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <T variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{c.counterpart_name}</T>
                <T variant="caption" tone="muted">{formatRelative(c.last_message_at, lang)}</T>
              </Row>
              <T variant="caption" tone="muted" numberOfLines={1}>{`${t(`enum.role.${c.my_role === "owner" ? "owner" : "buyer"}`)} · ${c.listing_title}`}</T>
              <Row style={{ justifyContent: "space-between" }}>
                <T numberOfLines={1} style={{ flex: 1 }} tone={c.unread ? "default" : "muted"} variant={c.unread ? "bodyStrong" : "body"}>
                  {c.last_message?.body ?? t("inbox.noMessagesYet")}
                </T>
                {c.unread ? <Badge tone="primary" label={t("inbox.unread", { count: c.unread })} /> : null}
              </Row>
            </View>
          </Row>
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
});
