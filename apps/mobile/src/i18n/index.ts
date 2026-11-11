import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en";
import ar, { arPlurals } from "./ar";
import { setCurrentLanguage, type Language } from "./language";

type Tree = { [k: string]: string | Tree };
function deepMerge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    out[k] = typeof v === "object" && typeof prev === "object" ? deepMerge(prev, v) : v;
  }
  return out;
}

export const resources = {
  en: { translation: en },
  ar: { translation: deepMerge(ar as unknown as Tree, arPlurals as unknown as Tree) },
} as const;

export function initI18n(lang: Language) {
  setCurrentLanguage(lang);
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      resources,
      lng: lang,
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      returnNull: false,
      initImmediate: false,
    } as Parameters<typeof i18next.init>[0]);
    // `{{count, number}}`: Arabic uses ar-EG so counts render with Arabic-Indic digits (plain "ar" may use Latin digits).
    i18next.services.formatter?.add("number", (value, lng) =>
      new Intl.NumberFormat(lng === "ar" ? "ar-EG" : "en-US").format(Number(value)),
    );
  } else if (i18next.language !== lang) {
    void i18next.changeLanguage(lang);
  }
  return i18next;
}

export { i18next };
export type { Language };
