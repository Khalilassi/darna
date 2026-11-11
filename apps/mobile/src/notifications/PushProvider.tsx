import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useRouter, type Href } from "expo-router";
import type * as NotificationsNS from "expo-notifications";
import { useAuth } from "../auth/AuthProvider";
import { pushEnvironment, syncPushRegistration } from "./device";
import { pushDataToHref, type PushStatus } from "./push";

interface PushCtx {
  status: PushStatus;
  /** Re-checks permission and registration; "explicit" asks the OS when it still allows asking. */
  refresh(prompt?: "explicit" | "never"): Promise<void>;
}

const Ctx = createContext<PushCtx | null>(null);

/**
 * Registers the device for push after sign-in (asking for permission at most once automatically) and
 * deep-links notification taps. Must render inside AuthProvider and the router.
 */
export function PushProvider({ children }: { children: React.ReactNode }) {
  const { status: auth } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<PushStatus>("checking");

  useEffect(() => {
    if (auth === "loading") return;
    if (auth === "signedOut") {
      const env = pushEnvironment().status;
      setStatus(env ?? "signed_out");
      return;
    }
    let alive = true;
    void syncPushRegistration("auto").then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [auth]);

  const refresh = useCallback(async (prompt: "explicit" | "never" = "never") => {
    setStatus(await syncPushRegistration(prompt));
  }, []);

  // Deep links from tapped notifications (warm taps + the tap that launched the app).
  const handled = useRef(new Set<string>());
  useEffect(() => {
    if (Platform.OS === "web" || auth === "loading") return;
    const N = require("expo-notifications") as typeof NotificationsNS;
    const open = (r: NotificationsNS.NotificationResponse | null) => {
      if (!r || r.actionIdentifier !== N.DEFAULT_ACTION_IDENTIFIER) return;
      const id = r.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);
      const href = pushDataToHref(r.notification.request.content.data);
      if (href) router.push(href as Href);
    };
    void N.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const sub = N.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [auth, router]);

  const value = useMemo(() => ({ status, refresh }), [status, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePush(): PushCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePush must be used inside PushProvider");
  return v;
}
