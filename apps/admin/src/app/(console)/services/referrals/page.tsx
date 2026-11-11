"use client";

import { useState } from "react";
import { RequirePermission } from "@/components/Shell";
import { Badge, ConfirmDialog, DataState, fmtDate, PageHeader, shortId } from "@/components/ui";
import type { ReferralStatus, ReferralStatusIn, ServiceReferral } from "@/lib/adminApi";
import { useApi } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { useAsync } from "@/lib/useAsync";

const STATUSES: ReferralStatus[] = ["requested", "contacted", "completed", "cancelled"];
const OPEN: ReferralStatus[] = ["requested", "contacted"];
const TONE: Record<ReferralStatus, string> = { requested: "info", contacted: "warning", completed: "success", cancelled: "neutral" };
type Target = ReferralStatusIn["status"];
const ACTION_LABEL: Record<Target, string> = { contacted: "Mark contacted", completed: "Mark completed", cancelled: "Cancel" };

function Referrals() {
  const api = useApi();
  const toast = useToast();
  const [statuses, setStatuses] = useState<ReferralStatus[]>(OPEN);
  const [pending, setPending] = useState<{ referral: ServiceReferral; status: Target } | null>(null);
  const q = useAsync(() => api.serviceReferrals(statuses.length ? statuses : undefined), [statuses.join(",")]);

  async function apply() {
    if (!pending) return;
    try {
      await api.updateReferral(pending.referral.id, { status: pending.status });
      toast.success(`Request from ${pending.referral.user_name || "member"} marked ${pending.status}.`);
      setPending(null);
      q.reload();
    } catch (e) {
      toast.error(e);
      q.reload();
      throw e;
    }
  }

  return (
    <>
      <PageHeader
        title="Referral requests"
        description="Members asking to be put in touch with a provider. Phone numbers appear only when the member chose to share them."
      />
      <div className="filters">
        <fieldset className="checks">
          <legend>Status (none = all)</legend>
          {STATUSES.map((s) => (
            <label key={s}>
              <input
                type="checkbox"
                checked={statuses.includes(s)}
                onChange={(e) => setStatuses((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))}
              />{" "}
              {s}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="card flush">
        <DataState loading={q.loading} error={q.error} empty={!q.data?.length} emptyText="No referral requests match these filters." onRetry={q.reload}>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Referral requests</caption>
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">User</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Message</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((r) => {
                  const open = OPEN.includes(r.status);
                  const targets: Target[] = r.status === "requested" ? ["contacted", "completed", "cancelled"] : ["completed", "cancelled"];
                  return (
                    <tr key={r.id}>
                      <td>{r.provider_name}</td>
                      <td>
                        {r.user_name || <span className="muted">—</span>}
                        {r.deal_id && <div className="muted small">Deal {shortId(r.deal_id)}</div>}
                      </td>
                      <td className="nowrap">{r.user_phone ? <span dir="ltr">{r.user_phone}</span> : <span className="muted">Not shared</span>}</td>
                      <td>{r.message ? <div className="clamp prewrap">{r.message}</div> : <span className="muted">—</span>}</td>
                      <td>
                        <Badge value={r.status} tone={TONE[r.status]} />
                      </td>
                      <td className="nowrap">{fmtDate(r.created_at)}</td>
                      <td>
                        {open ? (
                          <div className="row gap-xs wrap">
                            {targets.map((s) => (
                              <button
                                key={s}
                                type="button"
                                className={s === "cancelled" ? "btn btn-sm btn-danger" : "btn btn-sm"}
                                onClick={() => setPending({ referral: r, status: s })}
                              >
                                {ACTION_LABEL[s]}
                                <span className="sr-only"> request from {r.user_name} to {r.provider_name}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">Closed</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
      {pending && (
        <ConfirmDialog
          title={ACTION_LABEL[pending.status]}
          danger={pending.status === "cancelled"}
          confirmLabel={ACTION_LABEL[pending.status]}
          message={
            <>
              Mark the request from <strong>{pending.referral.user_name || "this member"}</strong> to{" "}
              <strong>{pending.referral.provider_name}</strong> as <strong>{pending.status}</strong>?
              {pending.status !== "contacted" && " This closes the request."}
            </>
          }
          onCancel={() => setPending(null)}
          onConfirm={apply}
        />
      )}
    </>
  );
}

export default function ReferralRequestsPage() {
  return (
    <RequirePermission permission="services.manage">
      <Referrals />
    </RequirePermission>
  );
}
