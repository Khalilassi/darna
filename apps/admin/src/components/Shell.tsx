"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { brand } from "@darna/design-tokens";
import { useAuth } from "@/lib/auth";
import { navForRole, type Permission } from "@/lib/permissions";

export function NavList({ role, pathname }: { role: Parameters<typeof navForRole>[0]; pathname: string }) {
  const items = navForRole(role);
  return (
    <ul className="nav-list">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link href={item.href} aria-current={active ? "page" : undefined} className={active ? "nav-link active" : "nav-link"}>
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Authenticated console chrome; redirects to /login when there is no staff session. */
export function Shell({ children }: { children: ReactNode }) {
  const { status, me, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (status !== "authenticated" || !me)
    return (
      <div className="state" role="status" aria-busy="true">
        <span className="spinner" aria-hidden /> Checking your session…
      </div>
    );

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          {brand.name} <span className="brand-sub">Operations</span>
        </div>
        <nav aria-label="Main">
          <NavList role={me.role} pathname={pathname} />
        </nav>
        <div className="sidebar-footer">
          <div className="me">
            <strong>{me.full_name}</strong>
            <span className="muted">
              {me.email} · <span className="role">{me.role}</span>
            </span>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        {!me.mfa_enabled_at && pathname !== "/security" && (
          <div className="alert alert-warning mfa-banner" role="status">
            Two-factor authentication is off for your account.{" "}
            <Link href="/security" className="link">
              Set it up now
            </Link>
            .
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission))
    return (
      <div className="state state-error" role="alert">
        <strong>No access</strong>
        <span>Your role doesn&apos;t include the “{permission}” permission. Ask an administrator if you need it.</span>
      </div>
    );
  return <>{children}</>;
}
