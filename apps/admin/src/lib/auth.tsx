"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { makeAdminApi, type AdminApi } from "./adminApi";
import { can, type Permission } from "./permissions";
import { Session, type Me } from "./session";

type Status = "loading" | "anonymous" | "authenticated";

interface AuthContextValue {
  status: Status;
  me: Me | null;
  api: AdminApi;
  login: (email: string, password: string, totpCode?: string) => Promise<Me>;
  logout: () => Promise<void>;
  /** Re-reads /auth/me (e.g. after enabling two-factor authentication). */
  refreshMe: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<Session | null>(null);
  if (!sessionRef.current) sessionRef.current = new Session();
  const session = sessionRef.current;
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    session.onExpired = () => {
      setMe(null);
      setStatus("anonymous");
    };
    if (!session.restore()) {
      setStatus("anonymous");
      return;
    }
    session
      .me()
      .then((m) => {
        setMe(m);
        setStatus("authenticated");
      })
      .catch(() => {
        void session.logout();
        setStatus("anonymous");
      });
  }, [session]);

  const login = useCallback(
    async (email: string, password: string, totpCode?: string) => {
      const m = await session.login(email, password, totpCode);
      setMe(m);
      setStatus("authenticated");
      return m;
    },
    [session],
  );

  const logout = useCallback(async () => {
    await session.logout();
    setMe(null);
    setStatus("anonymous");
  }, [session]);

  const refreshMe = useCallback(async () => {
    setMe(await session.me());
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, me, api: makeAdminApi(session.call), login, logout, refreshMe, can: (p) => can(me?.role, p) }),
    [status, me, session, login, logout, refreshMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Test/storybook helper: provide a fixed user and API implementation. */
export function MockAuthProvider({
  me, api, children, status = "authenticated", login, refreshMe,
}: {
  me: Me | null;
  api: Partial<AdminApi>;
  children: ReactNode;
  status?: Status;
  login?: AuthContextValue["login"];
  refreshMe?: AuthContextValue["refreshMe"];
}) {
  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      api: api as AdminApi,
      login: login ?? (async () => me as Me),
      logout: async () => {},
      refreshMe: refreshMe ?? (async () => {}),
      can: (p) => can(me?.role, p),
    }),
    [me, api, status, login, refreshMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function useApi(): AdminApi {
  return useAuth().api;
}
