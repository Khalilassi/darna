import React from "react";
import { Text, type TextProps, type TextStyle } from "react-native";
import { useTheme } from "../theme";

export type Tone = "default" | "muted" | "primary" | "accent" | "danger" | "warning" | "success" | "info" | "inverse" | "onPrimary";
type Variant = "display" | "title" | "heading" | "body" | "bodyStrong" | "caption" | "label" | "price";

export interface TProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  center?: boolean;
  children?: React.ReactNode;
}

/** Themed text. Alignment follows the writing direction (no hard-coded left/right). */
export function T({ variant = "body", tone = "default", center, style, ...rest }: TProps) {
  const { colors, typography } = useTheme();
  const color = {
    default: colors.text,
    muted: colors.textMuted,
    primary: colors.primary,
    accent: colors.accent,
    danger: colors.danger,
    warning: colors.warning,
    success: colors.success,
    info: colors.info,
    inverse: colors.textInverse,
    onPrimary: colors.onPrimary,
  }[tone];
  return (
    <Text
      {...rest}
      style={[typography[variant] as TextStyle, { color }, center ? { textAlign: "center" } : null, style]}
    />
  );
}
