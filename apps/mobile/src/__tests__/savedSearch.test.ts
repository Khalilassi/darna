import { ApiError } from "@darna/api-client";
import { errorMessage, lockoutMinutes } from "../api/errors";
import { i18next, initI18n } from "../i18n";
import { describeFilters, MAX_NAME, toSearchFilters } from "../lib/savedSearch";
import { emptyFilters } from "../state/filters";

describe("saved search names", () => {
  afterAll(() => initI18n("en"));
  const t = () => i18next.t.bind(i18next);

  it("derives a readable default name from the filters", () => {
    const f = emptyFilters({ project_id: "p", purpose: "sale", property_type: ["apartment"], bedrooms_min: 2, price_max: 5_000_000, payment_mode: "installments" });
    expect(describeFilters(f, t(), "en", { districtName: "B1" })).toMatch(/^For sale · Apartment · B1 · 2\+ beds · Up to EGP\s?5(\.0)?M · Installments$/);
  });

  it("falls back to 'All homes' and summarizes many property types", () => {
    expect(describeFilters(emptyFilters(), t(), "en")).toBe("All homes");
    expect(describeFilters(emptyFilters({ property_type: ["apartment", "villa", "duplex"], q: " garden " }), t(), "en")).toBe("3 types · “garden”");
    expect(describeFilters({ price_min: "2000000", price_max: "4000000", purpose: "rent" }, t(), "en")).toMatch(/^For rent · EGP\s?2(\.0)?M–EGP\s?4(\.0)?M$/);
  });

  it("keeps names within the API limit", () => {
    const long = describeFilters(emptyFilters({ q: "x".repeat(200) }), t(), "en");
    expect(long.length).toBeLessThanOrEqual(MAX_NAME);
    expect(long.endsWith("…")).toBe(true);
  });

  it("localizes names in Arabic", () => {
    initI18n("ar");
    expect(describeFilters(emptyFilters({ purpose: "rent", bedrooms_min: 3 }), t(), "ar")).toBe("للإيجار · ٣+ غرف");
    initI18n("en");
  });

  it("sends only set filters (no sort) to the API", () => {
    expect(toSearchFilters(emptyFilters({ project_id: "p", purpose: "sale", q: undefined, sort: "price_asc", property_type: ["villa"] }))).toEqual({
      project_id: "p",
      purpose: "sale",
      property_type: ["villa"],
    });
  });
});

describe("sign-in lockout message", () => {
  const t = i18next.t.bind(i18next);
  it("shows the minutes remaining, rounded up", () => {
    const err = new ApiError(429, "too_many_failed_logins", "locked", { retry_after_seconds: 610 });
    expect(lockoutMinutes(err)).toBe(11);
    expect(errorMessage(err, t)).toBe("Too many failed sign-in attempts. For your security, try again in 11 minutes.");
    expect(errorMessage(new ApiError(429, "too_many_failed_logins", "locked", { retry_after_seconds: 20 }), t)).toMatch(/in 1 minute\.$/);
    expect(errorMessage(new ApiError(429, "too_many_failed_logins", "locked"), t)).toMatch(/paused for a few minutes/);
  });
});
