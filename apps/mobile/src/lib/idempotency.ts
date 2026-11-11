import { useRef } from "react";
import { newIdempotencyKey } from "@darna/api-client";

/**
 * Idempotency keys for retry-safe submissions.
 *
 * A key is tied to (scope, request body) while the request is unresolved, so retrying after a network
 * error or timeout replays the server's stored result instead of duplicating the action. Once a
 * request succeeds its key is forgotten: a later, intentional submission with identical content
 * (e.g. withdraw an offer, then make the same offer again) gets a fresh key and is a new action.
 */
export function useIdempotencyKeys() {
  const keys = useRef(new Map<string, string>());
  return async function withKey<T>(scope: string, body: unknown, send: (key: string) => Promise<T>): Promise<T> {
    const k = `${scope}:${JSON.stringify(body)}`;
    let v = keys.current.get(k);
    if (!v) {
      v = newIdempotencyKey();
      keys.current.set(k, v);
    }
    const result = await send(v); // throws on failure -> key kept for a retry
    keys.current.delete(k);
    return result;
  };
}
