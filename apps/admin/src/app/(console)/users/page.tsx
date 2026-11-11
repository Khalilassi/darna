"use client";

import { useEffect, useState } from "react";
import { RequirePermission } from "@/components/Shell";
import { Badge, ConfirmDialog, DataState, fmtDate, Modal, PageHeader, Pager } from "@/components/ui";
import type { AdminUser } from "@/lib/adminApi";
import { useApi, useAuth } from "@/lib/auth";
import type { Role } from "@/lib/permissions";
import { useToast } from "@/lib/toast";
import { useAsync } from "@/lib/useAsync";

const ROLES: Role[] = ["member", "reviewer", "support", "admin"];
const PAGE_SIZE = 25;

type Pending =
  | { kind: "role"; user: AdminUser; role: Role }
  | { kind: "suspend"; user: AdminUser }
  | { kind: "reactivate"; user: AdminUser }
  | { kind: "mfaCode"; user: AdminUser };

function Users() {
  const api = useApi();
  const { me } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [issued, setIssued] = useState<{ user: AdminUser; code: string; expires_at: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const res = useAsync(() => api.users({ q: q || undefined, page, page_size: PAGE_SIZE }), [q, page]);

  async function apply() {
    if (!pending) return;
    try {
      if (pending.kind === "mfaCode") {
        const { code, expires_at } = await api.issueMfaEnrollmentCode(pending.user.id);
        setIssued({ user: pending.user, code, expires_at });
        setPending(null);
        return;
      }
      if (pending.kind === "role") await api.updateUser(pending.user.id, { role: pending.role });
      else if (pending.kind === "suspend") await api.updateUser(pending.user.id, { is_active: false, suspended_reason: reason.trim() });
      else await api.updateUser(pending.user.id, { is_active: true });
      toast.success(
        pending.kind === "role"
          ? `${pending.user.full_name} is now ${pending.role}.`
          : pending.kind === "suspend"
            ? `${pending.user.full_name} suspended.`
            : `${pending.user.full_name} reactivated.`,
      );
      setPending(null);
      res.reload();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <>
      <PageHeader title="Users" description="Search accounts, change staff roles, suspend or reactivate." />
      <div className="filters">
        <div className="field grow">
          <label htmlFor="user-search">Search by name or email</label>
          <input id="user-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. owner@example.com" />
        </div>
      </div>
      <div className="card flush">
        <DataState loading={res.loading} error={res.error} empty={!res.data?.items.length} emptyText="No users match your search." onRetry={res.reload}>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Users</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Identity</th>
                  <th scope="col">Status</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {res.data?.items.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        {u.full_name}
                        {self && <span className="muted"> (you)</span>}
                      </td>
                      <td>{u.email}</td>
                      <td>
                        <label className="sr-only" htmlFor={`role-${u.id}`}>
                          Role for {u.full_name}
                        </label>
                        <select
                          id={`role-${u.id}`}
                          value={u.role}
                          disabled={self}
                          onChange={(e) => setPending({ kind: "role", user: u, role: e.target.value as Role })}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{u.identity_verified_at ? <Badge value="verified" tone="success" /> : <span className="muted">not verified</span>}</td>
                      <td>
                        {u.is_active ? <Badge value="active" /> : <Badge value="suspended" />}
                        {u.suspended_reason && <div className="muted small">{u.suspended_reason}</div>}
                      </td>
                      <td className="nowrap">{fmtDate(u.created_at)}</td>
                      <td>
                        <div className="row gap-xs">
                        {u.role !== "member" && !u.mfa_enabled_at && u.is_active && (
                          <button type="button" className="btn btn-sm" onClick={() => setPending({ kind: "mfaCode", user: u })}>
                            2FA setup code<span className="sr-only"> for {u.full_name}</span>
                          </button>
                        )}
                        {u.is_active ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            disabled={self}
                            onClick={() => {
                              setReason("");
                              setPending({ kind: "suspend", user: u });
                            }}
                          >
                            Suspend<span className="sr-only"> {u.full_name}</span>
                          </button>
                        ) : (
                          <button type="button" className="btn btn-sm" onClick={() => setPending({ kind: "reactivate", user: u })}>
                            Reactivate<span className="sr-only"> {u.full_name}</span>
                          </button>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {res.data && <Pager page={page} pageSize={PAGE_SIZE} total={res.data.total} onPage={setPage} />}
        </DataState>
      </div>
      {pending?.kind === "role" && (
        <ConfirmDialog
          title="Change role"
          danger={pending.role === "admin"}
          confirmLabel={`Make ${pending.role}`}
          message={
            <>
              Change <strong>{pending.user.full_name}</strong> from <strong>{pending.user.role}</strong> to <strong>{pending.role}</strong>?
              {pending.role !== "member" && " Staff roles grant access to private documents and moderation tools."}
            </>
          }
          onCancel={() => setPending(null)}
          onConfirm={apply}
        />
      )}
      {pending?.kind === "suspend" && (
        <ConfirmDialog
          title="Suspend account"
          danger
          confirmLabel="Suspend account"
          disabled={!reason.trim()}
          message={
            <>
              Suspend <strong>{pending.user.full_name}</strong>? They are signed out of new requests and their active listings are suspended.
            </>
          }
          onCancel={() => setPending(null)}
          onConfirm={apply}
        >
          <div className="field">
            <label htmlFor="suspend-reason">Reason (required, recorded in the audit log)</label>
            <textarea id="suspend-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </ConfirmDialog>
      )}
      {pending?.kind === "mfaCode" && (
        <ConfirmDialog
          title="Issue two-factor setup code"
          confirmLabel="Issue code"
          message={
            <>
              Create a one-time code that lets <strong>{pending.user.full_name}</strong> set up two-factor authentication. It is
              valid for 24 hours and replaces any earlier code. Give it to them in person or by phone, not by email.
            </>
          }
          onCancel={() => setPending(null)}
          onConfirm={apply}
        />
      )}
      {issued && (
        <Modal
          title="Two-factor setup code"
          onClose={() => setIssued(null)}
          footer={
            <button type="button" className="btn btn-primary" onClick={() => setIssued(null)}>
              Done
            </button>
          }
        >
          <p>
            Code for <strong>{issued.user.full_name}</strong>, valid until {fmtDate(issued.expires_at)}. It is shown only now.
          </p>
          <p>
            <code className="mono secret" aria-label="Setup code">
              {issued.code}
            </code>
          </p>
          <p className="muted small">They enter it under Account security, together with their password.</p>
        </Modal>
      )}
      {pending?.kind === "reactivate" && (
        <ConfirmDialog
          title="Reactivate account"
          confirmLabel="Reactivate"
          message={
            <>
              Reactivate <strong>{pending.user.full_name}</strong>? Previously suspended listings stay suspended until reinstated by moderation.
            </>
          }
          onCancel={() => setPending(null)}
          onConfirm={apply}
        />
      )}
    </>
  );
}

export default function UsersPage() {
  return (
    <RequirePermission permission="user.manage">
      <Users />
    </RequirePermission>
  );
}
