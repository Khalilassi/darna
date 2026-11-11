import type { TFunction } from "i18next";
import type { Schemas } from "@darna/api-client";

type DealKind = Schemas["DealKind"];
type DealStatus = Schemas["DealStatus"];

/**
 * Display order of milestones for the progress stepper. This is presentation only: which moves are
 * possible right now always comes from the API's `next_steps` / `can_cancel`.
 */
export const DEAL_TRACK: Record<DealKind, DealStatus[]> = {
  sale: ["negotiating", "offer_accepted", "due_diligence", "contract_preparation", "contract_signed", "developer_transfer", "completed"],
  rent: ["negotiating", "terms_agreed", "lease_preparation", "lease_signed", "handover_scheduled", "lease_active", "completed"],
};

/** "buyer" is shown as "tenant" in rental deals. */
export function roleLabel(role: string, kind: DealKind, t: TFunction): string {
  const tr = t as unknown as (k: string) => string;
  if (role === "buyer" && kind === "rent") return tr("enum.role.tenant");
  return tr(`enum.role.${role}`);
}

/** Document kind to upload for a checklist code. */
export const CHECKLIST_DOC_KIND: Record<string, Schemas["DocumentKind"]> = {
  ownership_contract: "ownership_contract",
  developer_statement: "developer_statement",
  buyer_identity: "national_id",
  owner_identity: "national_id",
  tenant_identity: "national_id",
  signed_sale_contract: "sale_contract",
  signed_lease_contract: "lease_contract",
  maintenance_clearance: "maintenance_receipt",
  ownership_proof: "ownership_contract",
  developer_assignment_record: "other",
  handover_inventory: "other",
};

export type ChecklistAction = Schemas["ChecklistUpdate"]["action"];

/** Mirrors the API's checklist rules for which buttons to offer (the server still validates). */
export function checklistActions(item: Pick<Schemas["ChecklistOut"], "responsible" | "status">, myRole: Schemas["PartyRole"], available: boolean): ChecklistAction[] {
  if (!available) return [];
  const mine = item.responsible === myRole;
  if (mine) return item.status === "pending" ? ["submit"] : [];
  if (item.status === "submitted") return ["accept", "reopen", "waive"];
  if (item.status === "pending") return ["waive"];
  return [];
}

export const checklistAvailable = (status: DealStatus) => !["negotiating", "cancelled", "completed"].includes(status);
