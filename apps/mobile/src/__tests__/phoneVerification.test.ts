import { onlyDigits, resendLabelSeconds } from "../lib/phoneVerification";

describe("phone verification helpers", () => {
  it("keeps digits only, converts Arabic-Indic digits and caps length", () => {
    expect(onlyDigits("12a 34-56", 6)).toBe("123456");
    expect(onlyDigits("١٢٣٤٥٦٧", 6)).toBe("123456");
    expect(onlyDigits("", 6)).toBe("");
  });

  it("counts down whole seconds and never goes negative", () => {
    expect(resendLabelSeconds(10_500, 0)).toBe(11);
    expect(resendLabelSeconds(1_000, 1_000)).toBe(0);
    expect(resendLabelSeconds(1_000, 5_000)).toBe(0);
  });
});
