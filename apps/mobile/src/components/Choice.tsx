import React, { useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { Icon } from "./Icon";
import { T } from "./T";

export interface Option<V extends string | number | boolean> {
  value: V;
  label: string;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors, radii } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: radii.pill,
          backgroundColor: selected ? colors.primary : pressed ? colors.surfaceMuted : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
    >
      {selected ? <Icon name="checkmark" size={14} color={colors.onPrimary} /> : null}
      <T variant="label" style={{ color: selected ? colors.onPrimary : colors.text, fontSize: 13 }}>{label}</T>
    </Pressable>
  );
}

/** Single-select chips. Tapping the selected chip clears it when `allowClear` is set. */
export function ChipGroup<V extends string | number | boolean>({
  options, value, onChange, allowClear, scroll, label, error,
}: {
  options: Option<V>[];
  value: V | undefined | null;
  onChange: (v: V | undefined) => void;
  allowClear?: boolean;
  scroll?: boolean;
  label?: string;
  error?: string | null;
}) {
  const chips = options.map((o) => (
    <Chip
      key={String(o.value)}
      label={o.label}
      selected={o.value === value}
      onPress={() => onChange(o.value === value && allowClear ? undefined : o.value)}
    />
  ));
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {label ? <T variant="label" tone="muted">{label}</T> : null}
      {scroll ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>{chips}</ScrollView>
      ) : (
        <View style={[styles.row, styles.wrapRow]}>{chips}</View>
      )}
      {error ? <T variant="caption" tone="danger">{error}</T> : null}
    </View>
  );
}

export function MultiChipGroup<V extends string>({
  options, values, onChange, label, error,
}: { options: Option<V>[]; values: V[]; onChange: (v: V[]) => void; label?: string; error?: string | null }) {
  return (
    <View style={styles.group} accessibilityLabel={label}>
      {label ? <T variant="label" tone="muted">{label}</T> : null}
      <View style={[styles.row, styles.wrapRow]}>
        {options.map((o) => {
          const selected = values.includes(o.value);
          return (
            <Chip
              key={o.value}
              label={o.label}
              selected={selected}
              onPress={() => onChange(selected ? values.filter((x) => x !== o.value) : [...values, o.value])}
            />
          );
        })}
      </View>
      {error ? <T variant="caption" tone="danger">{error}</T> : null}
    </View>
  );
}

export function Segmented<V extends string>({
  options, value, onChange, testID,
}: { options: Option<V>[]; value: V; onChange: (v: V) => void; testID?: string }) {
  const { colors, radii } = useTheme();
  return (
    <View testID={testID} style={[styles.segment, { backgroundColor: colors.surfaceMuted, borderRadius: radii.pill }]} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.segItem, { borderRadius: radii.pill, backgroundColor: selected ? colors.surface : "transparent" }]}
          >
            <T variant="label" style={{ color: selected ? colors.text : colors.textMuted, fontSize: 14 }} numberOfLines={1}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Dropdown-like picker that opens a bottom sheet list. */
export function Select<V extends string>({
  label, value, options, onChange, placeholder, error, allowClear, clearLabel, testID, hideLabel,
}: {
  label?: string;
  /** Use `label` only for the sheet title and accessibility, not above the field. */
  hideLabel?: boolean;
  value: V | undefined | null;
  options: Option<V>[];
  onChange: (v: V | undefined) => void;
  placeholder?: string;
  error?: string | null;
  allowClear?: boolean;
  clearLabel?: string;
  testID?: string;
}) {
  const { colors, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const list: Option<V | "__clear">[] = allowClear ? [{ value: "__clear", label: clearLabel ?? "—" }, ...options] : options;
  return (
    <View style={styles.group}>
      {label && !hideLabel ? <T variant="label" tone="muted">{label}</T> : null}
      <Pressable
        testID={testID}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${current?.label ?? placeholder ?? ""}` : current?.label}
        style={[styles.select, { borderRadius: radii.md, borderColor: error ? colors.danger : colors.border, backgroundColor: colors.surface }]}
      >
        <T tone={current ? "default" : "muted"} style={{ flex: 1 }} numberOfLines={1}>{current?.label ?? placeholder}</T>
        <Icon name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>
      {error ? <T variant="caption" tone="danger">{error}</T> : null}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + 12, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl }]}>
          {label ? <T variant="heading" style={styles.sheetTitle}>{label}</T> : null}
          <FlatList
            data={list}
            keyExtractor={(o) => String(o.value)}
            renderItem={({ item }) => {
              const selected = item.value === value;
              return (
                <Pressable
                  onPress={() => {
                    onChange(item.value === "__clear" ? undefined : (item.value as V));
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [styles.option, { backgroundColor: pressed ? colors.surfaceMuted : "transparent" }]}
                >
                  <T style={{ flex: 1 }} variant={selected ? "bodyStrong" : "body"}>{item.label}</T>
                  {selected ? <Icon name="checkmark" color={colors.primary} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

export function Checkbox({ checked, onChange, label, help, error, testID }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string; error?: string | null; testID?: string }) {
  const { colors, radii } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        testID={testID}
        onPress={() => onChange(!checked)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        style={styles.checkRow}
      >
        <View style={[styles.box, { borderRadius: radii.sm, borderColor: error ? colors.danger : checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : colors.surface }]}>
          {checked ? <Icon name="checkmark" size={16} color={colors.onPrimary} /> : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="bodyStrong">{label}</T>
          {help ? <T variant="caption" tone="muted">{help}</T> : null}
        </View>
      </Pressable>
      {error ? <T variant="caption" tone="danger">{error}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  wrapRow: { flexWrap: "wrap" },
  chip: { minHeight: 40, paddingHorizontal: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 4, justifyContent: "center" },
  segment: { flexDirection: "row", padding: 4, gap: 4 },
  segItem: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  select: { minHeight: 50, borderWidth: 1, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { maxHeight: "70%", paddingTop: 16 },
  sheetTitle: { paddingHorizontal: 20, paddingBottom: 8 },
  option: { minHeight: 52, paddingHorizontal: 20, flexDirection: "row", alignItems: "center" },
  checkRow: { flexDirection: "row", gap: 12, alignItems: "flex-start", minHeight: 44 },
  box: { width: 26, height: 26, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginTop: 1 },
});
