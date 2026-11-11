import React, { useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useFavorites, useToggleFavorite } from "../../src/api/queries";
import { Button, EmptyState, ErrorState, ListingCard, LoadingState, SignInRequired, T } from "../../src/components";
import { MAX_COMPARE, useCompare } from "../../src/state/compare";
import { useTheme } from "../../src/theme";

export default function Saved() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <SafeAreaView edges={["top"]} style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.head}>
        <T variant="title" accessibilityRole="header">{t("saved.title")}</T>
      </View>
      <SignInRequired icon="heart-outline">
        <SavedList />
      </SignInRequired>
    </SafeAreaView>
  );
}

function SavedList() {
  const { t } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const q = useFavorites();
  const toggle = useToggleFavorite();
  const compare = useCompare();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length)
    return <EmptyState icon="heart-outline" title={t("saved.empty")} body={t("saved.emptyBody")} actionLabel={t("saved.explore")} onAction={() => router.push("/explore")} />;

  const pick = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_COMPARE ? s : [...s, id]));

  return (
    <View style={styles.flex}>
      <FlatList
        data={q.data}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 110 }}
        onRefresh={() => void q.refetch()}
        refreshing={q.isRefetching}
        ListHeaderComponent={
          q.data.length > 1 ? (
            <Button
              title={selecting ? t("common.cancel") : t("saved.selectToCompare")}
              variant={selecting ? "outline" : "secondary"}
              icon="git-compare-outline"
              size="sm"
              onPress={() => {
                setSelecting(!selecting);
                setSelected([]);
              }}
              style={{ alignSelf: "flex-start" }}
            />
          ) : undefined
        }
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            compact
            selected={selecting && selected.includes(item.id)}
            favorite
            onToggleFavorite={selecting ? undefined : () => toggle.mutate({ id: item.id, on: false })}
            onPress={() => (selecting ? pick(item.id) : router.push(`/listing/${item.id}`))}
          />
        )}
      />
      {selecting ? (
        <View style={styles.footer}>
          <Button
            title={t("saved.compareSelected", { count: selected.length })}
            disabled={selected.length < 2}
            fullWidth
            onPress={() => {
              compare.set(selected);
              router.push(`/compare?ids=${selected.join(",")}`);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { paddingHorizontal: 16, paddingTop: 8 },
  footer: { position: "absolute", bottom: 12, start: 16, end: 16 },
});
