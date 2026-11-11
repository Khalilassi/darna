import { dark, light, radii, spacing, type ColorScheme } from "@darna/design-tokens";

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

function colorVars(scheme: ColorScheme): string {
  return Object.entries(scheme)
    .map(([k, v]) => `--c-${kebab(k)}:${v};`)
    .join("");
}

function scaleVars(): string {
  const s = Object.entries(spacing).map(([k, v]) => `--space-${k}:${v}px;`);
  const r = Object.entries(radii).map(([k, v]) => `--radius-${k}:${v}px;`);
  return [...s, ...r].join("");
}

/** CSS custom properties emitted from @darna/design-tokens (light by default, dark via prefers-color-scheme). */
export const themeCss = `:root{color-scheme:light dark;${colorVars(light)}${scaleVars()}}@media (prefers-color-scheme: dark){:root{${colorVars(dark)}}}`;
