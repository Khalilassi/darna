import React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../theme";
import { Icon } from "./Icon";
import { T } from "./T";

/** Vertical progress stepper. `current` index is highlighted; earlier steps are done. */
export function Stepper({ steps, current, cancelled }: { steps: string[]; current: number; cancelled?: boolean }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="list">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current && !cancelled;
        const dotColor = done ? colors.primary : active ? colors.accent : colors.border;
        return (
          <View key={label} style={styles.row} accessibilityLabel={label} accessibilityState={{ selected: active }}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: done || active ? dotColor : colors.surface, borderColor: dotColor }]}>
                {done ? <Icon name="checkmark" size={12} color={colors.onPrimary} /> : null}
              </View>
              {i < steps.length - 1 ? <View style={[styles.line, { backgroundColor: done ? colors.primary : colors.border }]} /> : null}
            </View>
            <T variant={active ? "bodyStrong" : "body"} tone={done || active ? "default" : "muted"} style={styles.label}>{label}</T>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, minHeight: 36 },
  rail: { alignItems: "center", width: 22 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  line: { width: 2, flex: 1, minHeight: 14 },
  label: { flex: 1, paddingTop: 1, paddingBottom: 12 },
});
