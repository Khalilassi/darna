import { createApiClient, unwrap, type Schemas } from "@darna/api-client";
import { API_URL } from "../config";
import { kv } from "../lib/storage";
import { authRetryMiddleware, createSession, type Tokens, type TokenStore } from "../auth/session";
import { currentLanguage } from "../i18n/language";

const TOKENS_KEY = "darna.tokens.v1";

const tokenStore: TokenStore = {
  async load() {
    const raw = await kv.get(TOKENS_KEY);
    if (!raw) return null;
    try {
      const t = JSON.parse(raw) as Tokens;
      return t.accessToken && t.refreshToken ? t : null;
    } catch {
      return null;
    }
  },
  async save(tokens) {
    if (tokens) await kv.set(TOKENS_KEY, JSON.stringify(tokens));
    else await kv.remove(TOKENS_KEY);
  },
};

/** Unauthenticated client used only for the refresh call (avoids recursion through the retry middleware). */
const bare = createApiClient({ baseUrl: API_URL });

export const toTokens = (t: Schemas["TokenOut"]): Tokens => ({ accessToken: t.access_token, refreshToken: t.refresh_token });

export const session = createSession({
  store: tokenStore,
  refresh: async (refreshToken) => toTokens(unwrap(await bare.POST("/auth/refresh", { body: { refresh_token: refreshToken } }))),
});

export const api = createApiClient({
  baseUrl: API_URL,
  getAccessToken: () => session.getAccessToken(),
  locale: () => currentLanguage(),
});
api.use(authRetryMiddleware(session));

export { unwrap };
export type { Schemas };
