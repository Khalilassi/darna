import type { Schemas } from "@darna/api-client";

export type Role = Schemas["Role"];
export type StaffRole = Exclude<Role, "member">;

/** Mirrors services/api/app/core/deps.py PERMISSIONS. Keep in sync with the backend. */
export const PERMISSIONS = {
  "verification.review": ["admin", "reviewer"],
  "listing.moderate": ["admin", "reviewer"],
  "dispute.resolve": ["admin"],
  "user.manage": ["admin"],
  "support.handle": ["admin", "support"],
  "audit.read": ["admin"],
  "analytics.read": ["admin", "reviewer", "support"],
  "deal.monitor": ["admin", "support"],
  "document.review": ["admin", "reviewer"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export const STAFF_ROLES: readonly StaffRole[] = ["admin", "reviewer", "support"];

export function isStaff(role: Role | null | undefined): role is StaffRole {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

export interface NavItem {
  href: string;
  label: string;
  permission: Permission;
}

export const NAV: readonly NavItem[] = [
  { href: "/", label: "Dashboard", permission: "analytics.read" },
  { href: "/verifications", label: "Verification queue", permission: "verification.review" },
  { href: "/listings", label: "Listings moderation", permission: "listing.moderate" },
  { href: "/disputes", label: "Disputes", permission: "dispute.resolve" },
  { href: "/duplicates", label: "Duplicate candidates", permission: "dispute.resolve" },
  { href: "/users", label: "Users", permission: "user.manage" },
  { href: "/deals", label: "Deals monitor", permission: "deal.monitor" },
  { href: "/support", label: "Support cases", permission: "support.handle" },
  { href: "/audit", label: "Audit log", permission: "audit.read" },
];

export function navForRole(role: Role | null | undefined): NavItem[] {
  return NAV.filter((item) => can(role, item.permission));
}
