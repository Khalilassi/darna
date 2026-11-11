"use client";

import { useMemo, useState } from "react";
import { RequirePermission } from "@/components/Shell";
import { ProviderForm } from "@/components/ProviderForm";
import { Badge, ConfirmDialog, DataState, Modal, PageHeader } from "@/components/ui";
import type { ServiceProvider } from "@/lib/adminApi";
import { useApi } from "@/lib/auth";
import { CATEGORY_LABELS, formFromProvider, hasDisclosure, providerBody, type ProviderForm as Form } from "@/lib/serviceProviders";
import { useToast } from "@/lib/toast";
import { useAsync } from "@/lib/useAsync";

type Pending = { kind: "verify" | "unverify" | "activate" | "deactivate"; provider: ServiceProvider };

const CONFIRM: Record<Pending["kind"], { title: string; label: string; danger?: boolean; text: string }> = {
  verify: {
    title: "Verify provider",
    label: "Mark verified",
    text: "Confirm you have checked this provider's identity, license and contact details. Verified, active providers are listed to members.",
  },
  unverify: {
    title: "Remove verification",
    label: "Remove verification",
    danger: true,
    text: "The provider is hidden from members immediately and new referral requests are refused.",
  },
  activate: { title: "Activate provider", label: "Activate", text: "If verified, the provider becomes visible to members." },
  deactivate: {
    title: "Deactivate provider",
    label: "Deactivate",
    danger: true,
    text: "The provider is hidden from members and new referral requests are refused. Existing requests are kept.",
  },
};

function Providers() {
  const api = useApi();
  const toast = useToast();
  const res = useAsync(() => api.serviceProviders(), []);
  const projectsRes = useAsync(() => api.projects(), []);
  const projects = useMemo(() => projectsRes.data ?? [], [projectsRes.data]);
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name_en])), [projects]);
  const [editing, setEditing] = useState<ServiceProvider | "new" | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  async function save(form: Form) {
    try {
      const body = providerBody(form);
      if (editing === "new") {
        const p = await api.createProvider({ ...body, is_active: true });
        toast.success(`${p.name_en} added. Verify it to list it to members.`);
      } else if (editing) {
        await api.updateProvider(editing.id, body);
        toast.success(`${body.name_en} updated.`);
      }
      setEditing(null);
      res.reload();
    } catch (e) {
      toast.error(e);
      throw e;
    }
  }

  async function apply() {
    if (!pending) return;
    const { kind, provider } = pending;
    try {
      await api.updateProvider(
        provider.id,
        kind === "verify" || kind === "unverify" ? { verified: kind === "verify" } : { is_active: kind === "activate" },
      );
      toast.success(
        {
          verify: `${provider.name_en} is verified.`,
          unverify: `${provider.name_en} is no longer verified.`,
          activate: `${provider.name_en} activated.`,
          deactivate: `${provider.name_en} deactivated.`,
        }[kind],
      );
      setPending(null);
      res.reload();
    } catch (e) {
      toast.error(e);
      throw e;
    }
  }

  const communities = (ids: string[]) => (ids.length ? ids.map((id) => projectName.get(id) ?? id.slice(0, 8)).join(", ") : "All communities");

  return (
    <>
      <PageHeader
        title="Service providers"
        description="Independent professionals listed to members. Only verified, active providers are visible; Darna is not a party to their services."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            Add provider
          </button>
        }
      />
      <div className="card flush">
        <DataState loading={res.loading} error={res.error} empty={!res.data?.length} emptyText="No service providers yet." onRetry={res.reload}>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Service providers</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Name</th>
                  <th scope="col">Verified</th>
                  <th scope="col">Active</th>
                  <th scope="col">Communities</th>
                  <th scope="col">Referral-fee disclosure</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {res.data?.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{CATEGORY_LABELS[p.category]}</td>
                    <td>
                      <div>{p.name_en}</div>
                      <div className="muted small" dir="rtl" lang="ar">
                        {p.name_ar}
                      </div>
                      {p.license_number && <div className="muted small">License {p.license_number}</div>}
                    </td>
                    <td>{p.verified ? <Badge value="verified" tone="success" /> : <Badge value="unverified" tone="warning" />}</td>
                    <td>{p.is_active ? <Badge value="active" /> : <Badge value="inactive" tone="neutral" />}</td>
                    <td>{communities(p.project_ids)}</td>
                    <td>{hasDisclosure(p) ? <Badge value="yes" tone="info" /> : <span className="muted">No</span>}</td>
                    <td>
                      <div className="row gap-xs wrap">
                        <button type="button" className="btn btn-sm" onClick={() => setEditing(p)}>
                          Edit<span className="sr-only"> {p.name_en}</span>
                        </button>
                        {p.verified ? (
                          <button type="button" className="btn btn-sm" onClick={() => setPending({ kind: "unverify", provider: p })}>
                            Unverify<span className="sr-only"> {p.name_en}</span>
                          </button>
                        ) : (
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => setPending({ kind: "verify", provider: p })}>
                            Verify<span className="sr-only"> {p.name_en}</span>
                          </button>
                        )}
                        {p.is_active ? (
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => setPending({ kind: "deactivate", provider: p })}>
                            Deactivate<span className="sr-only"> {p.name_en}</span>
                          </button>
                        ) : (
                          <button type="button" className="btn btn-sm" onClick={() => setPending({ kind: "activate", provider: p })}>
                            Activate<span className="sr-only"> {p.name_en}</span>
                          </button>
                        )}
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
        <Modal wide title={editing === "new" ? "Add service provider" : `Edit ${editing.name_en}`} onClose={() => setEditing(null)}>
          <ProviderForm
            initial={editing === "new" ? undefined : formFromProvider(editing)}
            projects={projects}
            submitLabel={editing === "new" ? "Create provider" : "Save changes"}
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
      {pending && (
        <ConfirmDialog
          title={CONFIRM[pending.kind].title}
          danger={CONFIRM[pending.kind].danger}
          confirmLabel={CONFIRM[pending.kind].label}
          message={
            <>
              <strong>{pending.provider.name_en}</strong> — {CONFIRM[pending.kind].text}
            </>
          }
          onCancel={() => setPending(null)}
          onConfirm={apply}
        />
      )}
    </>
  );
}

export default function ServiceProvidersPage() {
  return (
    <RequirePermission permission="services.manage">
      <Providers />
    </RequirePermission>
  );
}
