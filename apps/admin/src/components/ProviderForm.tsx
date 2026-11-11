"use client";

import { useState, type ReactNode } from "react";
import type { Project, ServiceCategory } from "@/lib/adminApi";
import {
  CATEGORY_LABELS, EMPTY_PROVIDER_FORM, SERVICE_CATEGORIES, validateProviderForm, type ProviderForm as Form, type ProviderFormErrors,
} from "@/lib/serviceProviders";

function TextInput({
  id, label, value, onChange, error, hint, dir, type = "text", multiline, maxLength, placeholder,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  dir?: "rtl" | "ltr";
  type?: string;
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    value,
    dir,
    maxLength,
    placeholder,
    "aria-invalid": !!error || undefined,
    "aria-describedby": describedBy,
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...common} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={type} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && !error && (
        <small id={`${id}-hint`} className="muted">
          {hint}
        </small>
      )}
      {error && (
        <small id={`${id}-error`} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

/** Create / edit form for a service provider. Validates on submit; `onSubmit` reports API errors itself. */
export function ProviderForm({
  initial = EMPTY_PROVIDER_FORM,
  projects,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Form;
  projects: Project[];
  submitLabel: string;
  onSubmit: (form: Form) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState<Form>(initial);
  const [errors, setErrors] = useState<ProviderFormErrors>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const err = (k: keyof Form) => errors[k];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateProviderForm(f);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await onSubmit(f);
    } catch {
      /* the caller shows the error; keep the form open */
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack gap-sm" onSubmit={submit} noValidate aria-label="Service provider">
      <div className="field">
        <label htmlFor="pf-category">Category</label>
        <select
          id="pf-category"
          value={f.category}
          onChange={(e) => set("category")(e.target.value as ServiceCategory)}
          aria-invalid={!!err("category") || undefined}
          aria-describedby={err("category") ? "pf-category-error" : undefined}
        >
          <option value="">Choose…</option>
          {SERVICE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        {err("category") && (
          <small id="pf-category-error" className="field-error" role="alert">
            {err("category")}
          </small>
        )}
      </div>
      <div className="grid-2">
        <TextInput id="pf-name-en" label="Name (English)" value={f.name_en} onChange={set("name_en")} error={err("name_en")} maxLength={120} />
        <TextInput id="pf-name-ar" label="Name (Arabic)" value={f.name_ar} onChange={set("name_ar")} error={err("name_ar")} dir="rtl" maxLength={120} />
        <TextInput id="pf-desc-en" label="Description (English)" value={f.description_en} onChange={set("description_en")} error={err("description_en")} multiline maxLength={2000} />
        <TextInput id="pf-desc-ar" label="Description (Arabic)" value={f.description_ar} onChange={set("description_ar")} error={err("description_ar")} dir="rtl" multiline maxLength={2000} />
        <TextInput id="pf-phone" label="Phone (optional)" type="tel" value={f.phone} onChange={set("phone")} error={err("phone")} placeholder="+201001234567" hint="8–15 digits, optional leading +" />
        <TextInput id="pf-email" label="Email (optional)" type="email" value={f.email} onChange={set("email")} error={err("email")} />
        <TextInput id="pf-website" label="Website (optional)" type="url" value={f.website} onChange={set("website")} error={err("website")} placeholder="https://" />
        <TextInput id="pf-license" label="License number (optional)" value={f.license_number} onChange={set("license_number")} error={err("license_number")} maxLength={80} />
      </div>
      <fieldset className="checks">
        <legend>Communities served (none selected = all communities)</legend>
        {projects.map((p) => (
          <label key={p.id}>
            <input
              type="checkbox"
              checked={f.project_ids.includes(p.id)}
              onChange={(e) => set("project_ids")(e.target.checked ? [...f.project_ids, p.id] : f.project_ids.filter((x) => x !== p.id))}
            />{" "}
            {p.name_en}
          </label>
        ))}
        {!projects.length && <span className="muted small">No communities loaded.</span>}
      </fieldset>
      <fieldset className="stack gap-sm">
        <legend>Referral-fee disclosure (leave empty if Darna receives no fee)</legend>
        <small className="muted">Shown to members before they request a referral; they must acknowledge it. Max 300 characters.</small>
        <div className="grid-2">
          <TextInput id="pf-disc-en" label="Disclosure (English)" value={f.referral_fee_disclosure_en} onChange={set("referral_fee_disclosure_en")} error={err("referral_fee_disclosure_en")} multiline maxLength={300} />
          <TextInput id="pf-disc-ar" label="Disclosure (Arabic)" value={f.referral_fee_disclosure_ar} onChange={set("referral_fee_disclosure_ar")} error={err("referral_fee_disclosure_ar")} dir="rtl" multiline maxLength={300} />
        </div>
      </fieldset>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
