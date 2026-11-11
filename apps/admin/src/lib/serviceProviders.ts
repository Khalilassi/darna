import type { ProviderIn, ServiceCategory, ServiceProvider } from "./adminApi";

/** Mirrors services/api/app/models/enums.py ServiceCategory. */
export const SERVICE_CATEGORIES: readonly ServiceCategory[] = [
  "lawyer", "notary_services", "surveyor", "mover", "maintenance", "interior", "cleaning",
];

export const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  lawyer: "Lawyer",
  notary_services: "Notary services",
  surveyor: "Surveyor",
  mover: "Mover",
  maintenance: "Maintenance",
  interior: "Interior & finishing",
  cleaning: "Cleaning",
};

/** Same pattern the API enforces on ProviderIn.phone. */
export const PHONE_RE = /^\+?[0-9]{8,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ProviderForm {
  category: ServiceCategory | "";
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  phone: string;
  email: string;
  website: string;
  license_number: string;
  project_ids: string[];
  referral_fee_disclosure_en: string;
  referral_fee_disclosure_ar: string;
}

export type ProviderFormErrors = Partial<Record<keyof ProviderForm, string>>;

export const EMPTY_PROVIDER_FORM: ProviderForm = {
  category: "",
  name_en: "",
  name_ar: "",
  description_en: "",
  description_ar: "",
  phone: "",
  email: "",
  website: "",
  license_number: "",
  project_ids: [],
  referral_fee_disclosure_en: "",
  referral_fee_disclosure_ar: "",
};

export function formFromProvider(p: ServiceProvider): ProviderForm {
  return {
    category: p.category,
    name_en: p.name_en,
    name_ar: p.name_ar,
    description_en: p.description_en,
    description_ar: p.description_ar,
    phone: p.phone ?? "",
    email: p.email ?? "",
    website: p.website ?? "",
    license_number: p.license_number ?? "",
    project_ids: [...p.project_ids],
    referral_fee_disclosure_en: p.referral_fee_disclosure_en ?? "",
    referral_fee_disclosure_ar: p.referral_fee_disclosure_ar ?? "",
  };
}

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Client-side checks matching the API's ProviderIn constraints. */
export function validateProviderForm(f: ProviderForm): ProviderFormErrors {
  const e: ProviderFormErrors = {};
  if (!f.category) e.category = "Choose a category.";
  for (const k of ["name_en", "name_ar"] as const) {
    const v = f[k].trim();
    if (v.length < 2) e[k] = "Required (at least 2 characters).";
    else if (v.length > 120) e[k] = "Keep it under 120 characters.";
  }
  for (const k of ["description_en", "description_ar"] as const) if (f[k].length > 2000) e[k] = "Keep it under 2000 characters.";
  const phone = f.phone.replace(/[\s-]/g, "");
  if (phone && !PHONE_RE.test(phone)) e.phone = "Use 8–15 digits, optionally starting with + (e.g. +201001234567).";
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = "Enter a valid email address.";
  if (f.website.trim() && !isHttpUrl(f.website.trim())) e.website = "Enter a full URL starting with https:// or http://.";
  if (f.license_number.length > 80) e.license_number = "Keep it under 80 characters.";
  for (const k of ["referral_fee_disclosure_en", "referral_fee_disclosure_ar"] as const)
    if (f[k].length > 300) e[k] = "Keep it under 300 characters.";
  const en = f.referral_fee_disclosure_en.trim();
  const ar = f.referral_fee_disclosure_ar.trim();
  if (en && !ar) e.referral_fee_disclosure_ar = "Add the Arabic disclosure too, so Arabic readers see it.";
  if (ar && !en) e.referral_fee_disclosure_en = "Add the English disclosure too, so English readers see it.";
  return e;
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);

/** Request body for create / edit. Empty optional fields are sent as null (clears them on edit). */
export function providerBody(f: ProviderForm): Omit<ProviderIn, "is_active"> {
  return {
    category: f.category as ServiceCategory,
    name_en: f.name_en.trim(),
    name_ar: f.name_ar.trim(),
    description_en: f.description_en.trim(),
    description_ar: f.description_ar.trim(),
    phone: orNull(f.phone.replace(/[\s-]/g, "")),
    email: orNull(f.email),
    website: orNull(f.website),
    license_number: orNull(f.license_number),
    project_ids: f.project_ids,
    referral_fee_disclosure_en: orNull(f.referral_fee_disclosure_en),
    referral_fee_disclosure_ar: orNull(f.referral_fee_disclosure_ar),
  };
}

export const hasDisclosure = (p: Pick<ServiceProvider, "referral_fee_disclosure_en" | "referral_fee_disclosure_ar">) =>
  !!(p.referral_fee_disclosure_en?.trim() || p.referral_fee_disclosure_ar?.trim());
