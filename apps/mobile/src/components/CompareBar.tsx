import React from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useCompare } from "../state/compare";
import { useTheme } from "../theme";
import { Button, IconButton } from "./Button";

/** Floating tray shown while homes are selected for comparison. */
export function CompareBar() {
  const { ids, clear } = useCompare();
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radii, shadow } = useTheme();
  if (!ids.length) return null;
  return (
    <View style={[styles.bar, shadow.card, { backgroundColor: colors.surface, borderRadius: radii.pill, borderColor: colors.border }]}>
      <IconButton icon="close" label={t("compare.clear")} onPress={clear} />
      <Button
        title={t("explore.compareBar", { count: ids.length })}
        icon="git-compare-outline"
        disabled={ids.length < 2}
        onPress={() => router.push(`/compare?ids=${ids.join(",")}`)}
        style={{ flex: 1 }}
        testID="compare-bar"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", bottom: 12, start: 16, end: 16, flexDirection: "row", alignItems: "center", gap: 8, padding: 6, borderWidth: StyleSheet.hairlineWidth },
});
