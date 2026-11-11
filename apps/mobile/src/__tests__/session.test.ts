import createClient from "openapi-fetch";
import { authRetryMiddleware, createSession, type Tokens } from "../auth/session";

type Handler = (req: Request) => Response | Promise<Response>;

function setup(opts: { refresh?: (rt: string) => Promise<Tokens>; handler: Handler }) {
  const saved: (Tokens | null)[] = [];
  const refresh = jest.fn(opts.refresh ?? (async (rt: string) => ({ accessToken: `new-${rt}`, refreshToken: `rt2-${rt}` })));
  const session = createSession({ store: { load: async () => ({ accessToken: "old", refreshToken: "rt1" }), save: async (t) => void saved.push(t) }, refresh });
  const calls: string[] = [];
  const fetchImpl = jest.fn(async (input: Request) => {
    calls.push(`${new URL(input.url).pathname} ${input.headers.get("Authorization") ?? "-"}`);
    return opts.handler(input);
  });
  const client = createClient<Record<string, never>>({ baseUrl: "http://api.test", fetch: fetchImpl as unknown as typeof fetch });
  client.use({
    onRequest({ request }) {
      const tok = session.getAccessToken();
      if (tok) request.headers.set("Authorization", `Bearer ${tok}`);
      return request;
    },
  });
  client.use(authRetryMiddleware(session));
  return { session, refresh, calls, saved, client: client as unknown as { GET: (p: string) => Promise<{ data?: unknown; response: Response }>; POST: (p: string, o?: object) => Promise<{ data?: unknown; response: Response }> } };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const authorized = (token: string): Handler => (req) =>
  req.headers.get("Authorization") === `Bearer ${token}` ? json(200, { ok: true }) : json(401, { error: { code: "unauthorized", message: "", details: null } });

describe("auth refresh", () => {
  it("refreshes once on 401 and retries the request with the new token", async () => {
    const s = setup({ handler: authorized("new-rt1") });
    await s.session.hydrate();
    const res = await s.client.GET("/auth/me");
    expect(res.response.status).toBe(200);
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(s.refresh).toHaveBeenCalledWith("rt1");
    expect(s.calls).toEqual(["/auth/me Bearer old", "/auth/me Bearer new-rt1"]);
    expect(s.saved.at(-1)).toEqual({ accessToken: "new-rt1", refreshToken: "rt2-rt1" });
  });

  it("retries a POST body after refreshing", async () => {
    const bodies: string[] = [];
    const s = setup({
      handler: async (req) => {
        bodies.push(await req.clone().text());
        return authorized("new-rt1")(req);
      },
    });
    await s.session.hydrate();
    const res = await s.client.POST("/conversations", { body: { message: "hi" } });
    expect(res.response.status).toBe(200);
    expect(bodies).toEqual(['{"message":"hi"}', '{"message":"hi"}']);
  });

  it("shares one refresh between concurrent 401s (rotation-safe)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = setup({
      refresh: async (rt) => {
        await gate;
        return { accessToken: `new-${rt}`, refreshToken: `rt2-${rt}` };
      },
      handler: authorized("new-rt1"),
    });
    await s.session.hydrate();
    const all = Promise.all([s.client.GET("/a"), s.client.GET("/b"), s.client.GET("/c")]);
    await new Promise((r) => setTimeout(r, 10));
    release();
    const results = await all;
    expect(results.map((r) => r.response.status)).toEqual([200, 200, 200]);
    expect(s.refresh).toHaveBeenCalledTimes(1);
  });

  it("signs out when the refresh token is refused and returns the original 401", async () => {
    const s = setup({
      refresh: async () => {
        throw new Error("invalid_token");
      },
      handler: authorized("never"),
    });
    await s.session.hydrate();
    const events: string[] = [];
    s.session.subscribe((t, reason) => events.push(`${t ? "tokens" : "null"}:${reason}`));
    const res = await s.client.GET("/deals");
    expect(res.response.status).toBe(401);
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(s.session.getAccessToken()).toBeNull();
    expect(events).toEqual(["null:expired"]);
    expect(s.saved.at(-1)).toBeNull();
    expect(s.calls).toHaveLength(1);
  });

  it("does not refresh for auth endpoints or anonymous requests", async () => {
    const s = setup({ handler: () => json(401, { error: { code: "invalid_credentials", message: "", details: null } }) });
    await s.session.hydrate();
    await s.client.POST("/auth/login", { body: {} });
    expect(s.refresh).not.toHaveBeenCalled();
    await s.session.clear();
    await s.client.GET("/listings/favorites");
    expect(s.refresh).not.toHaveBeenCalled();
  });
});
