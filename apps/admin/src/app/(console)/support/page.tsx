"use client";

import { useState } from "react";
import { RequirePermission } from "@/components/Shell";
import { Badge, DataState, fmtDate, Modal, PageHeader, shortId } from "@/components/ui";
import type { SupportCase, SupportStatus } from "@/lib/adminApi";
import { useApi, useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { useAsync } from "@/lib/useAsync";

const STATUSES: SupportStatus[] = ["open", "in_progress", "resolved", "closed"];

function CaseEditor({ c, onClose, onSaved }: { c: SupportCase; onClose: () => void; onSaved: () => void }) {
  const api = useApi();
  const { me } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<SupportStatus>(c.status);
  const [assign, setAssign] = useState(false);
  const [note, setNote] = useState(c.resolution_note ?? "");
  const [busy, setBusy] = useState(false);
  const closing = status === "resolved" || status === "closed";
  const assignedToMe = c.assignee_id === me?.id;

  async function save() {
    setBusy(true);
    try {
      await api.updateCase(c.id, {
        status: status !== c.status ? status : null,
        assign_to_me: assign,
        resolution_note: note.trim() && note.trim() !== (c.resolution_note ?? "") ? note.trim() : null,
      });
      toast.success("Support case updated.");
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Case ${shortId(c.id)} — ${c.category.replace(/_/g, " ")}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || (closing && !note.trim())}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="stack gap-sm">
        <p className="prewrap">{c.description}</p>
        {c.subject_type && (
          <p className="muted small">
            Subject: {c.subject_type} <span className="mono">{c.subject_id}</span>
          </p>
        )}
        {!assignedToMe && (
          <div className="field-check">
            <input id="assign-me" type="checkbox" checked={assign} onChange={(e) => setAssign(e.target.checked)} />
            <label htmlFor="assign-me">Assign to me{c.assignee_id ? " (reassign from current assignee)" : ""}</label>
          </div>
        )}
        <div className="field">
          <label htmlFor="case-status">Status</label>
          <select id="case-status" value={status} onChange={(e) => setStatus(e.target.value as SupportStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="case-note">Resolution note {closing ? "(required to resolve or close)" : "(optional)"}</label>
          <textarea id="case-note" rows={4} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {closing && <small className="muted">The reporter is notified when a case is resolved or closed.</small>}
      </div>
    </Modal>
  );
}

function Support() {
  const api = useApi();
  const { me } = useAuth();
  const toast = useToast();
  const [statuses, setStatuses] = useState<SupportStatus[]>(["open", "in_progress"]);
  const [editing, setEditing] = useState<SupportCase | null>(null);
  const q = useAsync(() => api.support(statuses), [statuses.join(",")]);

  async function assignToMe(c: SupportCase) {
    try {
      await api.updateCase(c.id, { assign_to_me: true, status: c.status === "open" ? "in_progress" : null });
      toast.success("Case assigned to you.");
      q.reload();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <>
      <PageHeader title="Support cases" description="Reports from members: broker reports, fraud, listing issues and account help." />
      <div className="filters">
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
      <div className="card flush">
        <DataState loading={q.loading} error={q.error} empty={!q.data?.length} emptyText="No support cases for this filter." onRetry={q.reload}>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Support cases</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Description</th>
                  <th scope="col">Status</th>
                  <th scope="col">Assignee</th>
                  <th scope="col">Opened</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Badge value={c.category} tone={c.category === "fraud" ? "danger" : "neutral"} />
                    </td>
                    <td className="clamp">{c.description}</td>
                    <td>
                      <Badge value={c.status} />
                    </td>
                    <td>{c.assignee_id ? (c.assignee_id === me?.id ? "You" : <span className="mono small">{shortId(c.assignee_id)}</span>) : <span className="muted">Unassigned</span>}</td>
                    <td className="nowrap">{fmtDate(c.created_at)}</td>
                    <td>
                      <div className="row gap-xs wrap">
                        {c.assignee_id !== me?.id && (
                          <button type="button" className="btn btn-sm" onClick={() => assignToMe(c)}>
                            Assign to me
                          </button>
                        )}
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing(c)}>
                          Manage<span className="sr-only"> case {shortId(c.id)}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
      {editing && (
        <CaseEditor
          c={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            q.reload();
          }}
        />
      )}
    </>
  );
}

export default function SupportPage() {
  return (
    <RequirePermission permission="support.handle">
      <Support />
    </RequirePermission>
  );
}
