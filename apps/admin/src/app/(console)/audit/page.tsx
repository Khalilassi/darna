"use client";

import { useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/Shell";
import { DataState, fmtDate, PageHeader, Pager, shortId } from "@/components/ui";
import { useApi } from "@/lib/auth";
import { useAsync } from "@/lib/useAsync";

const PAGE_SIZE = 50;

function AuditLog() {
  const api = useApi();
  const [action, setAction] = useState("");
  const [entityId, setEntityId] = useState("");
  const [filters, setFilters] = useState({ action: "", entity_id: "" });
  const [page, setPage] = useState(1);
  const q = useAsync(
    () => api.audit({ action: filters.action || undefined, entity_id: filters.entity_id || undefined, page, page_size: PAGE_SIZE }),
    [filters.action, filters.entity_id, page],
  );

  function apply(e: FormEvent) {
    e.preventDefault();
    setFilters({ action: action.trim(), entity_id: entityId.trim() });
    setPage(1);
  }

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sensitive actions. Newest first." />
      <form className="filters" onSubmit={apply}>
        <div className="field">
          <label htmlFor="audit-action">Action prefix</label>
          <input id="audit-action" value={action} maxLength={80} placeholder="e.g. verification." onChange={(e) => setAction(e.target.value)} />
        </div>
        <div className="field grow">
          <label htmlFor="audit-entity">Entity ID</label>
          <input id="audit-entity" value={entityId} maxLength={64} placeholder="exact UUID" onChange={(e) => setEntityId(e.target.value)} />
        </div>
        <div className="row gap-sm align-end">
          <button type="submit" className="btn btn-primary">
            Apply
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setAction("");
              setEntityId("");
              setFilters({ action: "", entity_id: "" });
              setPage(1);
            }}
          >
            Clear
          </button>
        </div>
      </form>
      <div className="card flush">
        <DataState loading={q.loading} error={q.error} empty={!q.data?.items.length} emptyText="No audit entries match." onRetry={q.reload}>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Audit entries</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Data</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.items.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{fmtDate(a.created_at)}</td>
                    <td className="mono small">{a.action}</td>
                    <td className="small">
                      {a.entity_type}{" "}
                      {a.entity_id && (
                        <button
                          type="button"
                          className="link mono"
                          title="Filter by this entity"
                          onClick={() => {
                            setEntityId(a.entity_id ?? "");
                            setFilters((f) => ({ ...f, entity_id: a.entity_id ?? "" }));
                            setPage(1);
                          }}
                        >
                          {shortId(a.entity_id)}
                        </button>
                      )}
                    </td>
                    <td className="mono small">{a.actor_id ? shortId(a.actor_id) : "system"}</td>
                    <td className="mono small clamp">{Object.keys(a.data ?? {}).length ? JSON.stringify(a.data) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.data && <Pager page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />}
        </DataState>
      </div>
    </>
  );
}

export default function AuditPage() {
  return (
    <RequirePermission permission="audit.read">
      <AuditLog />
    </RequirePermission>
  );
}
