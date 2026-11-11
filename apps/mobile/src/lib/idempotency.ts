import { useRef } from "react";
import { newIdempotencyKey } from "@darna/api-client";

/**
 * One Idempotency-Key per distinct request body: retrying the same submission (e.g. after a network
 * error) reuses the key so the server replays instead of duplicating, while an edited form gets a
 * fresh key (the API rejects a reused key with a different body).
 */
export function useIdempotencyKeys() {
  const keys = useRef(new Map<string, string>());
  return (scope: string, body: unknown): string => {
    const k = `${scope}:${JSON.stringify(body)}`;
    let v = keys.current.get(k);
    if (!v) {
      v = newIdempotencyKey();
      keys.current.set(k, v);
    }
    return v;
  };
}
