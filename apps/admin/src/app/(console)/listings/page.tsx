"use client";

import { useState } from "react";
import { formatEGP } from "@darna/design-tokens";
import { RequirePermission } from "@/components/Shell";
import { Badge, ConfirmDialog, DataState, fmtDate, PageHeader, Pager } from "@/components/ui";
import type { AdminListing, ListingStatus, ModerateIn } from "@/lib/adminApi";
import { useApi } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { useAsync } from "@/lib/useAsync";

type Action = ModerateIn["action"];
const STATUSES: ListingStatus[] = ["pending_review", "active", "under_offer", "paused", "suspended", "rejected", "draft", "withdrawn", "sold", "rented"];
const PAGE_SIZE = 25;

function actionsFor(l: AdminListing): Action[] {
  const featured = !!l.featured_until && new Date(l.featured_until) > new Date();
  switch (l.status) {
    case "pending_review":
      return ["approve", "reject"];
    case "active":
      return [featured ? "unfeature" : "feature", "suspend"];
    case "under_offer":
    case "paused":
      return ["suspend"];
    case "suspended":
      return ["reinstate"];
    default:
      return featured ? ["unfeature"] : [];
  }
}

const LABEL: Record<Action, string> = {
  approve: "Approve",
  reject: "Reject",
  suspend: "Suspend",
  reinstate: "Reinstate",
  feature: "Feature",
  unfeature: "Unfeature",
};

function Listings() {
  const api = useApi();
  const toast = useToast();
  const [status, setStatus] = useState<ListingStatus | "">("pending_review");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ listing: AdminListing; action: Action } | null>(null);
  const [note, setNote] = useState("");
  const [days, setDays] = useState(7);
  const q = useAsync(() => api.listings({ status: status ? [status] : undefined, page, page_size: PAGE_SIZE }), [status, page]);
  const needsNote = pending && (pending.action === "reject" || pending.action === "suspend");

  return (
    <>
      <PageHeader title="Listings moderation" description="Review new listings and act on live ones. Every action is audited." />
      <div className="filters">
        <div className="field">
          <label htmlFor="ls-status">Status</label>
          <select
            id="ls-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ListingStatus | "");
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="card flush">
        <DataState loading={q.loading} error={q.error} empty={!q.data?.items.length} emptyText="No listings match this filter." onRetry={q.reload}>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Listings</caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Property</th>
                  <th scope="col">Price</th>
                  <th scope="col">Photos</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.items.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div>{l.title}</div>
                      <small className="muted">
                        {l.purpose.replace(/_/g, " ")}
                        {l.financials_verified ? " · financials verified" : ""}
                        {l.featured_until && new Date(l.featured_until) > new Date() ? ` · featured until ${fmtDate(l.featured_until)}` : ""}
                      </small>
                      {l.moderation_note && <div className="muted small">Note: {l.moderation_note}</div>}
                    </td>
                    <td>{l.owner_name}</td>
                    <td className="mono small">{l.identity_key}</td>
                    <td className="nowrap">
                      {l.sale_cash_price && <div>{formatEGP(l.sale_cash_price)}</div>}
                      {l.monthly_rent && <div>{formatEGP(l.monthly_rent)}/mo</div>}
                    </td>
                    <td className="num">{l.photos}</td>
                    <td>
                      <Badge value={l.status} />
                    </td>
                    <td className="nowrap">{fmtDate(l.created_at)}</td>
                    <td>
                      <div className="row gap-xs wrap">
                        {actionsFor(l).map((a) => (
                          <button
                            key={a}
                            type="button"
                            className={a === "approve" ? "btn btn-sm btn-primary" : a === "reject" || a === "suspend" ? "btn btn-sm btn-danger" : "btn btn-sm"}
                            onClick={() => {
                              setNote("");
                              setPending({ listing: l, action: a });
                            }}
                          >
                            {LABEL[a]}
                            <span className="sr-only"> {l.title}</span>
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.data && <Pager page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />}
        </DataState>
      </div>
      {pending && (
        <ConfirmDialog
          title={`${LABEL[pending.action]} listing`}
          danger={pending.action === "reject" || pending.action === "suspend"}
          confirmLabel={`${LABEL[pending.action]} listing`}
          disabled={!!needsNote && !note.trim()}
          message={
            <>
              <strong>{pending.listing.title}</strong> by {pending.listing.owner_name}.{" "}
              {pending.action === "suspend" && "The listing will be hidden from buyers immediately."}
              {pending.action === "reject" && "The owner will be notified with your note."}
              {pending.action === "approve" && "Requires a verified owner identity and an approved ownership claim."}
            </>
          }
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            try {
              await api.moderate(pending.listing.id, {
                action: pending.action,
                note: note.trim() || null,
                feature_days: pending.action === "feature" ? days : null,
              });
              toast.success(`Listing ${LABEL[pending.action].toLowerCase()}${pending.action.endsWith("e") ? "d" : "ed"}.`);
              setPending(null);
              q.reload();
            } catch (e) {
              toast.error(e);
            }
          }}
        >
          {pending.action === "feature" && (
            <div className="field">
              <label htmlFor="feature-days">Feature for (days, 1–90)</label>
              <input id="feature-days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </div>
          )}
          <div className="field">
            <label htmlFor="mod-note">Note {needsNote ? "(required)" : "(optional)"}</label>
            <textarea id="mod-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}

export default function ListingsPage() {
  return (
    <RequirePermission permission="listing.moderate">
      <Listings />
    </RequirePermission>
  );
}
