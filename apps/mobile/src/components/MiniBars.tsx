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

/**
 * Simple vertical bar chart built from Views (no chart dependency). Follows the layout direction.
 * Options for dense series: `gap` between bars, `showValues=false` hides the text above bars, and
 * `flatZero` draws a 0 as a flat baseline instead of the minimum visible bar. Empty labels are omitted.
 */
export function MiniBars({
  bars, height = 120, testID, gap = 8, showValues = true, flatZero = false,
}: { bars: Bar[]; height?: number; testID?: string; gap?: number; showValues?: boolean; flatZero?: boolean }) {
  const { colors, radii } = useTheme();
  const fractions = barFractions(bars.map((b) => b.value));
  return (
    <View style={[styles.row, { gap }]} testID={testID}>
      {bars.map((b, i) => {
        const f = fractions[i];
        return (
          <View key={b.key} style={styles.col} accessible accessibilityLabel={b.accessibilityLabel} testID={testID ? `${testID}-${b.key}` : undefined}>
            {showValues ? <T variant="caption" tone={f === null ? "muted" : "default"} numberOfLines={1} style={styles.value}>{b.valueLabel}</T> : null}
            <View style={[styles.track, { height }]}>
              {f === null ? (
                <View style={[styles.empty, { height: height * 0.3, borderColor: colors.border, borderRadius: radii.sm }]} />
              ) : flatZero && b.value === 0 ? (
                <View style={{ height: 2, backgroundColor: colors.border }} />
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
            {b.label ? <T variant="caption" tone="muted" numberOfLines={1} style={styles.value}>{b.label}</T> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end" },
  col: { flex: 1, maxWidth: 96, gap: 4 },
  track: { justifyContent: "flex-end" },
  empty: { borderWidth: 1, borderStyle: "dashed" },
  axis: { height: StyleSheet.hairlineWidth },
  value: { textAlign: "center", fontSize: 11 },
});
