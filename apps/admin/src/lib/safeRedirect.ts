/**
 * Returns a same-origin path for a post-login redirect, or "/".
 * Parsing (instead of prefix checks) defeats tricks such as "//evil.example", "/\\evil.example"
 * and "https:evil.example", which browsers normalize to external origins.
 */
export function safeNextPath(next: string | null | undefined, origin: string): string {
  if (!next) return "/";
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return "/";
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return "/";
  }
}
