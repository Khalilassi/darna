import { I18nManager, Platform } from "react-native";
import { isRTLLanguage, type Language } from "./language";

export type Direction = "ltr" | "rtl";
export const directionFor = (lang: Language): Direction => (isRTLLanguage(lang) ? "rtl" : "ltr");

/**
 * Applies the writing direction for `lang`.
 * - Web: sets <html dir/lang>; react-native-web maps logical styles (start/end) and flex rows to CSS,
 *   which follow the document direction.
 * - Native: React Native's layout direction is fixed at startup, so we persist the choice with
 *   I18nManager.forceRTL and report that a reload is required.
 * Returns true when a native reload is needed for the layout to flip.
 */
export function applyDirection(lang: Language, platform: string = Platform.OS): boolean {
  const rtl = isRTLLanguage(lang);
  if (platform === "web") {
    if (typeof document !== "undefined") {
      document.documentElement.dir = rtl ? "rtl" : "ltr";
      document.documentElement.lang = lang;
    }
    return false;
  }
  // forceRTL(false) alone does not override an RTL device locale while RTL is allowed, so English
  // must also disallow RTL; otherwise the layout stays mirrored and the startup check loops on reloads.
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  I18nManager.swapLeftAndRightInRTL(true);
  return I18nManager.isRTL !== rtl;
}

/** Icons that imply direction (chevrons, arrows) must be mirrored in RTL. */
export const mirrorTransform = (rtl: boolean) => (rtl ? [{ scaleX: -1 as const }] : []);

