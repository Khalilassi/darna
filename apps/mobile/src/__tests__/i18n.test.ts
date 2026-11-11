import { I18nManager } from "react-native";
import { i18next, initI18n } from "../i18n";
import { applyDirection, directionFor, mirrorTransform } from "../i18n/direction";
import { formatArea, formatMoney, formatNumber, localizeDigits, parseAmountInput } from "../i18n/format";
import en from "../i18n/en";
import ar from "../i18n/ar";

const ARABIC_DIGITS = /[٠-٩]/;

function keys(o: object, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe("i18n & RTL helpers", () => {
  afterAll(() => initI18n("en"));

  it("formats EGP with Arabic-Indic digits in Arabic", () => {
    const s = formatMoney("6740000", "ar");
    expect(s).toMatch(ARABIC_DIGITS);
    expect(s).not.toMatch(/[0-9]/);
    expect(formatMoney("6740000", "en")).toMatch(/6,740,000/);
    expect(formatArea("182.00", "ar")).toBe("١٨٢ م²");
    expect(formatNumber(12, "ar")).toBe("١٢");
    expect(localizeDigits("B7-72", "ar")).toBe("B٧-٧٢");
    expect(formatMoney(null, "ar")).toBe("—");
  });

  it("parses amounts typed with Arabic digits and separators", () => {
    expect(parseAmountInput("٦٬٥٠٠٬٠٠٠")).toBe(6500000);
    expect(parseAmountInput("6,500,000")).toBe(6500000);
    expect(parseAmountInput("12.5")).toBe(12.5);
    expect(parseAmountInput("abc")).toBeNull();
  });

  it("derives direction and mirrors directional icons", () => {
    expect(directionFor("ar")).toBe("rtl");
    expect(directionFor("en")).toBe("ltr");
    expect(mirrorTransform(true)).toEqual([{ scaleX: -1 }]);
    expect(mirrorTransform(false)).toEqual([]);
  });

  it("forces native RTL and asks for a reload only when direction changes", () => {
    const force = jest.spyOn(I18nManager, "forceRTL").mockImplementation(() => undefined);
    jest.spyOn(I18nManager, "allowRTL").mockImplementation(() => undefined);
    jest.spyOn(I18nManager, "swapLeftAndRightInRTL").mockImplementation(() => undefined);
    const rtl = I18nManager.isRTL;
    expect(applyDirection(rtl ? "en" : "ar", "ios")).toBe(true);
    expect(force).toHaveBeenCalledWith(!rtl);
    force.mockClear();
    expect(applyDirection(rtl ? "ar" : "en", "ios")).toBe(false);
    expect(force).not.toHaveBeenCalled();
  });

  it("has an Arabic string for every English key, with Arabic plurals and digits", () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
    initI18n("ar");
    expect(i18next.t("explore.results", { count: 3 })).toBe("٣ منازل");
    expect(i18next.t("explore.results", { count: 24 })).toBe("٢٤ منزلًا");
    expect(i18next.t("enum.dealStatus.offer_accepted")).toBe("تم قبول العرض");
    expect(i18next.t("errors.broker_not_allowed")).toMatch(/سماسرة/);
    initI18n("en");
    expect(i18next.t("explore.results", { count: 1 })).toBe("1 home");
  });
});
