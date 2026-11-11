import { afterEach, describe, expect, it, vi } from "vitest";
import { NotStaffError, Session } from "@/lib/session";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const me = (role: string) => ({
  id: "u1", email: "x@example.com", full_name: "X", phone: null, locale: "en", role, identity_verified_at: null, created_at: "2026-01-01T00:00:00Z",
  verification: { information_submitted: false, identity: "none", approved_ownership_claims: 0, pending_ownership_claims: 0 },
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

function stubFetch(handler: (url: string, req: Request) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const req = input instanceof Request ? input : new Request(String(input));
    return handler(new URL(req.url).pathname, req);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("Session", () => {
  it("rejects member accounts and revokes their tokens", async () => {
    const fetchMock = stubFetch((path) => {
      if (path === "/auth/login") return json({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 900 });
      if (path === "/auth/me") return json(me("member"));
      if (path === "/auth/logout") return json({ ok: true });
      return json({}, 404);
    });
    const s = new Session("http://api.test");
    await expect(s.login("buyer@example.com", "pw")).rejects.toBeInstanceOf(NotStaffError);
    expect(fetchMock.mock.calls.map((c) => new URL((c[0] as Request).url).pathname)).toContain("/auth/logout");
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("stores staff tokens in sessionStorage (never localStorage) and refreshes once on 401", async () => {
    let meCalls = 0;
    stubFetch((path, req) => {
      if (path === "/auth/login") return json({ access_token: "a1", refresh_token: "r1", token_type: "bearer", expires_in: 900 });
      if (path === "/auth/refresh") return json({ access_token: "a2", refresh_token: "r2", token_type: "bearer", expires_in: 900 });
      if (path === "/auth/me") {
        meCalls++;
        if (meCalls === 2 && req.headers.get("Authorization") === "Bearer a1") return json({ error: { code: "token_expired", message: "expired" } }, 401);
        return json(me("reviewer"));
      }
      return json({}, 404);
    });
    const s = new Session("http://api.test");
    await s.login("reviewer@example.com", "pw");
    expect(JSON.parse(sessionStorage.getItem("darna.admin.session")!)).toMatchObject({ access_token: "a1" });
    expect(localStorage.length).toBe(0);
    const again = await s.me();
    expect(again.role).toBe("reviewer");
    expect(JSON.parse(sessionStorage.getItem("darna.admin.session")!)).toMatchObject({ access_token: "a2", refresh_token: "r2" });
  });
});
