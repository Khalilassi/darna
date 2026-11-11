import React, { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { intlLocale } from "../i18n/format";
import { clampISO, parseISODate, toISODate, todayISO } from "../lib/date";
import { useTheme } from "../theme";
import { Button } from "./Button";
import { DateFieldFrame, DateFieldValue, useDateFieldModel, type DateFieldProps } from "./DateFieldFrame";
import { T } from "./T";

export type { DateFieldProps } from "./DateFieldFrame";

/**
 * Date input that keeps an ISO `YYYY-MM-DD` value. Native: the platform date picker (Android dialog,
 * iOS inline calendar in a bottom sheet). Web: see DateField.web.tsx (`<input type="date">`).
 */
export function DateField(props: DateFieldProps) {
  const { value, onChange, min, max, testID } = props;
  const model = useDateFieldModel(props);
  const { t } = useTranslation();
  const { colors, radii, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(new Date());

  const minDate = parseISODate(min) ?? undefined;
  const maxDate = parseISODate(max) ?? undefined;
  const initial = () => parseISODate(clampISO(parseISODate(value) ? value.trim() : todayISO(), { min, max })) ?? new Date();

  const open = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: initial(),
        mode: "date",
        minimumDate: minDate,
        maximumDate: maxDate,
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type === "set" && d) onChange(toISODate(d));
        },
      });
    } else {
      setDraft(initial());
      setIosOpen(true);
    }
  };

  return (
    <DateFieldFrame props={props} model={model}>
      <Pressable
        style={styles.flex}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={model.a11yLabel}
        accessibilityHint={model.a11yHint}
        testID={testID}
      >
        <DateFieldValue model={model} />
      </Pressable>
      {Platform.OS === "ios" ? (
        <Modal visible={iosOpen} transparent animationType="slide" onRequestClose={() => setIosOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setIosOpen(false)} accessibilityRole="button" accessibilityLabel={t("common.cancel")} />
          <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + 12, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl }]}>
            <T variant="heading" style={styles.title}>{props.label}</T>
            <DateTimePicker
              value={draft}
              mode="date"
              display="inline"
              locale={intlLocale(model.lang)}
              themeVariant={scheme}
              accentColor={colors.primary}
              minimumDate={minDate}
              maximumDate={maxDate}
              onChange={(_e: DateTimePickerEvent, d?: Date) => d && setDraft(d)}
            />
            <View style={styles.actions}>
              <Button title={t("common.cancel")} variant="outline" onPress={() => setIosOpen(false)} style={styles.flex} />
              <Button
                title={t("dateField.done")}
                onPress={() => {
                  onChange(toISODate(draft));
                  setIosOpen(false);
                }}
                style={styles.flex}
                testID={testID ? `${testID}-done` : undefined}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </DateFieldFrame>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { paddingTop: 16, paddingHorizontal: 16, gap: 8 },
  title: { paddingHorizontal: 4 },
  actions: { flexDirection: "row", gap: 12, paddingTop: 8 },
});
