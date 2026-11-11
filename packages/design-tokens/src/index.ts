/**
 * Darna design tokens. Brand values are centralized here so the product name and palette can be
 * changed without touching components. Warm-neutral "stone & olive" palette: calm, trustworthy,
 * premium; no imitation of any developer's branding.
 */
export const brand = {
  name: "Darna",
  nameAr: "دارنا",
  tagline: "Homes, direct from verified owners",
  taglineAr: "بيوت مباشرة من ملاك موثقين",
} as const;

export const palette = {
  olive900: "#1F2B24",
  olive800: "#26382E",
  olive700: "#2E4A3C",
  olive600: "#3B5E4C",
  olive500: "#4F7A63",
  olive100: "#E3ECE6",
  olive50: "#F1F6F2",
  sand600: "#A8743D",
  sand500: "#C08A4E",
  sand100: "#F5E9DA",
  stone950: "#15130F",
  stone900: "#1E1C18",
  stone800: "#2A2722",
  stone700: "#3D3A33",
  stone500: "#77726A",
  stone400: "#9C978E",
  stone300: "#C9C4BA",
  stone200: "#E4E0D8",
  stone100: "#F0EDE7",
  stone50: "#F8F6F2",
  white: "#FFFFFF",
  red600: "#B3402E",
  red100: "#F8E1DC",
  amber600: "#A86A12",
  amber100: "#F8ECD3",
  blue600: "#2F5E8C",
  blue100: "#DEE9F4",
  green600: "#2F7A4B",
  green100: "#DDF0E3",
} as const;

export interface ColorScheme {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  primaryPressed: string;
  primaryMuted: string;
  onPrimary: string;
  accent: string;
  accentMuted: string;
  danger: string;
  dangerMuted: string;
  warning: string;
  warningMuted: string;
  info: string;
  infoMuted: string;
  success: string;
  successMuted: string;
  verified: string;
}

export const light: ColorScheme = {
  background: palette.stone50,
  surface: palette.white,
  surfaceMuted: palette.stone100,
  border: palette.stone200,
  text: palette.stone900,
  textMuted: palette.stone500,
  textInverse: palette.white,
  primary: palette.olive700,
  primaryPressed: palette.olive800,
  primaryMuted: palette.olive100,
  onPrimary: palette.white,
  accent: palette.sand600,
  accentMuted: palette.sand100,
  danger: palette.red600,
  dangerMuted: palette.red100,
  warning: palette.amber600,
  warningMuted: palette.amber100,
  info: palette.blue600,
  infoMuted: palette.blue100,
  success: palette.green600,
  successMuted: palette.green100,
  verified: palette.olive600,
};

export const dark: ColorScheme = {
  background: palette.stone950,
  surface: palette.stone900,
  surfaceMuted: palette.stone800,
  border: palette.stone700,
  text: palette.stone100,
  textMuted: palette.stone400,
  textInverse: palette.stone900,
  primary: "#7FB596",
  primaryPressed: "#6BA384",
  primaryMuted: "#22362B",
  onPrimary: palette.stone950,
  accent: "#D9A56A",
  accentMuted: "#3A2E20",
  danger: "#E07A68",
  dangerMuted: "#3A221D",
  warning: "#E0A84A",
  warningMuted: "#3A2E18",
  info: "#82AEDB",
  infoMuted: "#1F2C3A",
  success: "#7CC596",
  successMuted: "#1E3326",
  verified: "#7FB596",
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radii = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: "700" },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "400" },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600", letterSpacing: 0.3 },
  price: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
} as const;

export const shadow = {
  card: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
} as const;

/** Egyptian pound formatting. Uses Arabic-Indic digits for 'ar'. */
export function formatEGP(value: string | number | null | undefined, locale: "en" | "ar" = "en", opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  const fmt = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: opts.compact ? 1 : 0,
    notation: opts.compact ? "compact" : "standard",
  });
  return fmt.format(n);
}
