"use client";

import { useState } from "react";
import { RequirePermission } from "@/components/Shell";
import { Badge, ConfirmDialog, DataState, fmtDate, PageHeader, shortId } from "@/components/ui";
import type { Dispute, DisputeStatus, ResolveIn } from "@/lib/adminApi";
import { useApi } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { useAsync } from "@/lib/useAsync";

type Outcome = ResolveIn["outcome"];
const OUTCOMES: { value: Outcome; label: string; help: string }[] = [
  { value: "resolved_for_existing", label: "Uphold existing owner", help: "The challenger's claim is rejected." },
  { value: "resolved_for_challenger", label: "Resolve for challenger", help: "The existing claim is revoked and the challenger is approved." },
  { value: "dismissed", label: "Dismiss", help: "The dispute is closed without changing ownership records." },
];

function ClaimCard({ title, claim }: { title: string; claim: Record<string, unknown> | null | undefined }) {
  return (
    <div className="card inset">
      <h3>{title}</h3>
      {claim && Object.keys(claim).length ? (
        <dl className="dl">
          <dt>Claimant</dt>
          <dd>{String(claim.name ?? "—")}</dd>
          <dt>Capacity</dt>
          <dd>{String(claim.capacity ?? "—").replace(/_/g, " ")}</dd>
          <dt>Claim status</dt>
          <dd>{claim.status ? <Badge value={String(claim.status)} /> : "—"}</dd>
          <dt>Claim</dt>
          <dd className="mono">{shortId(String(claim.claim_id ?? ""))}</dd>
        </dl>
      ) : (
        <p className="muted">No claim on record.</p>
      )}
    </div>
  );
}

function Disputes() {
  const api = useApi();
  const toast = useToast();
  // GET /admin/disputes defaults to "open" when no status is sent, so there is no "all" option.
  const [status, setStatus] = useState<DisputeStatus>("open");
  const [resolving, setResolving] = useState<Dispute | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("resolved_for_existing");
  const [note, setNote] = useState("");
  const q = useAsync(() => api.disputes(status), [status]);

  return (
    <>
      <PageHeader title="Disputes" description="Competing ownership claims on the same property. Compare both sides before resolving." />
      <div className="filters">
        <div className="field">
          <label htmlFor="d-status">Status</label>
          <select id="d-status" value={status} onChange={(e) => setStatus(e.target.value as DisputeStatus)}>
            <option value="open">open</option>
            <option value="resolved_for_existing">resolved for existing</option>
            <option value="resolved_for_challenger">resolved for challenger</option>
            <option value="dismissed">dismissed</option>
          </select>
        </div>
      </div>
      <DataState loading={q.loading} error={q.error} empty={!q.data?.length} emptyText="No disputes for this filter." onRetry={q.reload}>
        <div className="stack gap-md">
          {q.data?.map((d) => (
            <article key={d.id} className="card stack gap-sm">
              <header className="row between wrap gap-sm">
                <div>
                  <h2 className="mono">{d.identity_key}</h2>
                  <small className="muted">Opened {fmtDate(d.created_at)}</small>
                </div>
                <Badge value={d.status} />
              </header>
              <p>
                <strong>Reason:</strong> {d.reason}
              </p>
              <div className="grid-2">
                <ClaimCard title="Existing claim" claim={d.existing as Record<string, unknown> | null} />
                <ClaimCard title="Challenger claim" claim={d.challenger as Record<string, unknown>} />
              </div>
              {d.resolution_note && <p className="muted">Resolution: {d.resolution_note}</p>}
              {d.status === "open" && (
                <div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setOutcome("resolved_for_existing");
                      setNote("");
                      setResolving(d);
                    }}
                  >
                    Resolve dispute
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </DataState>
      {resolving && (
        <ConfirmDialog
          title="Resolve dispute"
          danger={outcome === "resolved_for_challenger"}
          confirmLabel="Record resolution"
          disabled={note.trim().length < 3}
          message={
            <>
              Property <span className="mono">{resolving.identity_key}</span>. Ownership statuses are platform records, not legal
              transfers.
            </>
          }
          onCancel={() => setResolving(null)}
          onConfirm={async () => {
            try {
              await api.resolveDispute(resolving.id, { outcome, note: note.trim() });
              toast.success("Dispute resolved.");
              setResolving(null);
              q.reload();
            } catch (e) {
              toast.error(e);
            }
          }}
        >
          <fieldset className="stack gap-xs">
            <legend>Outcome</legend>
            {OUTCOMES.map((o) => (
              <label key={o.value} className="radio">
                <input type="radio" name="outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
                <span>
                  <strong>{o.label}</strong> <span className="muted">— {o.help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="resolve-note">Resolution note (required, min. 3 characters)</label>
            <textarea id="resolve-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}

export default function DisputesPage() {
  return (
    <RequirePermission permission="dispute.resolve">
      <Disputes />
    </RequirePermission>
  );
}
