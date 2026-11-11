/**
 * Pure push-notification helpers (no native modules): token validation, project id resolution,
 * notification data -> app route mapping, and the status model shown in settings. Unit-tested.
 */

/** Same rule as the API (`POST /notifications/devices`). */
export const PUSH_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;
export const isValidPushToken = (token: unknown): token is string => typeof token === "string" && PUSH_TOKEN_RE.test(token);

/** Push categories the API accepts in `/notifications/preferences` (display order). */
export const PUSH_CATEGORIES = ["messages", "offers", "deals", "viewings", "verification", "listings", "support"] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/**
 * Status of push on this device:
 * - unsupported_web / unsupported_device: web build or simulator/emulator; nothing is registered
 * - not_configured: no EAS project id in this build, so no Expo push token can be requested
 * - undetermined: the OS has not been asked yet; denied: the user said no (we never re-prompt)
 * - registered: token sent to the API; error: permission granted but token/registration failed
 */
export type PushStatus =
  | "checking"
  | "signed_out"
  | "unsupported_web"
  | "unsupported_device"
  | "not_configured"
  | "undetermined"
  | "denied"
  | "registered"
  | "error";

/** EAS project id from app config (`extra.eas.projectId`) or `EXPO_PUBLIC_EAS_PROJECT_ID`; null when absent. */
export function resolveProjectId(extra: unknown, envValue: string | undefined): string | null {
  const fromConfig = (extra as { eas?: { projectId?: unknown } } | null | undefined)?.eas?.projectId;
  const id = typeof fromConfig === "string" && fromConfig.trim() ? fromConfig.trim() : envValue?.trim();
  return id ? id : null;
}

export const devicePlatform = (os: string): "ios" | "android" | null => (os === "ios" || os === "android" ? os : null);

/** Ids in push data are opaque UUIDs; anything else is ignored so data cannot steer to arbitrary paths. */
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const idOf = (data: Record<string, unknown>, key: string): string | null => {
  const v = data[key];
  return typeof v === "string" && ID_RE.test(v) ? v : null;
};

/**
 * Route for a tapped push, from its `data` ({type, ...*_id}). Messages go to the chat, deal events to
 * the deal workspace, viewing events to the viewings list, listing events (approved / rejected /
 * suspended are sent to the owner) to the owner's listing management screen.
 */
export function pushDataToHref(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const type = typeof data.type === "string" ? data.type : "";
  const conversation = idOf(data, "conversation_id");
  if (conversation) return `/conversation/${conversation}`;
  const deal = idOf(data, "deal_id");
  if (deal) return `/deal/${deal}`;
  if (idOf(data, "viewing_id")) return "/viewings";
  const listing = idOf(data, "listing_id");
  if (listing) return type.startsWith("listing_") ? `/owner/listing/${listing}` : `/listing/${listing}`;
  if (idOf(data, "property_id") || idOf(data, "verification_id") || type.startsWith("ownership") || type.startsWith("verification")) return "/owner";
  if (idOf(data, "case_id") || type.startsWith("support")) return "/support";
  return null;
}
