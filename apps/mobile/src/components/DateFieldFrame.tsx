import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../i18n/LanguageProvider";
import { displayDate, rangeViolation } from "../lib/date";
import { useTheme } from "../theme";
import { IconButton } from "./Button";
import { Icon } from "./Icon";
import { T } from "./T";

export interface DateFieldProps {
  label: string;
  /** ISO `YYYY-MM-DD`, or "" when empty. */
  value: string;
  onChange: (iso: string) => void;
  /** Inclusive ISO bounds; the picker cannot go past them and out-of-range values show a message. */
  min?: string;
  max?: string;
  /** Marks the field optional and shows a clear button when it has a value. */
  optional?: boolean;
  error?: string | null;
  hint?: string;
  placeholder?: string;
  testID?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

/** Shared presentation state for the native and web DateField. */
export function useDateFieldModel({ label, value, min, max, error, placeholder }: DateFieldProps) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const display = displayDate(value, lang);
  const range = rangeViolation(value.trim(), { min, max });
  const rangeError =
    range === "min" ? t("validation.minDate", { date: displayDate(min, lang) }) : range === "max" ? t("validation.maxDate", { date: displayDate(max, lang) }) : undefined;
  const shownPlaceholder = placeholder ?? t("dateField.placeholder");
  return {
    lang,
    display,
    shownPlaceholder,
    shownError: error || rangeError || undefined,
    a11yLabel: `${label}: ${display || shownPlaceholder}`,
    a11yHint: t("dateField.a11yHint"),
    clearLabel: t("dateField.clear", { label }),
  };
}

/** Label, bordered box (children = the touch target), clear button and error/hint. */
export function DateFieldFrame({
  props, model, focused, children,
}: {
  props: DateFieldProps;
  model: ReturnType<typeof useDateFieldModel>;
  focused?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { colors, radii } = useTheme();
  const { label, value, optional, hint, onChange, testID, containerStyle } = props;
  return (
    <View style={[styles.wrap, containerStyle]}>
      <View style={styles.labelRow}>
        <T variant="label" tone="muted">{label}</T>
        {optional ? <T variant="caption" tone="muted">{t("common.optional")}</T> : null}
      </View>
      <View
        style={[
          styles.box,
          { borderRadius: radii.md, backgroundColor: colors.surface, borderColor: model.shownError ? colors.danger : focused ? colors.primary : colors.border },
        ]}
      >
        {children}
        {optional && value ? (
          <IconButton icon="close-circle" size={20} color={colors.textMuted} label={model.clearLabel} onPress={() => onChange("")} testID={testID ? `${testID}-clear` : undefined} />
        ) : null}
      </View>
      {model.shownError ? (
        <T variant="caption" tone="danger" accessibilityLiveRegion="polite">{model.shownError}</T>
      ) : hint ? (
        <T variant="caption" tone="muted">{hint}</T>
      ) : null}
    </View>
  );
}

/** The visible content of the touch target: formatted date (or placeholder) and a calendar icon. */
export function DateFieldValue({ model }: { model: ReturnType<typeof useDateFieldModel> }) {
  const { colors } = useTheme();
  return (
    <View style={styles.value} pointerEvents="none">
      <Icon name="calendar-outline" size={18} color={colors.textMuted} />
      <T tone={model.display ? "default" : "muted"} style={styles.flex} numberOfLines={1}>{model.display || model.shownPlaceholder}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  labelRow: { flexDirection: "row", justifyContent: "space-between" },
  box: { borderWidth: 1, flexDirection: "row", alignItems: "center", minHeight: 50, paddingEnd: 4 },
  value: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 48 },
  flex: { flex: 1 },
});
