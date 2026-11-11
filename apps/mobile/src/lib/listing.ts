import type { Schemas } from "@darna/api-client";

type Action = Schemas["ActionIn"]["action"];

/**
 * Owner actions derived from the API's `allowed_transitions` (never hard-coded per status):
 * submit -> pending_review (from draft/rejected), pause -> paused, resume (paused -> active/pending_review), withdraw -> withdrawn.
 */
export function ownerActions(l: Pick<Schemas["OwnerListingOut"], "status" | "allowed_transitions">): Action[] {
  const can = (s: string) => l.allowed_transitions.includes(s);
  const out: Action[] = [];
  if (l.status === "paused" && (can("active") || can("pending_review"))) out.push("resume");
  else if (can("pending_review")) out.push("submit");
  if (can("paused")) out.push("pause");
  if (can("withdrawn")) out.push("withdraw");
  return out;
}
