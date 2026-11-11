import React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../theme";
import { Icon, type IconName } from "./Icon";
import { T } from "./T";

export type BadgeTone = "neutral" | "verified" | "featured" | "warning" | "danger" | "info" | "success" | "primary" | "dark";

export function Badge({ label, tone = "neutral", icon, testID }: { label: string; tone?: BadgeTone; icon?: IconName; testID?: string }) {
  const { colors, radii } = useTheme();
  const map: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: colors.surfaceMuted, fg: colors.textMuted },
    verified: { bg: colors.primaryMuted, fg: colors.verified },
    featured: { bg: colors.accentMuted, fg: colors.accent },
    warning: { bg: colors.warningMuted, fg: colors.warning },
    danger: { bg: colors.dangerMuted, fg: colors.danger },
    info: { bg: colors.infoMuted, fg: colors.info },
    success: { bg: colors.successMuted, fg: colors.success },
    primary: { bg: colors.primary, fg: colors.onPrimary },
    dark: { bg: "rgba(20,18,15,0.72)", fg: "#FFFFFF" },
  };
  const c = map[tone];
  return (
    <View testID={testID} style={[styles.badge, { backgroundColor: c.bg, borderRadius: radii.pill }]} accessible accessibilityLabel={label}>
      {icon ? <Icon name={icon} size={13} color={c.fg} /> : null}
      <T variant="label" style={{ color: c.fg, fontSize: 12 }} numberOfLines={1}>{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
});
