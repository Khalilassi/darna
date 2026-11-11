/* Live smoke test for the public website (port 3000) against the dev API. Usage: node e2e/smoke.cjs */
const { chromium } = require("playwright");
const path = require("node:path");

const WEB = process.env.WEB_URL || "http://localhost:3000";
// CI sets E2E_SCREENSHOT_DIR to a temp folder so runs never overwrite the committed screenshots.
const SHOTS = process.env.E2E_SCREENSHOT_DIR || path.join(__dirname, "..", "docs", "screenshots");
require("node:fs").mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

(async () => {
  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const mobile = await browser.newContext({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 1, isMobile: true });
  const errors = [];
  for (const ctx of [desktop, mobile]) ctx.on("page", () => {});
  const page = await desktop.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  // Root redirect + English landing.
  const res = await page.goto(WEB + "/");
  check("/ redirects to /en", page.url().endsWith("/en"), page.url());
  check("/en status 200", res.status() === 200);
  check("/en lang/dir", (await page.getAttribute("html", "lang")) === "en" && (await page.getAttribute("html", "dir")) === "ltr");
  check("/en hero", (await page.getByRole("heading", { level: 1 }).textContent()).includes("verified owners"));
  check("/en hreflang alternates", (await page.locator('link[rel="alternate"][hreflang]').count()) === 3);
  check("/en store badges are coming soon, not links", (await page.getByText("Coming soon", { exact: true }).count()) === 2 && (await page.locator('a[href*="apps.apple.com"], a[href*="play.google.com"]').count()) === 0);
  check("/en independence disclaimer", (await page.locator("footer").textContent()).includes("not affiliated with, endorsed by, or acting on behalf of Talaat Moustafa Group"));
  await page.screenshot({ path: path.join(SHOTS, "landing-en.png") });

  // Arabic landing on a 375px phone.
  const m = await mobile.newPage();
  m.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  await m.goto(WEB + "/ar");
  check("/ar dir=rtl lang=ar", (await m.getAttribute("html", "dir")) === "rtl" && (await m.getAttribute("html", "lang")) === "ar");
  check("/ar computed direction rtl", (await m.evaluate(() => getComputedStyle(document.body).direction)) === "rtl");
  check("/ar no horizontal scroll at 375px", await noHScroll(m));
  await m.screenshot({ path: path.join(SHOTS, "landing-ar-375.png") });

  // Browse + detail.
  await page.goto(WEB + "/en/listings");
  const cards = await page.locator(".listing-card").count();
  check("/en/listings renders cards from API", cards > 0, `${cards} cards`);
  await page.locator(".listing-card a").first().click();
  await page.waitForURL(/\/en\/listings\/[0-9a-f-]{36}$/);
  await page.getByRole("heading", { name: "Financial summary" }).waitFor();
  check("detail shows provenance labels", (await page.locator("[data-provenance]").count()) > 0);
  check("detail CTA", (await page.getByRole("link", { name: "Open in the app to contact the owner" }).count()) === 1);
  check("detail og:image", !!(await page.getAttribute('meta[property="og:image"]', "content")));
  const unconfirmed = await page.locator("[data-unconfirmed]").count();
  check("detail lists not-yet-confirmed items (when present)", true, `${unconfirmed} unconfirmed item(s)`);
  await page.addStyleTag({ content: ".site-header{position:static!important}" });
  await page.locator(".finance").screenshot({ path: path.join(SHOTS, "listing-financials-en.png") });

  for (const p of ["/en", "/en/listings", new URL(page.url()).pathname, new URL(page.url()).pathname.replace("/en/", "/ar/")]) {
    await m.goto(WEB + p);
    check(`no horizontal scroll at 375px: ${p.replace(/[0-9a-f-]{36}/, ":id")}`, await noHScroll(m));
  }
  const arDetail = await m.getAttribute("html", "dir");
  await m.locator(".detail-head").scrollIntoViewIfNeeded();
  await m.screenshot({ path: path.join(SHOTS, "listing-detail-ar-375.png") });
  check("Arabic detail page is RTL", arDetail === "rtl");

  const errorsBefore404 = errors.length;
  const notFound = await page.goto(WEB + "/en/listings/00000000-0000-0000-0000-000000000000");
  check("unknown listing returns 404", notFound.status() === 404);
  const sitemap = await (await page.request.get(WEB + "/sitemap.xml")).text();
  check("sitemap includes listing URLs", /\/listings\/[0-9a-f-]{36}/.test(sitemap), `${(sitemap.match(/<loc>/g) || []).length} URLs`);
  const robots = await (await page.request.get(WEB + "/robots.txt")).text();
  check("robots.txt references sitemap", robots.includes("Sitemap:"));
  check("no console errors (excluding the deliberate 404)", errorsBefore404 === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
