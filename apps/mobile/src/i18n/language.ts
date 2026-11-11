export type Language = "en" | "ar";

let lang: Language = "en";
/** Module-level mirror of the active language for non-React code (API Accept-Language header). */
export const currentLanguage = (): Language => lang;
export const setCurrentLanguage = (l: Language) => {
  lang = l;
};
export const isRTLLanguage = (l: string): boolean => l === "ar";
