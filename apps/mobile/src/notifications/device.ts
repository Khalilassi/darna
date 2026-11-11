/**
 * Native side of push: permission, Expo push token, and (un)registration with the API.
 * Web and simulators never touch expo-notifications beyond reporting a status; the native modules are
 * required lazily so the web bundle does not run their side effects.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import type * as NotificationsNS from "expo-notifications";
import { api, unwrap } from "../api/client";
import { kv } from "../lib/storage";
import { devicePlatform, isValidPushToken, resolveProjectId, type PushStatus } from "./push";

type Notifications = typeof NotificationsNS;

const TOKEN_KEY = "darna.push.token.v1";
const PROMPTED_KEY = "darna.push.prompted.v1";

const notifications = (): Notifications => require("expo-notifications") as Notifications;
const isPhysicalDevice = (): boolean => (require("expo-device") as typeof import("expo-device")).isDevice;

export interface PushEnvironment {
  status?: PushStatus;
  projectId?: string;
  platform?: "ios" | "android";
}

/** What this build/device can do, before asking the OS anything. */
export function pushEnvironment(): PushEnvironment {
  const platform = devicePlatform(Platform.OS);
  if (!platform) return { status: "unsupported_web" };
  if (!isPhysicalDevice()) return { status: "unsupported_device" };
  const projectId = resolveProjectId(Constants.expoConfig?.extra, process.env.EXPO_PUBLIC_EAS_PROJECT_ID);
  if (!projectId) return { status: "not_configured" };
  return { projectId, platform };
}

let handlerSet = false;
/** Foreground presentation + Android channel. Safe to call repeatedly; no-op on web/simulators. */
export async function configurePush(): Promise<void> {
  if (pushEnvironment().status === "unsupported_web") return;
  const N = notifications();
  if (!handlerSet) {
    handlerSet = true;
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
  }
  if (Platform.OS === "android") {
    // Android 13+ only shows the permission prompt once a channel exists.
    await N.setNotificationChannelAsync("default", { name: "Darna", importance: N.AndroidImportance.DEFAULT }).catch(() => undefined);
  }
}

/**
 * Brings this device's registration up to date for the signed-in user.
 * `prompt`: "auto" asks the OS at most once ever (first sign-in); "explicit" asks when the OS still
 * allows it (user tapped "Enable"); "never" only reads the current permission. A denial is respected.
 */
export async function syncPushRegistration(prompt: "auto" | "explicit" | "never"): Promise<PushStatus> {
  const env = pushEnvironment();
  if (env.status) return env.status;
  try {
    await configurePush();
    const N = notifications();
    let perm = await N.getPermissionsAsync();
    if (perm.status === "undetermined" && prompt !== "never") {
      const alreadyPrompted = (await kv.get(PROMPTED_KEY)) === "1";
      if (prompt === "explicit" || !alreadyPrompted) {
        await kv.set(PROMPTED_KEY, "1");
        perm = await N.requestPermissionsAsync();
      }
    } else if (perm.status === "denied" && prompt === "explicit" && perm.canAskAgain) {
      perm = await N.requestPermissionsAsync();
    }
    if (perm.status !== "granted") return perm.status === "denied" ? "denied" : "undetermined";

    const { data: token } = await N.getExpoPushTokenAsync({ projectId: env.projectId });
    if (!isValidPushToken(token)) return "error";
    unwrap(await api.POST("/notifications/devices", { body: { token, platform: env.platform! } }));
    await kv.set(TOKEN_KEY, token);
    return "registered";
  } catch {
    return "error";
  }
}

/** Removes this device's token from the API. Call while still authenticated (before clearing tokens). */
export async function unregisterPushDevice(timeoutMs = 4000): Promise<void> {
  if (Platform.OS === "web") return;
  const token = await kv.get(TOKEN_KEY).catch(() => null);
  if (!token) return;
  const request = api.DELETE("/notifications/devices", { params: { query: { token } } }).catch(() => undefined);
  await Promise.race([request, new Promise((r) => setTimeout(r, timeoutMs))]);
  await kv.remove(TOKEN_KEY).catch(() => undefined);
}
