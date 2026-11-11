import { ApiError } from "@darna/api-client";
import { errorMessage, fieldErrors, validationText } from "../api/errors";
import { i18next, initI18n } from "../i18n";

const t = i18next.t.bind(i18next);
const v422 = (details: unknown[], code = "validation_failed") => new ApiError(422, code, "Invalid request", details);

describe("validation error localization", () => {
  afterEach(() => initI18n("en"));

  it("localizes field errors by type and interpolates ctx limits", () => {
    initI18n("en");
    const err = v422([
      { loc: ["body", "full_name"], msg: "String should have at least 2 characters", type: "string_too_short", ctx: { min_length: 2 } },
      { loc: ["body", "password"], msg: "password must mix letters and numbers or symbols", type: "password_too_simple" },
    ]);
    expect(fieldErrors(err)).toEqual({ full_name: "Use at least 2 characters.", password: "Mix letters with numbers or symbols." });
    initI18n("ar");
    expect(fieldErrors(err).full_name).toBe("استخدم 2 أحرف على الأقل.");
    expect(fieldErrors(err).password).toBe("اخلط الحروف بالأرقام أو الرموز.");
  });

  it("falls back to the English API message only in English", () => {
    const d = { loc: ["body", "x"], msg: "Value error, something new", type: "brand_new_rule" };
    initI18n("en");
    expect(validationText(d)).toBe("something new");
    initI18n("ar");
    expect(validationText(d)).toBe(i18next.t("apiValidation.invalid"));
  });

  it("shows a localized model-level rule for invalid sale terms", () => {
    const err = v422([{ loc: ["body", "sale_terms"], msg: "cash resale must not have remaining developer installments", type: "cash_resale_has_installments" }], "invalid_sale_terms");
    initI18n("ar");
    expect(errorMessage(err, t)).toBe("البيع النقدي لا يتضمن أقساطًا متبقية.");
    initI18n("en");
    expect(errorMessage(err, t)).toBe("A cash sale can't include remaining installments.");
  });
});
