import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, session, toTokens, unwrap, type Schemas } from "../api/client";

type Status = "loading" | "signedOut" | "signedIn";

export interface RegisterInput {
  email: string;
  password: string;
  full_name: string;
  phone?: string | null;
  locale: "en" | "ar";
  attest_not_broker: boolean;
}

interface AuthCtx {
  status: Status;
  me: Schemas["MeDetailOut"] | undefined;
  /** Set when the session ended because the refresh token was refused. */
  expired: boolean;
  signIn(email: string, password: string): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  signOut(): Promise<void>;
  refreshMe(): Promise<unknown>;
}

const Ctx = createContext<AuthCtx | null>(null);

export const meQueryKey = ["me"] as const;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let alive = true;
    void session.hydrate().then((t) => alive && setStatus(t ? "signedIn" : "signedOut"));
    const unsub = session.subscribe((tokens, reason) => {
      if (!tokens) {
        setStatus("signedOut");
        setExpired(reason === "expired");
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "public" });
      } else if (reason === "signin") {
        setExpired(false);
        setStatus("signedIn");
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [qc]);

  const meQuery = useQuery({
    queryKey: meQueryKey,
    enabled: status === "signedIn",
    queryFn: async () => unwrap(await api.GET("/auth/me")),
  });

  const signIn = useCallback(async (email: string, password: string) => {
    const t = unwrap(await api.POST("/auth/login", { body: { email: email.trim(), password } }));
    await session.setTokens(toTokens(t));
    await qc.invalidateQueries();
  }, [qc]);

  const register = useCallback(async (input: RegisterInput) => {
    const t = unwrap(await api.POST("/auth/register", { body: { ...input, email: input.email.trim() } }));
    await session.setTokens(toTokens(t));
  }, []);

  const signOut = useCallback(async () => {
    const rt = session.getRefreshToken();
    if (rt) await api.POST("/auth/logout", { body: { refresh_token: rt } }).catch(() => undefined);
    await session.clear("signout");
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthCtx>(
    () => ({ status, me: meQuery.data, expired, signIn, register, signOut, refreshMe: () => meQuery.refetch() }),
    [status, meQuery.data, expired, signIn, register, signOut, meQuery],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
