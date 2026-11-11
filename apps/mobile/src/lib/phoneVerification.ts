/** Keeps only ASCII and Arabic-Indic digits (converted to ASCII), up to `max` characters. */
export function onlyDigits(value: string, max: number): string {
  const ascii = value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return ascii.replace(/\D/g, "").slice(0, max);
}

/** Whole seconds left before a resend is allowed (0 when allowed). */
export function resendLabelSeconds(resendAt: number, now: number): number {
  return Math.max(0, Math.ceil((resendAt - now) / 1000));
}
