import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError } from "@darna/api-client";
import { errorMessage } from "../api/errors";
import { ProviderCard, ReferralForm, ReferralRow, ServiceSuggestionsCard } from "../features/Services";
import { i18next, initI18n } from "../i18n";
import {
  buildReferralBody, canSharePhone, canSubmitReferral, contactLinks, hasDisclosure, providerText, REFERRAL_ERROR_CODES, referralErrorMessage, type Provider,
} from "../lib/services";

const base: Provider = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  category: "lawyer",
  name_en: "Demo Legal Partners",
  name_ar: "شركاء قانونيون",
  description_en: "Contract review and registration.",
  description_ar: "مراجعة العقود والتسجيل.",
  phone: "+201001234567",
  email: "lawyer@example.com",
  website: "https://example.com",
  license_number: "LIC-123",
  project_ids: [],
  referral_fee_disclosure_en: null,
  referral_fee_disclosure_ar: null,
  verified: true,
};
const withFee: Provider = {
  ...base,
  referral_fee_disclosure_en: "Darna may receive a fixed referral fee if you hire this provider.",
  referral_fee_disclosure_ar: "قد تحصل دارنا على رسوم إحالة ثابتة.",
};
const verifiedMe = { phone: "+201001234567", phone_verified_at: "2026-11-01T10:00:00Z" };
const unverifiedMe = { phone: "+201001234567", phone_verified_at: null };

const renderForm = async (props: Partial<React.ComponentProps<typeof ReferralForm>> = {}) => {
  const onSubmit = jest.fn();
  const onVerifyPhone = jest.fn();
  const utils = await render(<ReferralForm provider={base} me={verifiedMe} onSubmit={onSubmit} onVerifyPhone={onVerifyPhone} {...props} />);
  return { onSubmit, onVerifyPhone, utils };
};

describe("services helpers", () => {
  afterAll(() => initI18n("en"));

  it("requires an acknowledgement only when the provider has a disclosure (either language)", () => {
    expect(hasDisclosure(base)).toBe(false);
    expect(hasDisclosure(withFee)).toBe(true);
    expect(hasDisclosure({ referral_fee_disclosure_en: "  ", referral_fee_disclosure_ar: "رسوم" })).toBe(true);
    expect(canSubmitReferral({ provider: base, acknowledged: false, message: "" })).toBe(true);
    expect(canSubmitReferral({ provider: withFee, acknowledged: false, message: "" })).toBe(false);
    expect(canSubmitReferral({ provider: withFee, acknowledged: true, message: "x".repeat(1001) })).toBe(false);
  });

  it("allows sharing only a verified phone number", () => {
    expect(canSharePhone(verifiedMe)).toBe(true);
    expect(canSharePhone(unverifiedMe)).toBe(false);
    expect(canSharePhone({ phone: null, phone_verified_at: "2026-11-01T10:00:00Z" })).toBe(false);
    expect(canSharePhone(undefined)).toBe(false);
  });

  it("builds the request body, trimming the message", () => {
    expect(buildReferralBody({ provider: withFee, dealId: "d1", message: "  hi ", sharePhone: true, acknowledged: true })).toEqual({
      provider_id: withFee.id, deal_id: "d1", message: "hi", share_phone: true, acknowledged_disclosure: true,
    });
    expect(buildReferralBody({ provider: base, message: "", sharePhone: false, acknowledged: true }).deal_id).toBeNull();
  });

  it("picks the current language with a fallback and builds safe contact links", () => {
    expect(providerText(base, "ar").name).toBe("شركاء قانونيون");
    expect(providerText({ ...base, description_ar: "" }, "ar").description).toBe("Contract review and registration.");
    expect(contactLinks({ phone: "+20 100 123", email: "a@b.co", website: "javascript:alert(1)" })).toEqual({ tel: "tel:+20100123", mailto: "mailto:a@b.co", web: null });
  });

  it("maps every referral error code to a localized message in both languages", () => {
    const t = i18next.t.bind(i18next);
    const generic = t("errors.generic");
    for (const lang of ["en", "ar"] as const) {
      initI18n(lang);
      for (const code of REFERRAL_ERROR_CODES) {
        const status = code === "referral_exists" || code === "referral_closed" ? 409 : 422;
        const msg = referralErrorMessage(new ApiError(status, code, "x"), t);
        expect(msg).toBe(t(`errors.${code}`));
        expect(msg).not.toBe(t("errors.generic"));
        expect(msg.length).toBeGreaterThan(10);
      }
      expect(referralErrorMessage(new ApiError(404, "not_found", "Provider not found"), t)).toBe(t("services.errors.notFound"));
    }
    initI18n("en");
    expect(errorMessage(new ApiError(409, "referral_exists", "x"), t)).toBe("You already have an open request with this provider.");
    expect(generic).toBe("Something went wrong. Please try again.");
  });
});

describe("ReferralForm", () => {
  it("shows the disclosure prominently and blocks sending until it is acknowledged", async () => {
    const { onSubmit } = await renderForm({ provider: withFee });
    expect(screen.getByTestId("referral-disclosure-text")).toHaveTextContent(withFee.referral_fee_disclosure_en!);
    const submit = screen.getByTestId("referral-submit");
    expect(submit).toBeDisabled();
    await fireEvent.press(submit);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("referral-ack-hint")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("referral-ack"));
    expect(screen.getByTestId("referral-submit")).not.toBeDisabled();
    await fireEvent.press(screen.getByTestId("referral-submit"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ provider_id: withFee.id, acknowledged_disclosure: true, share_phone: false }));
  });

  it("has no disclosure box or acknowledgement for providers without a fee", async () => {
    const { onSubmit } = await renderForm({ dealId: "deal-1" });
    expect(screen.queryByTestId("referral-disclosure")).toBeNull();
    await fireEvent.press(screen.getByTestId("referral-submit"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ deal_id: "deal-1", acknowledged_disclosure: false }));
  });

  it("disables phone sharing with an explanation and a verify link when the phone isn't verified", async () => {
    const { onSubmit, onVerifyPhone } = await renderForm({ me: unverifiedMe });
    const sw = screen.getByTestId("referral-share-phone");
    expect(sw).toBeDisabled();
    expect(screen.getByText("Verify your phone number first to share it with providers.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("referral-verify-phone"));
    expect(onVerifyPhone).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId("referral-submit"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ share_phone: false }));
  });

  it("lets a verified user opt in to sharing their phone", async () => {
    const { onSubmit } = await renderForm();
    expect(screen.getByTestId("referral-share-phone")).not.toBeDisabled();
    expect(screen.queryByTestId("referral-verify-phone")).toBeNull();
    await fireEvent(screen.getByTestId("referral-share-phone"), "valueChange", true);
    await fireEvent.press(screen.getByTestId("referral-submit"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ share_phone: true }));
  });

  it("shows the independence statement and any API error", async () => {
    await renderForm({ error: "You already have an open request with this provider." });
    expect(screen.getByTestId("referral-disclaimer")).toHaveTextContent(/Darna is not a party/);
    expect(screen.getByTestId("referral-error")).toHaveTextContent(/already have an open request/);
  });
});

describe("services components", () => {
  it("renders a provider with verified badge, license and contact actions", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const onRequest = jest.fn();
    await render(<ProviderCard provider={withFee} onRequest={onRequest} />);
    expect(screen.getByTestId("provider-verified")).toBeTruthy();
    expect(screen.getByTestId("provider-fee")).toBeTruthy();
    expect(screen.getByTestId("provider-license")).toHaveTextContent("License no. LIC-123");
    await fireEvent.press(screen.getByLabelText("Call Demo Legal Partners"));
    expect(open).toHaveBeenCalledWith("tel:+201001234567");
    await fireEvent.press(screen.getByLabelText("Email Demo Legal Partners"));
    expect(open).toHaveBeenCalledWith("mailto:lawyer@example.com");
    await fireEvent.press(screen.getByLabelText("Request a referral from Demo Legal Partners"));
    expect(onRequest).toHaveBeenCalledWith(withFee);
  });

  it("hides the suggestions card without categories and links each category", async () => {
    const onOpen = jest.fn();
    const { rerender } = await render(<ServiceSuggestionsCard suggestions={{ categories: [], note: "n" }} onOpen={onOpen} />);
    expect(screen.queryByTestId("service-suggestions")).toBeNull();
    await rerender(<ServiceSuggestionsCard suggestions={{ categories: ["lawyer", "surveyor"], note: "Independent professionals." }} onOpen={onOpen} />);
    expect(screen.getByTestId("service-suggestions-note")).toHaveTextContent("Independent professionals.");
    await fireEvent.press(screen.getByTestId("suggestion-surveyor"));
    expect(onOpen).toHaveBeenCalledWith("surveyor");
  });

  it("offers cancel only for open referral requests", async () => {
    const r = { id: "r1", provider: base, deal_id: null, message: "Hello", share_phone: false, status: "requested" as const, created_at: "2026-11-10T10:00:00Z" };
    const onCancel = jest.fn();
    const { rerender } = await render(<ReferralRow referral={r} onCancel={onCancel} />);
    expect(screen.getByTestId("referral-status")).toHaveTextContent("Requested");
    await fireEvent.press(screen.getByTestId("referral-cancel-r1"));
    expect(onCancel).toHaveBeenCalledWith(r);
    await rerender(<ReferralRow referral={{ ...r, status: "completed" }} onCancel={onCancel} />);
    expect(screen.queryByTestId("referral-cancel-r1")).toBeNull();
  });
});
