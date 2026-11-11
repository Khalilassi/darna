import type { Schemas } from "@darna/api-client";
import type { BadgeTone } from "../components/Badge";

export const LISTING_TONE: Record<Schemas["ListingStatus"], BadgeTone> = {
  draft: "neutral", pending_review: "info", active: "success", under_offer: "warning", paused: "neutral",
  suspended: "danger", rejected: "danger", withdrawn: "neutral", sold: "verified", rented: "verified",
};
export const CLAIM_TONE: Record<Schemas["ClaimStatus"], BadgeTone> = {
  submitted: "info", under_review: "info", approved: "success", rejected: "danger", disputed: "warning", revoked: "danger", superseded: "neutral", withdrawn: "neutral",
};
