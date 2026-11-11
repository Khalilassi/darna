import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { intlLocale } from "../i18n/format";
import { useLanguage } from "../i18n/LanguageProvider";
import { useTheme } from "../theme";
import { T } from "./T";

const DAY = 86_400_000;

/** Candidate slots between `minAheadMs` and `maxAheadMs`, every 30 minutes from 09:00 to 21:00 local time. */
export function buildSlots(now: Date, minAheadMs = 2 * 3_600_000, maxAheadMs = 60 * DAY): Date[][] {
  const days: Date[][] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  for (let d = 0; d <= 60; d++) {
    const day = new Date(start.getTime() + d * DAY);
    const slots: Date[] = [];
    for (let m = 9 * 60; m <= 21 * 60; m += 30) {
      const s = new Date(day);
      s.setHours(Math.floor(m / 60), m % 60, 0, 0);
      const ahead = s.getTime() - now.getTime();
      if (ahead >= minAheadMs && ahead <= maxAheadMs) slots.push(s);
    }
    if (slots.length) days.push(slots);
  }
  return days;
}

/** Date chips + time grid. Value is a Date in local time; send `toISOString()` (timezone-aware UTC). */
export function DateTimeSlots({ value, onChange, now }: { value: Date | null; onChange: (d: Date) => void; now?: Date }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const { colors, radii } = useTheme();
  const days = useMemo(() => buildSlots(now ?? new Date()), [now]);
  const selectedDayIdx = Math.max(0, value ? days.findIndex((d) => d[0].toDateString() === value.toDateString()) : 0);
  const loc = intlLocale(lang);
  const today = new Date().toDateString();
  const tomorrow = new Date(Date.now() + DAY).toDateString();
  const dayLabel = (d: Date) =>
    d.toDateString() === today ? t("datetime.today") : d.toDateString() === tomorrow ? t("datetime.tomorrow") : new Intl.DateTimeFormat(loc, { weekday: "short" }).format(d);
  return (
    <View style={{ gap: 12 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {days.map((slots, i) => {
          const d = slots[0];
          const selected = i === selectedDayIdx;
          return (
            <Pressable
              key={d.toDateString()}
              onPress={() => onChange(slots[0])}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={new Intl.DateTimeFormat(loc, { dateStyle: "full" }).format(d)}
              style={[styles.day, { borderRadius: radii.md, backgroundColor: selected ? colors.primary : colors.surface, borderColor: selected ? colors.primary : colors.border }]}
            >
              <T variant="caption" style={{ color: selected ? colors.onPrimary : colors.textMuted }}>{dayLabel(d)}</T>
              <T variant="heading" style={{ color: selected ? colors.onPrimary : colors.text }}>{new Intl.DateTimeFormat(loc, { day: "numeric" }).format(d)}</T>
              <T variant="caption" style={{ color: selected ? colors.onPrimary : colors.textMuted }}>{new Intl.DateTimeFormat(loc, { month: "short" }).format(d)}</T>
            </Pressable>
          );
        })}
      </ScrollView>
      <T variant="label" tone="muted">{t("viewing.pickTime")}</T>
      <View style={styles.grid}>
        {(days[selectedDayIdx] ?? []).map((s) => {
          const selected = value?.getTime() === s.getTime();
          return (
            <Pressable
              key={s.getTime()}
              onPress={() => onChange(s)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.slot, { borderRadius: radii.pill, backgroundColor: selected ? colors.primary : colors.surface, borderColor: selected ? colors.primary : colors.border }]}
            >
              <T variant="label" style={{ color: selected ? colors.onPrimary : colors.text, fontSize: 13 }}>
                {new Intl.DateTimeFormat(loc, { hour: "numeric", minute: "2-digit" }).format(s)}
              </T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  day: { width: 64, minHeight: 76, borderWidth: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slot: { minWidth: 84, minHeight: 44, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
});
