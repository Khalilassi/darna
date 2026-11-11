import React from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLanguage } from "../i18n/LanguageProvider";
import { mirrorTransform } from "../i18n/direction";
import { useTheme } from "../theme";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];

const DIRECTIONAL = /(chevron-(back|forward)|arrow-(back|forward)|caret-(back|forward)|send|log-out|exit)/;

/** Ionicon that mirrors direction-implying glyphs (chevrons, arrows, send) in RTL. */
export function Icon({ name, size = 20, color, mirror }: { name: IconName; size?: number; color?: string; mirror?: boolean }) {
  const { isRTL } = useLanguage();
  const { colors } = useTheme();
  const shouldMirror = mirror ?? DIRECTIONAL.test(String(name));
  return (
    <Ionicons
      name={name}
      size={size}
      color={color ?? colors.text}
      style={shouldMirror ? { transform: mirrorTransform(isRTL) } : undefined}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
