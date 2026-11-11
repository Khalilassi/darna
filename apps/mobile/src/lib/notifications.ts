import type { Schemas } from "@darna/api-client";

/** Where tapping a notification leads, based on the ids in its data. */
export function notificationHref(n: Pick<Schemas["NotificationOut"], "type" | "data">): string | null {
  const d = n.data as Record<string, string>;
  if (d.deal_id) return `/deal/${d.deal_id}`;
  if (d.conversation_id) return `/conversation/${d.conversation_id}`;
  if (d.viewing_id) return "/viewings";
  if (d.listing_id) return `/owner/listing/${d.listing_id}`;
  if (d.property_id || n.type.startsWith("ownership") || n.type.startsWith("verification")) return "/owner";
  if (n.type.startsWith("support")) return "/support";
  return null;
}
