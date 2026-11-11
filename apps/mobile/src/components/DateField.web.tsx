import React, { createElement, useState } from "react";
import { StyleSheet, View } from "react-native";
import { normalizeDateInput } from "../lib/date";
import { DateFieldFrame, DateFieldValue, useDateFieldModel, type DateFieldProps } from "./DateFieldFrame";

export type { DateFieldProps } from "./DateFieldFrame";

/**
 * Web fallback: a native `<input type="date">` laid transparently over the localized display, so the
 * browser's own calendar (and keyboard entry) is used while the visible text follows the app language
 * (Arabic-Indic digits in Arabic). Clicking opens the picker via `showPicker()` where supported.
 */
export function DateField(props: DateFieldProps) {
  const { value, onChange, min, max, testID } = props;
  const model = useDateFieldModel(props);
  const [focused, setFocused] = useState(false);

  const input = createElement("input", {
    type: "date",
    value: normalizeDateInput(value) ?? "",
    min,
    max,
    "aria-label": model.a11yLabel,
    "aria-description": model.a11yHint,
    "data-testid": testID,
    onChange: (e: { target: { value: string } }) => {
      const v = e.target.value;
      if (!v) onChange("");
      else {
        const iso = normalizeDateInput(v);
        if (iso) onChange(iso);
      }
    },
    onClick: (e: { currentTarget: HTMLInputElement }) => {
      try {
        e.currentTarget.showPicker?.();
      } catch {
        /* not allowed (e.g. cross-origin iframe): the browser falls back to inline editing */
      }
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      opacity: 0,
      border: 0,
      padding: 0,
      margin: 0,
      cursor: "pointer",
      boxSizing: "border-box",
    },
  });

  return (
    <DateFieldFrame props={props} model={model} focused={focused}>
      <View style={styles.area}>
        <DateFieldValue model={model} />
        {input}
      </View>
    </DateFieldFrame>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1, position: "relative" },
});
