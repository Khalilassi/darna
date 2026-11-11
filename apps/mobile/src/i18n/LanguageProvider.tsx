import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Platform } from "react-native";
import { getLocales } from "expo-localization";
import { reloadAppAsync } from "expo";
import { kv } from "../lib/storage";
import { initI18n, i18next } from "./index";
import { applyDirection, directionFor, type Direction } from "./direction";
import { setCurrentLanguage, type Language } from "./language";

const LANG_KEY = "darna.lang";

export async function detectInitialLanguage(): Promise<Language> {
  const stored = await kv.get(LANG_KEY);
  if (stored === "ar" || stored === "en") return stored;
  try {
    return getLocales()[0]?.languageCode === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

interface LanguageCtx {
  lang: Language;
  dir: Direction;
  isRTL: boolean;
  setLanguage(lang: Language): Promise<void>;
}

const Ctx = createContext<LanguageCtx | null>(null);

export function LanguageProvider({ initial, children }: { initial: Language; children: React.ReactNode }) {
  const [lang, setLang] = useState<Language>(initial);

  const setLanguage = useCallback(async (next: Language) => {
    await kv.set(LANG_KEY, next);
    setCurrentLanguage(next);
    initI18n(next);
    const needsReload = applyDirection(next);
    setLang(next);
    if (needsReload && Platform.OS !== "web") {
      // Native layout direction only flips after a JS reload.
      setTimeout(() => void reloadAppAsync("language-direction-change").catch(() => undefined), 150);
    }
  }, []);

  const value = useMemo<LanguageCtx>(() => {
    const dir = directionFor(lang);
    return { lang, dir, isRTL: dir === "rtl", setLanguage };
  }, [lang, setLanguage]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLanguage(): LanguageCtx {
  const v = useContext(Ctx);
  if (!v) {
    // Fallback for isolated component tests.
    const lang = (i18next.language as Language) || "en";
    const dir = directionFor(lang);
    return { lang, dir, isRTL: dir === "rtl", setLanguage: async () => undefined };
  }
  return v;
}
