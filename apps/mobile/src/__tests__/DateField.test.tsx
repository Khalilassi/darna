import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { addDaysISO, clampISO, displayDate, isValidISODate, normalizeDateInput, parseISODate, rangeViolation, toISODate, todayISO } from "../lib/date";
import { validateDate } from "../lib/validation";
import { i18next } from "../i18n";
import { DateField } from "../components/DateField";
import { ThemeProvider } from "../theme";
import { LanguageProvider } from "../i18n/LanguageProvider";
import { SafeAreaProvider } from "react-native-safe-area-context";

jest.mock("@react-native-community/datetimepicker", () => {
  const open = jest.fn();
  return { __esModule: true, default: () => null, DateTimePickerAndroid: { open } };
});

const t = i18next.t.bind(i18next);

describe("date value helpers", () => {
  it("parses strict ISO calendar dates and rejects impossible ones", () => {
    expect(toISODate(parseISODate("2026-12-01")!)).toBe("2026-12-01");
    expect(parseISODate("2026-02-30")).toBeNull();
    expect(parseISODate("2026-13-01")).toBeNull();
    expect(parseISODate("01/12/2026")).toBeNull();
    expect(parseISODate("")).toBeNull();
    expect(isValidISODate("2028-02-29")).toBe(true);
    expect(isValidISODate("2027-02-29")).toBe(false);
  });

  it("formats the local calendar day without timezone drift", () => {
    expect(toISODate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(todayISO(new Date(2026, 10, 11, 0, 1))).toBe("2026-11-11");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("normalizes typed input with Arabic-Indic digits and other separators", () => {
    expect(normalizeDateInput("٢٠٢٦-١٢-٠١")).toBe("2026-12-01");
    expect(normalizeDateInput("2026/1/5")).toBe("2026-01-05");
    expect(normalizeDateInput("2026-02-30")).toBeNull();
    expect(normalizeDateInput("tomorrow")).toBeNull();
  });

  it("checks and clamps min/max bounds", () => {
    expect(rangeViolation("2026-01-01", { min: "2026-01-02" })).toBe("min");
    expect(rangeViolation("2026-01-03", { max: "2026-01-02" })).toBe("max");
    expect(rangeViolation("2026-01-02", { min: "2026-01-02", max: "2026-01-02" })).toBeNull();
    expect(clampISO("2025-01-01", { min: "2026-01-01" })).toBe("2026-01-01");
  });

  it("displays dates localized, with Arabic-Indic digits in Arabic", () => {
    expect(displayDate("2026-12-01", "en")).toMatch(/Dec.*1.*2026/);
    const ar = displayDate("2026-12-01", "ar");
    expect(ar).toMatch(/[٠-٩]/);
    expect(ar).not.toMatch(/[0-9]/);
    expect(displayDate("", "en")).toBe("");
    expect(displayDate("garbage", "ar")).toBe("");
  });

  it("validates with localized messages", () => {
    expect(validateDate("", t)).toBeUndefined();
    expect(validateDate("", t, { required: true })).toBe("Required");
    expect(validateDate("2026-02-30", t)).toBe("Enter a valid date");
    expect(validateDate("2000-01-01", t, { future: true })).toBe("Choose today or a later date");
    expect(validateDate(todayISO(), t, { future: true })).toBeUndefined();
    expect(validateDate("2026-01-01", t, { min: "2026-02-01" })).toMatch(/^Choose Feb 1, 2026 or later$/);
  });
});

describe("DateField", () => {
  const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
  const tree = (ui: React.ReactElement) => (
    <SafeAreaProvider initialMetrics={metrics}><LanguageProvider initial="en"><ThemeProvider>{ui}</ThemeProvider></LanguageProvider></SafeAreaProvider>
  );

  it("shows the localized value, an accessible label and clears optional values to ''", async () => {
    const onChange = jest.fn();
    await render(tree(<DateField label="Handover" value="2026-12-01" onChange={onChange} optional testID="df" />));
    expect(screen.getByText("Dec 1, 2026")).toBeTruthy();
    expect(screen.getByLabelText("Handover: Dec 1, 2026")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("df-clear"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows a placeholder, no clear button when required, and the range message", async () => {
    const { rerender } = await render(tree(<DateField label="Due" value="" onChange={jest.fn()} testID="df" />));
    expect(screen.getByText("Choose a date")).toBeTruthy();
    expect(screen.queryByTestId("df-clear")).toBeNull();
    await rerender(tree(<DateField label="Due" value="2026-01-01" min="2026-02-01" onChange={jest.fn()} />));
    expect(screen.getByText("Choose Feb 1, 2026 or later")).toBeTruthy();
  });
});
