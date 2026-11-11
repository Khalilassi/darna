"use client";

import { useState } from "react";
import { ExpireOffersButton } from "@/components/ExpireOffersButton";
import { RequirePermission } from "@/components/Shell";
import { Badge, DataState, fmtDate, PageHeader, shortId } from "@/components/ui";
import type { DealStatus } from "@/lib/adminApi";
import { useApi } from "@/lib/auth";
import { useAsync } from "@/lib/useAsync";

const STATUSES: DealStatus[] = [
  "negotiating", "offer_accepted", "due_diligence", "contract_preparation", "contract_signed", "developer_transfer", "completed",
  "terms_agreed", "lease_preparation", "lease_signed", "handover_scheduled", "lease_active", "cancelled",
];

function Deals() {
  const api = useApi();
  const [status, setStatus] = useState<DealStatus | "">("");
  const q = useAsync(() => api.deals(status ? [status] : undefined), [status]);
  return (
    <>
      <PageHeader
        title="Deals monitor"
        description="Most recently updated 200 deals. Read-only: parties progress deals in the app."
        actions={<ExpireOffersButton onDone={q.reload} />}
      />
      <div className="filters">
        <div className="field">
          <label htmlFor="deal-status">Status</label>
          <select id="deal-status" value={status} onChange={(e) => setStatus(e.target.value as DealStatus | "")}>
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
        <DataState loading={q.loading} error={q.error} empty={!q.data?.length} emptyText="No deals for this filter." onRetry={q.reload}>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Deals</caption>
              <thead>
                <tr>
                  <th scope="col">Listing</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Status</th>
                  <th scope="col">Offers</th>
                  <th scope="col">Buyer</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((d) => (
                  <tr key={d.id}>
                    <td>{d.listing_title}</td>
                    <td>{d.kind}</td>
                    <td>
                      <Badge value={d.status} />
                    </td>
                    <td className="num">{d.offers}</td>
                    <td className="mono small">{shortId(d.buyer_id)}</td>
                    <td className="mono small">{shortId(d.owner_id)}</td>
                    <td className="nowrap">{fmtDate(d.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
    </>
  );
}

export default function DealsPage() {
  return (
    <RequirePermission permission="deal.monitor">
      <Deals />
    </RequirePermission>
  );
}
