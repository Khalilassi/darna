/**
 * Typed client for the Darna API, generated from the FastAPI OpenAPI schema.
 * Regenerate with `npm run gen:api` after changing backend schemas.
 */
import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema";

export type { components, paths } from "./schema";
export type Schemas = components["schemas"];

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export interface ClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Called on 401 for authenticated calls; should refresh tokens and return true to retry once. */
  onUnauthorized?: () => Promise<boolean>;
  locale?: () => string;
}

export function createApiClient(opts: ClientOptions) {
  const client = createClient<paths>({ baseUrl: opts.baseUrl });
  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await opts.getAccessToken?.();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      if (opts.locale) request.headers.set("Accept-Language", opts.locale());
      return request;
    },
  };
  client.use(auth);
  return client;
}

/** Unwraps an openapi-fetch result, throwing ApiError on failure. */
export function unwrap<T>(res: { data?: T; error?: unknown; response: Response }): T {
  if (res.error !== undefined || !res.response.ok) {
    const body = res.error as ApiErrorBody | undefined;
    throw new ApiError(res.response.status, body?.error?.code ?? "http_error", body?.error?.message ?? res.response.statusText, body?.error?.details);
  }
  return res.data as T;
}

export const newIdempotencyKey = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
