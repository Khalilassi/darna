import { isValidPushToken, PUSH_CATEGORIES, pushDataToHref, resolveProjectId, devicePlatform } from "../notifications/push";
import en from "../i18n/en";
import ar from "../i18n/ar";

describe("push token validation", () => {
  it("accepts Expo push tokens in both historical formats", () => {
    expect(isValidPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isValidPushToken("ExpoPushToken[AbC_12-3]")).toBe(true);
  });
  it("rejects anything the API would refuse", () => {
    for (const bad of ["", "ExponentPushToken[]", "ExponentPushToken[a b]", "fcm:abc", "ExponentPushToken[abc]x", "xExpoPushToken[abc]", null, 42]) {
      expect(isValidPushToken(bad)).toBe(false);
    }
  });
});

describe("EAS project id", () => {
  it("prefers app config, then env, else null (push skipped)", () => {
    expect(resolveProjectId({ eas: { projectId: "cfg-id" } }, "env-id")).toBe("cfg-id");
    expect(resolveProjectId({ apiUrl: "x" }, "env-id")).toBe("env-id");
    expect(resolveProjectId(undefined, "  ")).toBeNull();
    expect(resolveProjectId(null, undefined)).toBeNull();
  });
  it("registers only iOS/Android", () => {
    expect(devicePlatform("ios")).toBe("ios");
    expect(devicePlatform("android")).toBe("android");
    expect(devicePlatform("web")).toBeNull();
  });
});

describe("push data → route", () => {
  const id = "3f1c2a9e-7b1d-4c55-9a7e-0c8f5d2b1e44";
  it("maps each id to the existing screen", () => {
    expect(pushDataToHref({ type: "new_message", conversation_id: id })).toBe(`/conversation/${id}`);
    expect(pushDataToHref({ type: "offer_received", deal_id: id })).toBe(`/deal/${id}`);
    expect(pushDataToHref({ type: "viewing_requested", viewing_id: id })).toBe("/viewings");
    expect(pushDataToHref({ type: "listing_approved", listing_id: id })).toBe(`/owner/listing/${id}`);
    expect(pushDataToHref({ type: "price_drop", listing_id: id })).toBe(`/listing/${id}`);
    expect(pushDataToHref({ type: "ownership_claim_approved", property_id: id })).toBe("/owner");
    expect(pushDataToHref({ type: "verification_approved", verification_id: id })).toBe("/owner");
    expect(pushDataToHref({ type: "support_case_updated", case_id: id })).toBe("/support");
  });
  it("opens a saved search's results for saved-search alerts", () => {
    expect(pushDataToHref({ type: "saved_search_match", saved_search_id: id, count: 3 })).toBe(`/saved-searches/${id}`);
    expect(pushDataToHref({ type: "saved_search_match", saved_search_id: "../x" })).toBe("/saved-searches");
    expect(pushDataToHref({ type: "saved_search_match" })).toBe("/saved-searches");
  });
  it("sends an account-lock security notice to the notifications list", () => {
    expect(pushDataToHref({ type: "account_locked" })).toBe("/notifications");
  });
  it("lists the alerts category before support", () => {
    expect(PUSH_CATEGORIES).toContain("alerts");
    expect(PUSH_CATEGORIES.indexOf("alerts")).toBeLessThan(PUSH_CATEGORIES.indexOf("support"));
  });
  it("prefers the conversation for message pushes that also carry a deal", () => {
    expect(pushDataToHref({ type: "new_message", conversation_id: "c1", deal_id: "d1" })).toBe("/conversation/c1");
  });
  it("ignores malformed or hostile data", () => {
    expect(pushDataToHref(null)).toBeNull();
    expect(pushDataToHref("deal")).toBeNull();
    expect(pushDataToHref({ type: "x" })).toBeNull();
    expect(pushDataToHref({ deal_id: "../../admin" })).toBeNull();
    expect(pushDataToHref({ conversation_id: 12 })).toBeNull();
    expect(pushDataToHref({ deal_id: "https://evil.example" })).toBeNull();
  });
});

describe("notification preference labels", () => {
  it("has a label and description for every category in both languages", () => {
    for (const c of PUSH_CATEGORIES) {
      expect(en.notifPrefs.categories[c].label).toBeTruthy();
      expect(en.notifPrefs.categories[c].description).toBeTruthy();
      expect(ar.notifPrefs.categories[c].label).toBeTruthy();
      expect(ar.notifPrefs.categories[c].description).toBeTruthy();
    }
  });
});
