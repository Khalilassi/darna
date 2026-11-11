/* Live smoke test: drives the running admin console (port 3001) against the dev API (port 8000).
 * Seeds one identity verification (registers a throwaway member in the DEV database), then signs in as the reviewer,
 * opens the document via signed URL and approves it. Usage: node e2e/smoke.cjs  */
const { chromium } = require("playwright");
const path = require("node:path");

const API = process.env.API_URL || "http://localhost:8000";
const ADMIN = process.env.ADMIN_URL || "http://localhost:3001";
// CI sets E2E_SCREENSHOT_DIR to a temp folder so runs never overwrite the committed screenshots.
const SHOTS = process.env.E2E_SCREENSHOT_DIR || path.join(__dirname, "..", "docs", "screenshots");
require("node:fs").mkdirSync(SHOTS, { recursive: true });
const PASSWORD = "Demo-pass-2026";

async function api(method, p, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers["Content-Type"] = "application/json";
  const res = await fetch(API + p, { method, headers, body: json ? JSON.stringify(json) : form });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function seedIdentityVerification() {
  const email = `e2e-owner-${Date.now()}@example.com`;
  const { access_token } = await api("POST", "/auth/register", {
    json: { email, password: PASSWORD, full_name: "E2E Test Owner", locale: "en", attest_not_broker: true },
  });
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const form = new FormData();
  form.append("kind", "national_id");
  form.append("file", new Blob([pdf], { type: "application/pdf" }), "e2e-national-id.pdf");
  const doc = await api("POST", "/documents", { token: access_token, form });
  const vr = await api("POST", "/verifications/identity", { token: access_token, json: { document_ids: [doc.id], note: "E2E smoke test" } });
  return { email, vrId: vr.id };
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

(async () => {
  const seeded = await seedIdentityVerification();
  console.log(`seeded identity verification ${seeded.vrId.slice(0, 8)} for ${seeded.email}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

  // Member accounts are rejected.
  await page.goto(ADMIN + "/");
  await page.waitForURL(/\/login/);
  await page.getByLabel("Email").fill("buyer@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  const alert = await page.locator(".alert-danger").textContent();
  check("member account rejected", /staff only/i.test(alert ?? ""), alert ?? "");

  // Reviewer login.
  await page.getByLabel("Email").fill("reviewer@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  const nav = await page.getByRole("navigation", { name: "Main" }).getByRole("link").allTextContents();
  check("reviewer nav filtered", JSON.stringify(nav) === JSON.stringify(["Dashboard", "Verification queue", "Listings moderation", "Account security"]), nav.join(", "));
  await page.locator(".stat-value").first().waitFor();
  check("dashboard analytics loaded", (await page.locator(".stat").count()) >= 7);
  const stored = await page.evaluate(() => ({ session: Object.keys(sessionStorage), local: Object.keys(localStorage) }));
  check("tokens in sessionStorage only", stored.session.includes("darna.admin.session") && stored.local.length === 0, JSON.stringify(stored));

  // Verification queue.
  await page.getByRole("link", { name: "Verification queue" }).click();
  await page.getByRole("heading", { name: "Verification queue" }).waitFor();
  const row = page.getByRole("button", { name: "E2E Test Owner" }).last();
  await row.waitFor();
  check("verification queue loads with seeded item", true);
  await row.click();
  await page.getByRole("heading", { name: /identity verification/ }).waitFor();

  // Document via signed URL in a new tab.
  const docRequest = context.waitForEvent("request", { predicate: (r) => /\/documents\/.+\/content\?token=/.test(r.url()), timeout: 10000 });
  const [popup] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: /Open document/ }).click()]);
  const signed = (await docRequest).url();
  const docRes = await context.request.get(signed);
  check(
    "document opens via signed URL in new tab",
    docRes.status() === 200 && /pdf/.test(docRes.headers()["content-type"] ?? ""),
    `${docRes.status()} ${docRes.headers()["content-type"]}`,
  );
  await popup.close().catch(() => {});

  await page.getByLabel(/Reviewer note/).fill("Checked against national ID (e2e).");
  await page.screenshot({ path: path.join(SHOTS, "verification-queue.png") });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Confirm: Approve" }).click();
  await page.getByText("Decision “approve” recorded.").waitFor();
  check("approve decision recorded (toast)", true);
  await page.getByRole("button", { name: "E2E Test Owner" }).last().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

  // Listings moderation.
  await page.getByRole("link", { name: "Listings moderation" }).click();
  await page.getByRole("heading", { name: "Listings moderation" }).waitFor();
  await page.locator("table, .state-empty").first().waitFor();
  const empty = await page.locator(".state-empty").count();
  check("listings page loads (pending_review filter)", true, empty ? "empty state shown" : `${await page.locator("tbody tr").count()} rows`);
  await page.getByLabel("Status").selectOption("active");
  await page.locator("tbody tr").first().waitFor();
  check("listings filter: active", (await page.locator("tbody tr").count()) > 0, `${await page.locator("tbody tr").count()} rows`);
  await page.screenshot({ path: path.join(SHOTS, "listings-moderation.png") });

  // Permission handling for pages outside the role.
  await page.goto(ADMIN + "/users");
  await page.getByText("No access").waitFor();
  check("reviewer blocked from /users with No access state", true);

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  await browser.close();

  // Confirm on the API that the approval landed.
  const { access_token } = await api("POST", "/auth/login", { json: { email: seeded.email, password: PASSWORD } });
  const me = await api("GET", "/auth/me", { token: access_token });
  check("API confirms identity verified", !!me.identity_verified_at && me.verification.identity === "approved", me.verification.identity);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
