import React, { useEffect, useState } from "react";
import { FlatList, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../../src/api/client";
import { qk, useFavoriteIds, useSavedSearches, useToggleFavorite } from "../../src/api/queries";
import { EmptyState, ErrorState, ListingCard, LoadingState, SignInRequired, T } from "../../src/components";
import { useTheme } from "../../src/theme";

const PAGE_SIZE = 20;

export default function SavedSearchResults() {
  return (
    <SignInRequired icon="bookmark-outline">
      <Results />
    </SignInRequired>
  );
}

function Results() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { spacing } = useTheme();
  const saved = useSavedSearches();
  const favIds = useFavoriteIds();
  const toggleFav = useToggleFavorite();
  const search = saved.data?.find((s) => s.id === id);
  // Snapshot of the "new" count before opening marks the results as seen.
  const [newCount, setNewCount] = useState<number | null>(null);
  useEffect(() => {
    if (newCount === null && search) setNewCount(search.new_since_last_alert);
  }, [search, newCount]);

  const query = useInfiniteQuery({
    queryKey: qk.savedSearchResults(id),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET("/saved-searches/{saved_id}/results", {
          params: { path: { saved_id: id }, query: { page: pageParam, page_size: PAGE_SIZE, sort: "newest", mark_seen: true } },
        }),
      ),
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
  });

  // Opening the results marks them seen: refresh the list so the "N new" badge clears.
  useEffect(() => {
    if (query.isSuccess) void qc.invalidateQueries({ queryKey: qk.savedSearches, exact: true });
  }, [query.isSuccess, qc]);

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: search?.name ?? t("savedSearch.resultsTitle") }} />
      <FlatList
        data={items}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, flexGrow: 1 }}
        onRefresh={() => void query.refetch()}
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        ListHeaderComponent={
          query.isSuccess ? (
            <View style={{ gap: 4 }}>
              <T variant="bodyStrong" testID="saved-results-count">{t("explore.results", { count: total })}</T>
              {newCount ? <T tone="primary">{t("savedSearch.newSinceLast", { count: newCount })}</T> : null}
            </View>
          ) : undefined
        }
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            onPress={() => router.push(`/listing/${item.id}`)}
            favorite={favIds.has(item.id)}
            onToggleFavorite={() => toggleFav.mutate({ id: item.id, on: !favIds.has(item.id) })}
          />
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && void query.fetchNextPage()}
        ListEmptyComponent={
          query.isPending ? (
            <LoadingState />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <EmptyState icon="search-outline" title={t("explore.noResults")} body={t("savedSearch.noResultsBody")} />
          )
        }
        ListFooterComponent={query.isFetchingNextPage ? <LoadingState /> : undefined}
      />
    </View>
  );
}
