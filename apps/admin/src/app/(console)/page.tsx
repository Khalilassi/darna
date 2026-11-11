"use client";

import Link from "next/link";
import { DataState, PageHeader } from "@/components/ui";
import { ExpireOffersButton } from "@/components/ExpireOffersButton";
import { RequirePermission } from "@/components/Shell";
import { useApi, useAuth } from "@/lib/auth";
import { useAsync } from "@/lib/useAsync";

function Breakdown({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <section className="card">
      <h2>{title}</h2>
      {entries.length === 0 ? (
        <p className="muted">No records.</p>
      ) : (
        <table className="table compact">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Count
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k}>
                <td>{k.replace(/_/g, " ")}</td>
                <td className="num">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const api = useApi();
  const { can } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.analytics(), []);

  const cards = data
    ? [
        { label: "Pending verifications", value: data.verifications_pending, href: can("verification.review") ? "/verifications" : undefined },
        { label: "Open disputes", value: data.disputes_open, href: can("dispute.resolve") ? "/disputes" : undefined },
        { label: "Open support cases", value: data.support_open, href: can("support.handle") ? "/support" : undefined },
        { label: "Users", value: data.users_total },
        { label: "Identity verified", value: data.users_identity_verified },
        { label: "New users (30 days)", value: data.users_new_30d },
        { label: "Properties", value: data.properties_total },
      ]
    : [];

  return (
    <RequirePermission permission="analytics.read">
      <PageHeader title="Dashboard" description="Platform health at a glance." actions={<ExpireOffersButton onDone={reload} />} />
      <DataState loading={loading} error={error} empty={!data} onRetry={reload}>
        <div className="stat-grid">
          {cards.map((c) => (
            <div className="card stat" key={c.label}>
              <span className="stat-label">{c.label}</span>
              <span className="stat-value">{c.value}</span>
              {c.href && (
                <Link href={c.href} className="stat-link">
                  Open →
                </Link>
              )}
            </div>
          ))}
        </div>
        {data && (
          <div className="grid-3">
            <Breakdown title="Listings by status" counts={data.listings_by_status} />
            <Breakdown title="Deals by status" counts={data.deals_by_status} />
            <Breakdown title="Ownership claims by status" counts={data.claims_by_status} />
          </div>
        )}
      </DataState>
    </RequirePermission>
  );
}
