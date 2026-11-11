import React from "react";
import { StyleSheet, View } from "react-native";
import { barFractions } from "../lib/market";
import { useTheme } from "../theme";
import { T } from "./T";

export interface Bar {
  key: string;
  /** Axis label under the bar (e.g. a month). */
  label: string;
  /** null = no figure (drawn as a dashed placeholder, never as zero). */
  value: number | null;
  /** Text above the bar (formatted value, or e.g. "—"). */
  valueLabel: string;
  accessibilityLabel: string;
  highlight?: boolean;
}

/** Simple vertical bar chart built from Views (no chart dependency). Follows the layout direction. */
export function MiniBars({ bars, height = 120, testID }: { bars: Bar[]; height?: number; testID?: string }) {
  const { colors, radii } = useTheme();
  const fractions = barFractions(bars.map((b) => b.value));
  return (
    <View style={styles.row} testID={testID}>
      {bars.map((b, i) => {
        const f = fractions[i];
        return (
          <View key={b.key} style={styles.col} accessible accessibilityLabel={b.accessibilityLabel} testID={testID ? `${testID}-${b.key}` : undefined}>
            <T variant="caption" tone={f === null ? "muted" : "default"} numberOfLines={1} style={styles.value}>{b.valueLabel}</T>
            <View style={[styles.track, { height }]}>
              {f === null ? (
                <View style={[styles.empty, { height: height * 0.3, borderColor: colors.border, borderRadius: radii.sm }]} />
              ) : (
                <View
                  style={{
                    height: Math.max(4, Math.round(height * Math.max(0.08, f))),
                    backgroundColor: b.highlight ? colors.accent : colors.primary,
                    borderTopLeftRadius: radii.sm,
                    borderTopRightRadius: radii.sm,
                  }}
                />
              )}
            </View>
            <View style={[styles.axis, { backgroundColor: colors.border }]} />
            <T variant="caption" tone="muted" numberOfLines={1} style={styles.value}>{b.label}</T>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  col: { flex: 1, maxWidth: 96, gap: 4 },
  track: { justifyContent: "flex-end" },
  empty: { borderWidth: 1, borderStyle: "dashed" },
  axis: { height: StyleSheet.hairlineWidth },
  value: { textAlign: "center", fontSize: 11 },
});
