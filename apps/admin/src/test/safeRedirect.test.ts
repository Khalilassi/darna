import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safeRedirect";

const O = "https://admin.darna.example";

describe("safeNextPath", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeNextPath("/listings?status=active#top", O)).toBe("/listings?status=active#top");
  });
  it.each(["//evil.example/x", "/\\evil.example/staff", "\\\\evil.example", "https://evil.example/", "http:evil.example", "javascript:alert(1)"])(
    "rejects off-site destination %s",
    (n) => expect(safeNextPath(n, O)).toBe("/"),
  );
  it("treats a same-scheme scheme-relative string as a local path (WHATWG URL rules)", () => {
    expect(safeNextPath("https:evil.example", O)).toBe("/evil.example");
  });
  it("defaults when missing", () => {
    expect(safeNextPath(null, O)).toBe("/");
    expect(safeNextPath("", O)).toBe("/");
  });
});
