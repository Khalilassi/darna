import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavList } from "@/components/Shell";
import { can, isStaff, navForRole } from "@/lib/permissions";

const labels = (role: Parameters<typeof navForRole>[0]) => navForRole(role).map((i) => i.label);

describe("permission-based navigation", () => {
  it("reviewer sees verification and moderation only (no services directory)", () => {
    expect(labels("reviewer")).toEqual(["Dashboard", "Verification queue", "Listings moderation", "Account security"]);
    expect(labels("reviewer")).not.toContain("Service providers");
    expect(labels("reviewer")).not.toContain("Referral requests");
  });

  it("support sees deals, support cases and the services directory", () => {
    expect(labels("support")).toEqual([
      "Dashboard", "Deals monitor", "Support cases", "Service providers", "Referral requests", "Account security",
    ]);
  });

  it("admin sees everything", () => {
    expect(labels("admin")).toHaveLength(12);
    expect(labels("admin")).toContain("Audit log");
    expect(labels("admin")).toEqual(expect.arrayContaining(["Service providers", "Referral requests"]));
  });

  it("members and anonymous users get nothing", () => {
    expect(navForRole("member")).toEqual([]);
    expect(navForRole(null)).toEqual([]);
    expect(isStaff("member")).toBe(false);
    expect(isStaff("support")).toBe(true);
  });

  it("mirrors backend permissions for sensitive actions", () => {
    expect(can("reviewer", "user.manage")).toBe(false);
    expect(can("support", "verification.review")).toBe(false);
    expect(can("reviewer", "dispute.resolve")).toBe(false);
    expect(can("admin", "dispute.resolve")).toBe(true);
    // services.manage = {admin, support} in services/api/app/core/deps.py
    expect(can("admin", "services.manage")).toBe(true);
    expect(can("support", "services.manage")).toBe(true);
    expect(can("reviewer", "services.manage")).toBe(false);
    expect(can("member", "services.manage")).toBe(false);
  });

  it("renders the services links for support and marks the current page", () => {
    render(<NavList role="support" pathname="/services/referrals" />);
    expect(screen.getByRole("link", { name: "Service providers" })).toHaveAttribute("href", "/services/providers");
    expect(screen.getByRole("link", { name: "Referral requests" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Service providers" })).not.toHaveAttribute("aria-current");
  });

  it("renders only permitted links and marks the current page", () => {
    render(<NavList role="reviewer" pathname="/verifications" />);
    const list = screen.getByRole("list");
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Dashboard", "Verification queue", "Listings moderation", "Account security"]);
    expect(screen.getByRole("link", { name: "Verification queue" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Audit log" })).not.toBeInTheDocument();
  });
});
