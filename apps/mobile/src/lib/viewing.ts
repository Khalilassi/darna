export const VIEWING_MIN_AHEAD_MS = 2 * 3_600_000;
export const VIEWING_MAX_AHEAD_MS = 60 * 86_400_000;

/** API rule: a viewing must be 2 hours to 60 days ahead. */
export function isValidViewingTime(d: Date, now = new Date()): boolean {
  const ahead = d.getTime() - now.getTime();
  return ahead >= VIEWING_MIN_AHEAD_MS && ahead <= VIEWING_MAX_AHEAD_MS;
}
