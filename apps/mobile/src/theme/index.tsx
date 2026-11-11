import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { dark, light, radii, shadow, spacing, typography, type ColorScheme } from "@darna/design-tokens";
import { kv } from "../lib/storage";

export type ThemePref = "system" | "light" | "dark";
const KEY = "darna.theme";

export interface Theme {
  colors: ColorScheme;
  scheme: "light" | "dark";
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  shadow: typeof shadow;
}

interface ThemeCtx extends Theme {
  pref: ThemePref;
  setPref(p: ThemePref): void;
}

const makeTheme = (scheme: "light" | "dark"): Theme => ({
  colors: scheme === "dark" ? dark : light,
  scheme,
  spacing,
  radii,
  typography,
  shadow,
});

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>("system");
  useEffect(() => {
    void kv.get(KEY).then((v) => {
      if (v === "light" || v === "dark" || v === "system") setPrefState(v);
    });
  }, []);
  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    void kv.set(KEY, p);
  }, []);
  const scheme: "light" | "dark" = pref === "system" ? (system === "dark" ? "dark" : "light") : pref;
  const value = useMemo(() => ({ ...makeTheme(scheme), pref, setPref }), [scheme, pref, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  return v ?? { ...makeTheme("light"), pref: "system", setPref: () => undefined };
}

/** Memoized style factory bound to the active theme. */
export function useStyles<T>(factory: (t: Theme) => T): T {
  const theme = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => factory(theme), [theme.scheme]);
}
