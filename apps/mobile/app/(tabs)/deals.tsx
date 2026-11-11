import React from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useDeals } from "../../src/api/queries";
import { Badge, Card, EmptyState, ErrorState, LoadingState, Row, SignInRequired, T } from "../../src/components";
import { formatMoney, formatRelative } from "../../src/i18n/format";
import { useLanguage } from "../../src/i18n/LanguageProvider";
import { roleLabel } from "../../src/lib/deal";
import { useTheme } from "../../src/theme";

export default function Deals() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <SafeAreaView edges={["top"]} style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.head}>
        <T variant="title" accessibilityRole="header">{t("deals.title")}</T>
      </View>
      <SignInRequired icon="briefcase-outline">
        <DealList />
      </SignInRequired>
    </SafeAreaView>
  );
}

function DealList() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const { spacing } = useTheme();
  const q = useDeals();
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) return <EmptyState icon="briefcase-outline" title={t("deals.empty")} body={t("deals.emptyBody")} />;
  return (
    <FlatList
      data={q.data}
      keyExtractor={(d) => d.id}
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      renderItem={({ item: d }) => {
        const awaitingMe = d.latest_offer?.status === "pending" && d.latest_offer.made_by !== d.my_role;
        return (
          <Card onPress={() => router.push(`/deal/${d.id}`)} accessibilityLabel={d.listing_title} testID={`deal-${d.id}`}>
            <Row style={{ justifyContent: "space-between" }}>
              <Badge label={t(`enum.dealKind.${d.kind}`)} tone="neutral" />
              <Badge label={t(`enum.dealStatus.${d.status}`)} tone={d.status === "cancelled" ? "danger" : d.status === "negotiating" ? "warning" : "success"} />
            </Row>
            <T variant="bodyStrong" numberOfLines={1}>{d.listing_title}</T>
            <T variant="caption" tone="muted">
              {`${t("deals.asRole", { role: roleLabel(d.my_role, d.kind, t) })} · ${t("deals.with", { name: d.counterpart_name })} · ${formatRelative(d.updated_at, lang)}`}
            </T>
            {d.latest_offer ? (
              <Row style={{ justifyContent: "space-between" }}>
                <T>{t("deals.latestOffer", { amount: formatMoney(d.latest_offer.amount, lang) })}</T>
                <Badge label={t(`enum.offerStatus.${d.latest_offer.status}`)} tone={awaitingMe ? "primary" : "neutral"} />
              </Row>
            ) : null}
          </Card>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { paddingHorizontal: 16, paddingTop: 8 },
});
