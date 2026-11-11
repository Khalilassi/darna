import React from "react";
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { T } from "./T";

export function Screen({
  children, scroll = true, padded = true, edges = ["bottom"], refreshing, onRefresh, footer, contentStyle, testID,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: Edge[];
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors, spacing } = useTheme();
  const pad = padded ? { padding: spacing.lg, gap: spacing.lg } : null;
  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: colors.background }]} testID={testID}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[pad, styles.grow, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, pad, contentStyle]}>{children}</View>
      )}
      {footer ? (
        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>{footer}</View>
      ) : null}
    </SafeAreaView>
  );
}

export function Section({ title, action, children, style }: { title?: string; action?: React.ReactNode; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.section, style]}>
      {title || action ? (
        <View style={styles.sectionHead}>
          {title ? <T variant="heading" accessibilityRole="header" style={styles.flex}>{title}</T> : <View />}
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function KeyValue({ label, value, help, strong, tone }: { label: string; value: React.ReactNode; help?: string; strong?: boolean; tone?: "muted" | "default" }) {
  return (
    <View style={styles.kv}>
      <View style={styles.flex}>
        <T tone={tone === "muted" ? "muted" : "default"} variant={strong ? "bodyStrong" : "body"}>{label}</T>
        {help ? <T variant="caption" tone="muted">{help}</T> : null}
      </View>
      {typeof value === "string" ? <T variant={strong ? "bodyStrong" : "body"} style={styles.kvValue}>{value}</T> : value}
    </View>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

export function Row({ children, gap = 8, wrap, style }: { children: React.ReactNode; gap?: number; wrap?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap, flexWrap: wrap ? "wrap" : "nowrap" }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  footer: { padding: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  section: { gap: 12 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  kv: { flexDirection: "row", alignItems: "flex-start", gap: 12, minHeight: 28 },
  kvValue: { flexShrink: 1, maxWidth: "60%" },
});
