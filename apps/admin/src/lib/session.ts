import { ApiError, createApiClient, unwrap, type Schemas } from "@darna/api-client";
import { isStaff } from "./permissions";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const STORAGE_KEY = "darna.admin.session";

export type ApiClient = ReturnType<typeof createApiClient>;
export type Me = Schemas["MeDetailOut"];

interface Tokens {
  access_token: string;
  refresh_token: string;
}

type Result<T> = { data?: T; error?: unknown; response: Response };
export type Call = <T>(fn: (client: ApiClient) => Promise<Result<T>>) => Promise<T>;

export class NotStaffError extends Error {
  constructor() {
    super("This console is for Darna staff only. Member accounts cannot sign in here — use the Darna app instead.");
  }
}

function readStorage(): Tokens | null {
  try {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Tokens>;
    return parsed.access_token && parsed.refresh_token ? (parsed as Tokens) : null;
  } catch {
    return null;
  }
}

function writeStorage(tokens: Tokens | null) {
  try {
    if (tokens) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: tokens stay in memory only */
  }
}

/**
 * Staff session: tokens live in memory and sessionStorage (cleared when the tab closes; never localStorage).
 * `call` attaches the bearer token, refreshes once on 401 (single-flight, since refresh tokens rotate) and retries.
 */
export class Session {
  private tokens: Tokens | null = null;
  private refreshing: Promise<boolean> | null = null;
  readonly client: ApiClient;
  onExpired: () => void = () => {};

  constructor(baseUrl = API_URL) {
    this.client = createApiClient({ baseUrl, getAccessToken: () => this.tokens?.access_token });
  }

  restore(): boolean {
    this.tokens = readStorage();
    return this.tokens !== null;
  }

  get hasTokens() {
    return this.tokens !== null;
  }

  private setTokens(t: Tokens | null) {
    this.tokens = t;
    writeStorage(t);
  }

  call: Call = async (fn) => {
    let res = await fn(this.client);
    if (res.response.status === 401 && this.tokens) {
      if (await this.refresh()) res = await fn(this.client);
      else {
        this.setTokens(null);
        this.onExpired();
      }
    }
    return unwrap(res);
  };

  refresh(): Promise<boolean> {
    if (!this.refreshing) {
      const refresh_token = this.tokens?.refresh_token;
      this.refreshing = (async () => {
        if (!refresh_token) return false;
        try {
          const res = await this.client.POST("/auth/refresh", { body: { refresh_token } });
          if (!res.data) return false;
          this.setTokens({ access_token: res.data.access_token, refresh_token: res.data.refresh_token });
          return true;
        } catch {
          return false;
        }
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async me(): Promise<Me> {
    return this.call((c) => c.GET("/auth/me"));
  }

  /** Signs in and rejects non-staff roles (their tokens are revoked immediately). */
  async login(email: string, password: string, totpCode?: string): Promise<Me> {
    const body = totpCode ? { email, password, totp_code: totpCode } : { email, password };
    const tokens = unwrap(await this.client.POST("/auth/login", { body }));
    this.tokens = { access_token: tokens.access_token, refresh_token: tokens.refresh_token };
    let me: Me;
    try {
      me = await this.me();
    } catch (e) {
      this.tokens = null;
      throw e;
    }
    if (!isStaff(me.role)) {
      await this.logout();
      throw new NotStaffError();
    }
    this.setTokens(this.tokens);
    return me;
  }

  async logout(): Promise<void> {
    const refresh_token = this.tokens?.refresh_token;
    this.setTokens(null);
    if (refresh_token) {
      try {
        await this.client.POST("/auth/logout", { body: { refresh_token } });
      } catch {
        /* best effort */
      }
    }
  }
}

export { ApiError };
