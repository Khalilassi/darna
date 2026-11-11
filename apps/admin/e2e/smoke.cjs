/* Live smoke test: drives the running admin console (port 3001) against the dev API (port 8000).
 * Seeds one identity verification (registers a throwaway member in the DEV database), then signs in as the reviewer,
 * opens the document via signed URL and approves it. Along the way it runs axe-core (WCAG 2.1 A + AA) on the main
 * page types at desktop and 768px widths, failing on any serious/critical violation, and checks dialog focus
 * management and keyboard sign-in (visible focus, skip link). Usage: node e2e/smoke.cjs  */
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

// Accessibility: axe-core (WCAG 2.1 A + AA). Serious/critical violations fail the run; moderate/minor are printed only.
const AXE_PATH = require.resolve("axe-core/axe.min.js");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const NARROW = { width: 768, height: 1024 };
const a11yCounts = { checked: 0, blocking: 0 };
async function axeRun(page) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(
    (tags) =>
      window.axe.run(document, { runOnly: { type: "tag", values: tags } }).then((r) =>
        r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary })) })),
      ),
    AXE_TAGS,
  );
}
/** Audits the page as it is now, at the current (desktop) viewport and at 768px, then restores the viewport. */
async function a11y(page, label) {
  const desktop = page.viewportSize();
  for (const [vp, size] of [["desktop", desktop], ["768px", NARROW]]) {
    if (size !== desktop) await page.setViewportSize(size);
    await page.waitForTimeout(150); // let layout settle after a resize / state change
    const violations = await axeRun(page);
    const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    for (const v of violations) {
      const n = v.nodes[0];
      const why = n.failureSummary.split("\n").slice(1, 2).join("").trim();
      console.log(`  axe ${v.impact.padEnd(8)} ${v.id} ×${v.nodes.length} on ${label} @ ${vp} — e.g. ${n.target.join(" ")}: ${why}`);
    }
    a11yCounts.checked += 1;
    a11yCounts.blocking += blocking.reduce((sum, v) => sum + v.nodes.length, 0);
    check(`a11y: no serious/critical axe violations: ${label} @ ${vp}`, blocking.length === 0, blocking.map((v) => `${v.id}×${v.nodes.length}`).join(", "));
  }
  await page.setViewportSize(desktop);
}
/** Describes the focused element and whether it shows a visible focus indicator (>=2px outline via :focus-visible). */
const focusInfo = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: "BODY", text: "", id: "", visible: false, inDialog: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2;
    return {
      tag: el.tagName,
      id: el.id,
      text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 60),
      visible: outline && r.width > 0 && r.height > 0 && el.matches(":focus-visible"),
      inDialog: !!el.closest('[role="dialog"]'),
    };
  });

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
  await page.getByRole("button", { name: "Sign in" }).waitFor();
  await a11y(page, "login");
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
  await a11y(page, "dashboard");

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
  await a11y(page, "verification queue + detail");

  // Confirm dialog: opened from the keyboard, focus moves inside; Escape closes it and focus returns to the trigger.
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await approve.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  const inDialog = await focusInfo(page);
  check("dialog: focus moves into the confirm dialog", inDialog.inDialog && inDialog.visible, `${inDialog.tag} "${inDialog.text}"`);
  await a11y(page, "confirm dialog");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  const returned = await focusInfo(page);
  check(
    "dialog: Escape closes it and focus returns to the trigger",
    (await page.getByRole("dialog").count()) === 0 && returned.text === "Approve" && returned.visible,
    `${returned.tag} "${returned.text}"`,
  );

  await approve.click();
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
  await a11y(page, "listings moderation");

  // Account security with the setup step open. Setup is started but never confirmed, so MFA stays off.
  await page.getByRole("link", { name: "Account security" }).click();
  await page.getByRole("heading", { name: "Account security" }).waitFor();
  const setupButton = page.getByRole("button", { name: "Set up two-factor authentication" });
  if (await setupButton.count()) {
    await page.getByLabel("Confirm your password").fill(PASSWORD);
    await setupButton.click();
    await page.getByLabel(/6-digit code/).waitFor();
    await a11y(page, "account security (setup step)");
    await page.getByRole("button", { name: "Cancel" }).click();
  } else {
    await a11y(page, "account security (MFA already on)");
  }

  // Permission handling for pages outside the role.
  await page.goto(ADMIN + "/users");
  await page.getByText("No access").waitFor();
  check("reviewer blocked from /users with No access state", true);

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  // Keyboard-only sign-in as support (services.manage): Tab from the login form to a signed-in page. Every stop must
  // show a visible focus indicator, and the skip link must be the first stop and move focus to <main>.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await page.goto(ADMIN + "/login"); // drop any ?next=/users so support lands on the dashboard
  await page.getByLabel("Email").waitFor();
  const kb = [];
  await page.keyboard.press("Tab");
  kb.push(await focusInfo(page));
  await page.keyboard.type("support@example.com");
  await page.keyboard.press("Tab");
  kb.push(await focusInfo(page));
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press("Tab");
  kb.push(await focusInfo(page));
  check(
    "keyboard: Tab order email → password → Sign in, focus visible on each",
    kb.map((f) => f.id || f.text).join(",") === "email,password,Sign in" && kb.every((f) => f.visible),
    kb.map((f) => `${f.id || f.text}${f.visible ? "" : " (no visible focus)"}`).join(" → "),
  );
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await page.locator(".stat-value").first().waitFor();
  await page.keyboard.press("Tab");
  const skip = await focusInfo(page);
  check("keyboard: first Tab on a signed-in page reaches the visible skip link", skip.text === "Skip to content" && skip.visible, `${skip.tag} "${skip.text}"`);
  await page.keyboard.press("Enter");
  check("keyboard: skip link moves focus to main", (await page.evaluate(() => document.activeElement?.id)) === "main");
  await page.keyboard.press("Tab");
  const afterSkip = await focusInfo(page);
  check("keyboard: Tab after the skip link continues inside main, focus visible", afterSkip.visible && (await page.evaluate(() => !!document.activeElement?.closest("main"))), `${afterSkip.tag} "${afterSkip.text}"`);

  // Service providers with the create form open (modal), as support.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Service providers" }).click();
  await page.getByRole("heading", { name: "Service providers" }).waitFor();
  await page.locator("table, .state-empty").first().waitFor();
  await page.getByRole("button", { name: "Add provider" }).click();
  await page.getByRole("dialog", { name: "Add service provider" }).waitFor();
  check("dialog: focus moves into the provider form", (await focusInfo(page)).inDialog);
  await a11y(page, "service providers (create form open)");
  await page.keyboard.press("Escape");
  check("dialog: Escape closes the provider form", (await page.getByRole("dialog").count()) === 0);

  console.log(`a11y: ${a11yCounts.checked} axe runs, ${a11yCounts.blocking} serious/critical violation node(s)`);
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
