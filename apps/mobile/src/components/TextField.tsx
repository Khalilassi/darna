import React, { useState } from "react";
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { useTheme } from "../theme";
import { T } from "./T";

export interface TextFieldProps extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string | null;
  hint?: string;
  suffix?: string;
  optional?: boolean;
  optionalLabel?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

export function TextField({ label, error, hint, suffix, optional, optionalLabel, multiline, containerStyle, ...rest }: TextFieldProps) {
  const { colors, radii } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <View style={styles.labelRow}>
          <T variant="label" tone="muted">{label}</T>
          {optional ? <T variant="caption" tone="muted">{optionalLabel}</T> : null}
        </View>
      ) : null}
      <View
        style={[
          styles.box,
          {
            borderRadius: radii.md,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : focused ? colors.primary : colors.border,
            minHeight: multiline ? 104 : 50,
          },
        ]}
      >
        <TextInput
          {...rest}
          multiline={multiline}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          placeholderTextColor={colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[styles.input, { color: colors.text, textAlignVertical: multiline ? "top" : "center" }]}
        />
        {suffix ? <T variant="caption" tone="muted" style={styles.suffix}>{suffix}</T> : null}
      </View>
      {error ? (
        <T variant="caption" tone="danger" accessibilityLiveRegion="polite">{error}</T>
      ) : hint ? (
        <T variant="caption" tone="muted">{hint}</T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  labelRow: { flexDirection: "row", justifyContent: "space-between" },
  box: { borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 16, paddingVertical: 12, minHeight: 44 },
  suffix: { marginStart: 8 },
});
