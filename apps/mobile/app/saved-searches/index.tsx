import React, { useState } from "react";
import { Alert, FlatList, Platform, StyleSheet, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { errorMessage } from "../../src/api/errors";
import { useDeleteSavedSearch, useProjects, useSavedSearches, useUpdateSavedSearch } from "../../src/api/queries";
import { Badge, Button, Card, EmptyState, ErrorState, Icon, LoadingState, Notice, Row, SignInRequired, T } from "../../src/components";
import { SearchNameModal } from "../../src/features/SearchNameModal";
import { formatDate } from "../../src/i18n/format";
import { useLanguage } from "../../src/i18n/LanguageProvider";
import { describeFilters } from "../../src/lib/savedSearch";
import { useTheme } from "../../src/theme";

type Saved = Schemas["SavedSearchOut"];

export default function SavedSearches() {
  return (
    <SignInRequired icon="bookmark-outline">
      <List />
    </SignInRequired>
  );
}

function confirmDelete(title: string, body: string, ok: string, cancel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(`${title}\n\n${body}`) ?? true);
  return new Promise((resolve) =>
    Alert.alert(title, body, [
      { text: cancel, style: "cancel", onPress: () => resolve(false) },
      { text: ok, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

function List() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const q = useSavedSearches();
  const projects = useProjects();
  const update = useUpdateSavedSearch();
  const remove = useDeleteSavedSearch();
  const [renaming, setRenaming] = useState<Saved | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const districtName = (id?: string | null) => {
    if (!id) return null;
    for (const p of projects.data ?? []) {
      const d = p.districts.find((x) => x.id === id);
      if (d) return lang === "ar" ? d.name_ar : d.name_en;
    }
    return null;
  };
  const onError = (e: unknown) => setError(errorMessage(e, t));

  return (
    <View style={styles.flex}>
      <FlatList
        data={q.data}
        keyExtractor={(s) => s.id}
        onRefresh={() => void q.refetch()}
        refreshing={q.isRefetching}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ gap: spacing.sm }}>
            <T tone="muted">{t("savedSearch.intro")}</T>
            {error ? <Notice tone="danger" testID="saved-search-error">{error}</Notice> : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon="bookmark-outline" title={t("savedSearch.empty")} body={t("savedSearch.emptyBody")} actionLabel={t("saved.explore")} onAction={() => router.push("/explore")} />
        }
        renderItem={({ item: s }) => {
          const summary = describeFilters(s.filters, t, lang, { districtName: districtName(s.filters.district_id) });
          return (
          <Card testID={`saved-search-${s.id}`}>
            <Row style={{ alignItems: "flex-start" }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Row wrap>
                  <T variant="heading" testID="saved-search-name">{s.name}</T>
                  {s.new_since_last_alert ? (
                    <Badge tone="primary" label={t("savedSearch.newCount", { count: s.new_since_last_alert })} testID="saved-search-new" />
                  ) : null}
                </Row>
                {summary !== s.name ? <T variant="caption" tone="muted">{summary}</T> : null}
                <T variant="caption" tone="muted">{t("savedSearch.created", { date: formatDate(s.created_at, lang) })}</T>
              </View>
            </Row>
            <View style={styles.switchRow}>
              <Icon name={s.alerts_enabled ? "notifications" : "notifications-off-outline"} size={18} color={s.alerts_enabled ? colors.primary : colors.textMuted} />
              <T style={styles.flex}>{t("savedSearch.alerts")}</T>
              <View style={Platform.OS === "web" ? styles.ltr : undefined}>
                <Switch
                  value={s.alerts_enabled}
                  onValueChange={(v) => {
                    setError(null);
                    update.mutate({ id: s.id, alerts_enabled: v }, { onError });
                  }}
                  accessibilityLabel={`${t("savedSearch.alerts")}: ${s.name}`}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: s.alerts_enabled }}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor={colors.surface}
                  {...({ activeThumbColor: colors.surface } as object)}
                  testID="saved-search-alerts"
                />
              </View>
            </View>
            <Row wrap gap={8}>
              <Button title={t("savedSearch.viewResults")} icon="search-outline" size="sm" onPress={() => router.push(`/saved-searches/${s.id}`)} testID="saved-search-open" />
              <Button title={t("savedSearch.rename")} icon="create-outline" size="sm" variant="outline" onPress={() => setRenaming(s)} />
              <Button
                title={t("common.delete")}
                icon="trash-outline"
                size="sm"
                variant="danger"
                onPress={async () => {
                  setError(null);
                  const ok = await confirmDelete(t("savedSearch.deleteTitle"), t("savedSearch.deleteBody", { name: s.name }), t("common.delete"), t("common.cancel"));
                  if (ok) remove.mutate(s.id, { onError });
                }}
                testID="saved-search-delete"
              />
            </Row>
          </Card>
          );
        }}
      />
      <SearchNameModal
        visible={!!renaming}
        title={t("savedSearch.renameTitle")}
        initialName={renaming?.name ?? ""}
        busy={update.isPending}
        onCancel={() => setRenaming(null)}
        onSubmit={(name) => {
          if (!renaming) return;
          setError(null);
          update.mutate({ id: renaming.id, name }, { onError });
          setRenaming(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  ltr: { direction: "ltr" },
});
