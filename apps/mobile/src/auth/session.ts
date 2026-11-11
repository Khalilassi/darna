import type { Middleware } from "openapi-fetch";

/**
 * Session & token refresh logic, kept free of React/Expo so it can be unit tested.
 *
 * Contract with the API (`/auth/refresh`): refresh tokens rotate on every use; re-using a rotated
 * token revokes the family. Therefore refreshes are single-flight: concurrent 401s share one
 * refresh call, and a request that failed with an access token that has since been replaced is
 * simply retried with the new token instead of refreshing again.
 */
export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens | null): Promise<void>;
}

/** Exchanges a refresh token for a new pair. Must throw (or reject) when the token is refused. */
export type RefreshFn = (refreshToken: string) => Promise<Tokens>;

export type SessionListener = (tokens: Tokens | null, reason: "signin" | "refresh" | "signout" | "expired") => void;

export interface Session {
  hydrate(): Promise<Tokens | null>;
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(tokens: Tokens): Promise<void>;
  clear(reason?: "signout" | "expired"): Promise<void>;
  /** Refreshes once (single-flight). Resolves true when new tokens are available. */
  refresh(): Promise<boolean>;
  subscribe(listener: SessionListener): () => void;
}

export function createSession(opts: { store: TokenStore; refresh: RefreshFn }): Session {
  let tokens: Tokens | null = null;
  let inflight: Promise<boolean> | null = null;
  const listeners = new Set<SessionListener>();
  const emit: SessionListener = (t, r) => listeners.forEach((l) => l(t, r));

  const session: Session = {
    async hydrate() {
      tokens = await opts.store.load();
      return tokens;
    },
    getAccessToken: () => tokens?.accessToken ?? null,
    getRefreshToken: () => tokens?.refreshToken ?? null,
    async setTokens(next) {
      tokens = next;
      await opts.store.save(next);
      emit(next, "signin");
    },
    async clear(reason = "signout") {
      const had = tokens !== null;
      tokens = null;
      await opts.store.save(null);
      if (had || reason === "signout") emit(null, reason);
    },
    refresh() {
      if (inflight) return inflight;
      const current = tokens;
      if (!current) return Promise.resolve(false);
      inflight = (async () => {
        try {
          const next = await opts.refresh(current.refreshToken);
          tokens = next;
          await opts.store.save(next);
          emit(next, "refresh");
          return true;
        } catch {
          await session.clear("expired");
          return false;
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return session;
}

const AUTH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"];

/**
 * openapi-fetch middleware: on a 401 for an authenticated request, refresh once and retry the
 * original request with the new access token. If the refresh fails the session is cleared
 * (the app then shows its signed-out state) and the original 401 is returned.
 */
export function authRetryMiddleware(session: Session): Middleware {
  const pending = new Map<string, Request>();
  return {
    onRequest({ request, id }) {
      if (request.headers.has("Authorization")) pending.set(id, request.clone());
      return undefined;
    },
    async onResponse({ request, response, id, options }) {
      const original = pending.get(id);
      pending.delete(id);
      if (response.status !== 401 || !original) return undefined;
      const path = new URL(request.url).pathname;
      if (AUTH_PATHS.some((p) => path.endsWith(p))) return undefined;
      const usedToken = original.headers.get("Authorization")?.replace(/^Bearer /, "");
      const current = session.getAccessToken();
      let ok = !!current && current !== usedToken; // someone else already refreshed
      if (!ok) ok = await session.refresh();
      const token = session.getAccessToken();
      if (!ok || !token) return undefined;
      const retry = original.clone();
      retry.headers.set("Authorization", `Bearer ${token}`);
      return options.fetch(retry);
    },
    onError({ id }) {
      pending.delete(id);
      return undefined;
    },
  };
}
