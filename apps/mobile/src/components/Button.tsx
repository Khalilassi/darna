import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../theme";
import { Icon, type IconName } from "./Icon";
import { T } from "./T";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

export function Button({
  title, onPress, variant = "primary", size = "md", icon, loading, disabled, fullWidth, style, accessibilityLabel, accessibilityHint, testID,
}: ButtonProps) {
  const { colors, radii } = useTheme();
  const palette = {
    primary: { bg: colors.primary, pressed: colors.primaryPressed, fg: colors.onPrimary, border: colors.primary },
    secondary: { bg: colors.primaryMuted, pressed: colors.border, fg: colors.primary, border: colors.primaryMuted },
    outline: { bg: "transparent", pressed: colors.surfaceMuted, fg: colors.text, border: colors.border },
    ghost: { bg: "transparent", pressed: colors.surfaceMuted, fg: colors.primary, border: "transparent" },
    danger: { bg: colors.dangerMuted, pressed: colors.border, fg: colors.danger, border: colors.dangerMuted },
  }[variant];
  const height = { sm: 40, md: 48, lg: 56 }[size];
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      onPress={inactive ? undefined : onPress}
      // `disabled` + aria-* make the state reach screen readers on web too (accessibilityState alone does not).
      disabled={!!inactive}
      aria-disabled={!!inactive}
      aria-busy={!!loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      hitSlop={size === "sm" ? 4 : 0}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: Math.max(44, height),
          borderRadius: radii.pill,
          backgroundColor: pressed && !inactive ? palette.pressed : palette.bg,
          borderColor: palette.border,
          paddingHorizontal: size === "sm" ? 14 : 20,
          opacity: disabled ? 0.45 : 1,
        },
        fullWidth && styles.full,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={palette.fg} size="small" />
        ) : icon ? (
          <Icon name={icon} size={size === "sm" ? 16 : 18} color={palette.fg} />
        ) : null}
        <T variant={size === "sm" ? "label" : "bodyStrong"} style={{ color: palette.fg, fontSize: size === "sm" ? 13 : 15 }} numberOfLines={1}>
          {title}
        </T>
      </View>
    </Pressable>
  );
}

export function IconButton({
  icon, label, onPress, color, size = 22, background, disabled, testID,
}: { icon: IconName; label: string; onPress?: () => void; color?: string; size?: number; background?: string; disabled?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={!!disabled}
      aria-disabled={!!disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconBtn,
        { backgroundColor: background ?? "transparent", opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Icon name={icon} size={size} color={color ?? colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  full: { alignSelf: "stretch" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
