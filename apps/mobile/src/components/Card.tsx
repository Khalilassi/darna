import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../theme";

export function Card({
  children, onPress, style, padded = true, accessibilityLabel, testID,
}: { children: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; padded?: boolean; accessibilityLabel?: string; testID?: string }) {
  const { colors, radii, shadow } = useTheme();
  const base = [
    styles.card,
    shadow.card,
    { backgroundColor: colors.surface, borderRadius: radii.lg, borderColor: colors.border },
    padded && styles.padded,
    style,
  ];
  if (!onPress) return <View style={base} testID={testID}>{children}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [...base, pressed && { opacity: 0.92, transform: [{ scale: 0.995 }] }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  padded: { padding: 16, gap: 10 },
});
