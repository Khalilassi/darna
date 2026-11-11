import React, { useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../../src/api/client";
import { errorMessage } from "../../src/api/errors";
import { useCreateSavedSearch, useFavoriteIds, useNotifications, useProjects, useToggleFavorite } from "../../src/api/queries";
import { useAuth } from "../../src/auth/AuthProvider";
import {
  Button, CompareBar, EmptyState, ErrorState, IconButton, ListingCard, LoadingState, Notice, Segmented, Select, T, TextField,
} from "../../src/components";
import { SearchNameModal } from "../../src/features/SearchNameModal";
import { describeFilters, toSearchFilters } from "../../src/lib/savedSearch";
import { useLanguage } from "../../src/i18n/LanguageProvider";
import { countActiveFilters, emptyFilters, SORT_KEYS, toListingQuery, useFilters, type SortKey } from "../../src/state/filters";
import { useTheme } from "../../src/theme";

const PAGE_SIZE = 10;

export default function Explore() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const { status } = useAuth();
  const { filters, setFilters } = useFilters();
  const projects = useProjects();
  const favIds = useFavoriteIds();
  const toggleFav = useToggleFavorite();
  const notifications = useNotifications();
  const [q, setQ] = useState(filters.q ?? "");
  const createSaved = useCreateSavedSearch();
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);

  // Default to the first active project.
  useEffect(() => {
    if (!filters.project_id && projects.data?.length) setFilters((f) => ({ ...f, project_id: projects.data[0].id }));
  }, [projects.data, filters.project_id, setFilters]);

  // Debounce free-text search.
  useEffect(() => {
    const h = setTimeout(() => setFilters((f) => (f.q === (q.trim() || undefined) ? f : { ...f, q: q.trim() || undefined })), 400);
    return () => clearTimeout(h);
  }, [q, setFilters]);

  const query = useInfiniteQuery({
    queryKey: ["public", "listings", filters],
    enabled: !!filters.project_id || projects.isError,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(await api.GET("/listings", { params: { query: toListingQuery(filters, pageParam, PAGE_SIZE) as never } })),
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
  });

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;
  const activeCount = countActiveFilters(filters);
  const project = projects.data?.find((p) => p.id === filters.project_id);

  const district = project?.districts.find((d) => d.id === filters.district_id);
  const defaultSearchName = describeFilters(filters, t, lang, { districtName: district ? (lang === "ar" ? district.name_ar : district.name_en) : null });
  const openSave = () => {
    if (status !== "signedIn") return router.push("/login");
    createSaved.reset();
    setSavedName(null);
    setSaving(true);
  };

  const onFavorite = (id: string) => {
    if (status !== "signedIn") return router.push("/login");
    toggleFav.mutate({ id, on: !favIds.has(id) });
  };

  const header = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <T tone="muted">{t("explore.greeting")}</T>
          {projects.data && projects.data.length > 1 ? (
            <Select
              value={filters.project_id}
              onChange={(v) => v && setFilters(emptyFilters({ project_id: v, purpose: filters.purpose }))}
              options={projects.data.map((p) => ({ value: p.id, label: lang === "ar" ? p.name_ar : p.name_en }))}
              label={t("explore.chooseProject")}
              hideLabel
            />
          ) : (
            <T variant="display" testID="project-name">{project ? (lang === "ar" ? project.name_ar : project.name_en) : "…"}</T>
          )}
          {project ? <T variant="caption" tone="muted">{lang === "ar" ? project.city_ar : project.city_en}</T> : null}
        </View>
        {status === "signedIn" ? (
          <View>
            <IconButton icon="notifications-outline" label={t("notifications.title")} onPress={() => router.push("/notifications")} background={colors.surface} />
            {notifications.data?.unread ? (
              <View style={[styles.dot, { backgroundColor: colors.danger }]} accessibilityLabel={`${notifications.data.unread}`} />
            ) : null}
          </View>
        ) : (
          <Button title={t("common.signIn")} size="sm" variant="outline" onPress={() => router.push("/login")} />
        )}
      </View>
      <TextField
        value={q}
        onChangeText={setQ}
        placeholder={t("explore.searchPlaceholder")}
        returnKeyType="search"
        accessibilityLabel={t("explore.searchPlaceholder")}
        testID="search-input"
      />
      <Segmented
        value={filters.purpose ?? "all"}
        onChange={(v) => setFilters((f) => ({ ...f, purpose: v === "all" ? undefined : v, price_min: undefined, price_max: undefined }))}
        options={[
          { value: "all", label: t("explore.all") },
          { value: "sale", label: t("explore.buy") },
          { value: "rent", label: t("explore.rent") },
        ]}
        testID="purpose-segment"
      />
      <View style={styles.toolRow}>
        <Button title={t("market.open")} icon="stats-chart-outline" variant="outline" size="sm" onPress={() => router.push(filters.purpose ? `/market?purpose=${filters.purpose}` : "/market")} style={{ flex: 1 }} testID="open-market" />
        <Button title={t("savedSearch.save")} icon="bookmark-outline" variant="outline" size="sm" onPress={openSave} style={{ flex: 1 }} testID="save-search" />
      </View>
      {savedName ? (
        <Notice tone="success" testID="search-saved">
          <T variant="caption">{t("savedSearch.savedAs", { name: savedName })}</T>
          <Button title={t("savedSearch.viewAll")} variant="ghost" size="sm" onPress={() => router.push("/saved-searches")} style={{ alignSelf: "flex-start" }} testID="view-saved-searches" />
        </Notice>
      ) : null}
      <View style={styles.toolRow}>
        <Button
          title={activeCount ? t("explore.filtersCount", { count: activeCount }) : t("explore.filters")}
          icon="options-outline"
          variant={activeCount ? "secondary" : "outline"}
          size="sm"
          onPress={() => router.push("/filters")}
          testID="open-filters"
        />
        <View style={{ flex: 1 }}>
          <Select<SortKey>
            value={filters.sort}
            onChange={(v) => v && setFilters((f) => ({ ...f, sort: v }))}
            options={SORT_KEYS.map((k) => ({ value: k, label: t(`sort.${k}`) }))}
            label={t("explore.sortBy")}
            hideLabel
            testID="sort-select"
          />
        </View>
      </View>
      {query.isSuccess ? (
        <View style={styles.toolRow}>
          <T variant="bodyStrong" testID="results-count">{t("explore.results", { count: total })}</T>
          {activeCount ? (
            <Button
              title={t("explore.clearFilters")}
              variant="ghost"
              size="sm"
              onPress={() => setFilters(emptyFilters({ project_id: filters.project_id, purpose: filters.purpose, sort: filters.sort, q: filters.q }))}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} style={[styles.flex, { backgroundColor: colors.background }]}>
      <FlatList
        data={items}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 96 }}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            onPress={() => router.push(`/listing/${item.id}`)}
            favorite={favIds.has(item.id)}
            onToggleFavorite={() => onFavorite(item.id)}
          />
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && void query.fetchNextPage()}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}
        ListEmptyComponent={
          query.isPending || projects.isPending ? (
            <LoadingState />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : projects.isError ? (
            <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
          ) : (
            <EmptyState
              icon="search-outline"
              title={t("explore.noResults")}
              body={t("explore.noResultsBody")}
              actionLabel={activeCount || filters.q ? t("explore.clearFilters") : undefined}
              onAction={() => {
                setQ("");
                setFilters(emptyFilters({ project_id: filters.project_id, purpose: filters.purpose }));
              }}
            />
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? <LoadingState /> : query.isError && items.length ? <ErrorState error={query.error} onRetry={() => void query.fetchNextPage()} /> : undefined
        }
      />
      <CompareBar />
      <SearchNameModal
        visible={saving}
        title={t("savedSearch.saveTitle")}
        initialName={defaultSearchName}
        withAlerts
        busy={createSaved.isPending}
        error={createSaved.isError ? errorMessage(createSaved.error, t) : null}
        onCancel={() => setSaving(false)}
        onSubmit={(name, alerts) =>
          createSaved.mutate(
            { name, filters: toSearchFilters(filters), alerts_enabled: alerts },
            {
              onSuccess: (s) => {
                setSaving(false);
                setSavedName(s.name);
              },
            },
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  toolRow: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "space-between" },
  dot: { position: "absolute", top: 8, end: 8, width: 10, height: 10, borderRadius: 5 },
});
