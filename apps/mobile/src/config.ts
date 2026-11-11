import { Platform } from "react-native";

const DEFAULT_API = "http://localhost:8000";

/**
 * API base URL. Set EXPO_PUBLIC_API_URL to override. When it is not set and we run on the Android
 * emulator, `localhost` points at the emulator itself, so we default to the host alias 10.0.2.2.
 */
export function resolveApiUrl(envValue: string | undefined, os: string): string {
  const fromEnv = envValue?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return os === "android" ? "http://10.0.2.2:8000" : DEFAULT_API;
}

export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, Platform.OS);

/**
 * The API returns absolute media URLs built from its own public base URL (http://localhost:8000 in
 * development). When the app reaches the API through a different origin (e.g. 10.0.2.2 on the
 * Android emulator, or a LAN IP on a device), rewrite the origin so images still load.
 */
export function mediaUrl(url: string | null | undefined, apiUrl: string = API_URL): string | undefined {
  if (!url) return undefined;
  const m = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)$/.exec(url);
  if (m && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(apiUrl)) return apiUrl + m[3];
  return url;
}
