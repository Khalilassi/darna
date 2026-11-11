import React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../theme";
import { Icon, type IconName } from "./Icon";
import { T } from "./T";

export function Notice({
  tone = "info", title, children, icon, testID,
}: { tone?: "info" | "warning" | "danger" | "success" | "neutral"; title?: string; children?: React.ReactNode; icon?: IconName; testID?: string }) {
  const { colors, radii } = useTheme();
  const c = {
    info: { bg: colors.infoMuted, fg: colors.info, icon: "information-circle" as IconName },
    warning: { bg: colors.warningMuted, fg: colors.warning, icon: "alert-circle" as IconName },
    danger: { bg: colors.dangerMuted, fg: colors.danger, icon: "warning" as IconName },
    success: { bg: colors.successMuted, fg: colors.success, icon: "checkmark-circle" as IconName },
    neutral: { bg: colors.surfaceMuted, fg: colors.textMuted, icon: "shield-checkmark" as IconName },
  }[tone];
  return (
    <View testID={testID} style={[styles.box, { backgroundColor: c.bg, borderRadius: radii.md }]} accessibilityRole="alert">
      <Icon name={icon ?? c.icon} size={20} color={c.fg} />
      <View style={styles.text}>
        {title ? <T variant="bodyStrong" style={{ color: c.fg }}>{title}</T> : null}
        {typeof children === "string" ? <T variant="caption" tone="default">{children}</T> : children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", gap: 10, padding: 12, alignItems: "flex-start" },
  text: { flex: 1, gap: 2 },
});
