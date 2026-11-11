"use client";

import { useEffect, useState } from "react";
import { Badge, DataState, fmtDate, PageHeader, Pager } from "./ui";
import { VerificationPanel } from "./VerificationPanel";
import type { DecisionIn, VerificationKind, VerificationStatus } from "@/lib/adminApi";
import { useApi } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { useAsync } from "@/lib/useAsync";

const KINDS: VerificationKind[] = ["identity", "ownership", "financial"];
const PAGE_SIZE = 25;
const STATUSES: VerificationStatus[] = ["submitted", "under_review", "more_info_required", "approved", "rejected", "withdrawn"];

export function VerificationQueue() {
  const api = useApi();
  const toast = useToast();
  const [kind, setKind] = useState<VerificationKind | "">("");
  const [statuses, setStatuses] = useState<VerificationStatus[]>(["submitted", "under_review"]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const q = useAsync(
    () => api.verifications({ status: statuses, kind: kind || undefined, page, page_size: PAGE_SIZE }),
    [kind, statuses.join(","), page],
  );
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  // New filters start from the first page.
  useEffect(() => setPage(1), [kind, statuses.join(",")]);
  // Deciding the last item on the last page leaves it empty: step back.
  useEffect(() => {
    if (q.data && page > 1 && q.data.items.length === 0 && total > 0) setPage(Math.ceil(total / PAGE_SIZE));
  }, [q.data, page, total]);
  const selected = items.find((i) => i.id === selectedId) ?? null;

  async function decide(id: string, body: DecisionIn) {
    try {
      await api.decide(id, body);
      toast.success(`Decision “${body.decision.replace(/_/g, " ")}” recorded.`);
      q.reload();
    } catch (e) {
      toast.error(e);
      throw e;
    }
  }

  async function openDocument(documentId: string) {
    // Open the tab synchronously (avoids popup blockers), then point it at the signed URL.
    const tab = window.open("about:blank", "_blank");
    try {
      const { url } = await api.signedUrl(documentId);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      tab?.close();
      toast.error(e);
    }
  }

  return (
    <>
      <PageHeader title="Verification queue" description="Identity, ownership and financial verification requests, oldest first." />
      <div className="filters" role="group" aria-label="Filters">
        <div className="field">
          <label htmlFor="vr-kind">Kind</label>
          <select id="vr-kind" value={kind} onChange={(e) => setKind(e.target.value as VerificationKind | "")}>
            <option value="">All kinds</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="checks">
          <legend>Status</legend>
          {STATUSES.map((s) => (
            <label key={s}>
              <input
                type="checkbox"
                checked={statuses.includes(s)}
                onChange={(e) => setStatuses((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))}
              />{" "}
              {s.replace(/_/g, " ")}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="split">
        <div className="card flush">
          <DataState loading={q.loading} error={q.error} empty={items.length === 0} emptyText="The queue is empty for these filters." onRetry={q.reload}>
            <table className="table">
              <caption className="sr-only">Verification requests</caption>
              <thead>
                <tr>
                  <th scope="col">Applicant</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Status</th>
                  <th scope="col">Docs</th>
                  <th scope="col">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className={i.id === selectedId ? "selected" : undefined}>
                    <td>
                      <button type="button" className="link" onClick={() => setSelectedId(i.id)} aria-pressed={i.id === selectedId}>
                        {i.user_name}
                      </button>
                    </td>
                    <td>{i.kind}</td>
                    <td>
                      <Badge value={i.status} />
                    </td>
                    <td className="num">{i.documents.length}</td>
                    <td>{fmtDate(i.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataState>
          {q.data && <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        </div>
        <div>
          {selected ? (
            <VerificationPanel key={selected.id} item={selected} onDecide={(b) => decide(selected.id, b)} onOpenDocument={openDocument} />
          ) : (
            <div className="card state state-empty">Select a request to review its details and documents.</div>
          )}
        </div>
      </div>
    </>
  );
}

