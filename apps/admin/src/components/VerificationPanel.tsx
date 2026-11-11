"use client";

import { useState } from "react";
import type { DecisionIn, QueueItem } from "@/lib/adminApi";
import { Badge, ConfirmDialog, fmtDate, shortId } from "./ui";

type Decision = DecisionIn["decision"];

const ALLOWED: Record<string, Decision[]> = {
  submitted: ["start_review", "request_info", "reject", "approve"],
  under_review: ["request_info", "reject", "approve"],
  more_info_required: ["reject"],
};

const LABELS: Record<Decision, string> = {
  start_review: "Start review",
  request_info: "Request info",
  reject: "Reject",
  approve: "Approve",
};

const CLAIM_FIELDS: [string, string][] = [
  ["identity_key", "Property identity key"],
  ["property_type", "Property type"],
  ["area_sqm", "Area (m²)"],
  ["capacity", "Claimant capacity"],
  ["principal_name", "Principal (if representative)"],
  ["authority_scope", "Authority scope"],
  ["status", "Claim status"],
];

export interface VerificationPanelProps {
  item: QueueItem;
  onDecide: (decision: DecisionIn) => Promise<void>;
  onOpenDocument: (documentId: string) => void;
}

/** Detail + decision panel for one verification request. */
export function VerificationPanel({ item, onDecide, onOpenDocument }: VerificationPanelProps) {
  const [note, setNote] = useState("");
  const [supersede, setSupersede] = useState(false);
  const [pending, setPending] = useState<Decision | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const allowed = ALLOWED[item.status] ?? [];
  const isOwnership = item.kind === "ownership";
  const claim = item.claim as Record<string, unknown> | null;

  function request(decision: Decision) {
    setValidation(null);
    if ((decision === "reject" || decision === "request_info") && !note.trim()) {
      setValidation("A note for the applicant is required to reject or request more information.");
      return;
    }
    if (decision === "approve" && supersede && !note.trim()) {
      setValidation("Superseding an approved owner requires a note explaining the ownership transfer.");
      return;
    }
    setPending(decision);
  }

  async function confirm() {
    if (!pending) return;
    const body: DecisionIn = {
      decision: pending,
      note: note.trim() || null,
      supersede_existing: pending === "approve" && isOwnership && supersede,
    };
    await onDecide(body);
    setPending(null);
    setNote("");
    setSupersede(false);
  }

  return (
    <section className="card stack gap-md" aria-labelledby={`vr-${item.id}`}>
      <header className="row between wrap gap-sm">
        <h2 id={`vr-${item.id}`}>
          {item.kind} verification <span className="muted mono">#{shortId(item.id)}</span>
        </h2>
        <Badge value={item.status} />
      </header>
      <dl className="dl">
        <dt>Applicant</dt>
        <dd>
          {item.user_name} <span className="muted mono">({shortId(item.user_id)})</span>
        </dd>
        <dt>Submitted</dt>
        <dd>{fmtDate(item.created_at)}</dd>
        {item.listing_id && (
          <>
            <dt>Listing</dt>
            <dd className="mono">{item.listing_id}</dd>
          </>
        )}
        {item.note && (
          <>
            <dt>Applicant note</dt>
            <dd>{item.note}</dd>
          </>
        )}
      </dl>

      {claim && (
        <div>
          <h3>Ownership claim / property identity</h3>
          <dl className="dl">
            {CLAIM_FIELDS.filter(([k]) => claim[k] !== null && claim[k] !== undefined && claim[k] !== "").map(([k, label]) => (
              <div key={k} className="contents">
                <dt>{label}</dt>
                <dd className={k === "identity_key" ? "mono" : undefined}>{String(claim[k])}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div>
        <h3>Documents</h3>
        {item.documents.length === 0 ? (
          <p className="muted">No documents attached.</p>
        ) : (
          <ul className="doc-list">
            {item.documents.map((d) => (
              <li key={d.id}>
                <span>
                  <strong>{d.kind.replace(/_/g, " ")}</strong> <span className="muted">{d.original_name}</span>
                </span>
                <button type="button" className="btn btn-sm" onClick={() => onOpenDocument(d.id)}>
                  Open document<span className="sr-only"> {d.original_name}</span> ↗
                </button>
              </li>
            ))}
          </ul>
        )}
        <small className="muted">Documents open in a new tab via a short-lived signed link. Every read is audited.</small>
      </div>

      {allowed.length > 0 ? (
        <div className="stack gap-sm">
          <h3>Decision</h3>
          <div className="field">
            <label htmlFor={`note-${item.id}`}>Reviewer note (sent to the applicant for reject / request info)</label>
            <textarea id={`note-${item.id}`} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {isOwnership && allowed.includes("approve") && (
            <div className="field-check">
              <input id={`supersede-${item.id}`} type="checkbox" checked={supersede} onChange={(e) => setSupersede(e.target.checked)} />
              <label htmlFor={`supersede-${item.id}`}>Ownership transfer: supersede the existing approved owner</label>
            </div>
          )}
          {supersede && (
            <div className="alert alert-warning" role="note">
              Warning: approving with supersede marks the current approved owner&apos;s claim as superseded and withdraws their
              listings. Only use this when documents prove a completed ownership transfer. A note is required.
            </div>
          )}
          {validation && (
            <div className="alert alert-danger" role="alert">
              {validation}
            </div>
          )}
          <div className="row gap-sm wrap">
            {allowed.map((d) => (
              <button
                key={d}
                type="button"
                className={d === "approve" ? "btn btn-primary" : d === "reject" ? "btn btn-danger" : "btn"}
                onClick={() => request(d)}
              >
                {LABELS[d]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="muted">No decisions available in status “{item.status.replace(/_/g, " ")}”.</p>
      )}

      {pending && (
        <ConfirmDialog
          title={`${LABELS[pending]} — ${item.kind} verification`}
          danger={pending === "reject" || (pending === "approve" && supersede)}
          confirmLabel={pending === "approve" && supersede ? "Approve and supersede" : `Confirm: ${LABELS[pending]}`}
          message={
            pending === "approve" && supersede
              ? "This will supersede the existing approved owner and withdraw their listings. Are you sure?"
              : `Record “${LABELS[pending]}” for ${item.user_name}? The applicant will be notified.`
          }
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        >
          {note.trim() && <blockquote className="quote">{note.trim()}</blockquote>}
        </ConfirmDialog>
      )}
    </section>
  );
}
