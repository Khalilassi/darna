import type { TFunction } from "i18next";
import type { Schemas } from "@darna/api-client";
import { ApiError, errorMessage } from "../api/errors";
import type { Language } from "../i18n/language";

export type Provider = Schemas["ProviderOut"];
export type ServiceCategory = Schemas["ServiceCategory"];
export type ReferralStatus = Schemas["ReferralStatus"];

/** Display order of the directory chips (mirrors the API's ServiceCategory enum). */
export const SERVICE_CATEGORIES: readonly ServiceCategory[] = [
  "lawyer", "notary_services", "surveyor", "mover", "maintenance", "interior", "cleaning",
];

export const isServiceCategory = (v: unknown): v is ServiceCategory =>
  typeof v === "string" && (SERVICE_CATEGORIES as readonly string[]).includes(v);

/** Open requests (the user can still cancel them). */
export const OPEN_REFERRAL: readonly ReferralStatus[] = ["requested", "contacted"];
export const isOpenReferral = (s: ReferralStatus) => OPEN_REFERRAL.includes(s);

const pick = (en: string | null | undefined, ar: string | null | undefined, lang: Language) => {
  const primary = (lang === "ar" ? ar : en)?.trim();
  const fallback = (lang === "ar" ? en : ar)?.trim();
  return primary || fallback || "";
};

/** Name / description / disclosure in the current language, falling back to the other one. */
export function providerText(p: Provider, lang: Language) {
  return {
    name: pick(p.name_en, p.name_ar, lang),
    description: pick(p.description_en, p.description_ar, lang),
    disclosure: pick(p.referral_fee_disclosure_en, p.referral_fee_disclosure_ar, lang),
  };
}

/** Same rule as the API: any disclosure text (either language) requires an acknowledgement. */
export function hasDisclosure(p: Pick<Provider, "referral_fee_disclosure_en" | "referral_fee_disclosure_ar">): boolean {
  return !!(p.referral_fee_disclosure_en?.trim() || p.referral_fee_disclosure_ar?.trim());
}

/** Sharing a phone number requires a number that was verified by SMS. */
export function canSharePhone(me: Pick<Schemas["MeDetailOut"], "phone" | "phone_verified_at"> | undefined | null): boolean {
  return !!(me?.phone && me.phone_verified_at);
}

export function canSubmitReferral(input: { provider: Provider; acknowledged: boolean; message: string }): boolean {
  if (input.message.length > MAX_REFERRAL_MESSAGE) return false;
  return !hasDisclosure(input.provider) || input.acknowledged;
}

export const MAX_REFERRAL_MESSAGE = 1000;

export function buildReferralBody(input: {
  provider: Provider;
  dealId?: string | null;
  message: string;
  sharePhone: boolean;
  acknowledged: boolean;
}): Schemas["ReferralIn"] {
  return {
    provider_id: input.provider.id,
    deal_id: input.dealId || null,
    message: input.message.trim(),
    share_phone: input.sharePhone,
    acknowledged_disclosure: hasDisclosure(input.provider) ? input.acknowledged : false,
  };
}

/** Error codes the referral endpoints return, each with its own localized message. */
export const REFERRAL_ERROR_CODES = ["disclosure_not_acknowledged", "phone_not_verified", "referral_exists", "referral_closed"] as const;

/**
 * Localized message for a referral request/cancel failure. A 404 means the provider was removed or
 * unverified, or the deal isn't one the user is party to.
 */
export function referralErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError && err.status === 404) return t("services.errors.notFound");
  return errorMessage(err, t);
}

/** Phone / email / website links for `Linking.openURL`. Returns null for missing values. */
export function contactLinks(p: Pick<Provider, "phone" | "email" | "website">) {
  const phone = p.phone?.replace(/[^\d+]/g, "");
  const website = p.website?.trim();
  return {
    tel: phone ? `tel:${phone}` : null,
    mailto: p.email ? `mailto:${p.email.trim()}` : null,
    web: website && /^https?:\/\//i.test(website) ? website : null,
  };
}
