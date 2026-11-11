"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { errorMessage, isForbidden } from "@/lib/errors";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="row gap-sm">{actions}</div>}
    </header>
  );
}

/** Loading / error / empty wrapper used by every table. */
export function DataState({
  loading,
  error,
  empty,
  emptyText = "Nothing here.",
  onRetry,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty: boolean;
  emptyText?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading)
    return (
      <div className="state" role="status" aria-busy="true">
        <span className="spinner" aria-hidden /> Loading…
      </div>
    );
  if (error)
    return (
      <div className="state state-error" role="alert">
        <strong>{isForbidden(error) ? "No access" : "Could not load data"}</strong>
        <span>{errorMessage(error)}</span>
        {onRetry && !isForbidden(error) && (
          <button type="button" className="btn" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  if (empty) return <div className="state state-empty">{emptyText}</div>;
  return <>{children}</>;
}

const TONES: Record<string, string> = {
  approved: "success", active: "success", resolved: "success", completed: "success", lease_active: "success",
  resolved_for_existing: "success", resolved_for_challenger: "success",
  rejected: "danger", suspended: "danger", revoked: "danger", cancelled: "danger", fraud: "danger", disputed: "danger",
  submitted: "info", pending_review: "info", open: "info", negotiating: "info",
  under_review: "warning", more_info_required: "warning", in_progress: "warning", under_offer: "warning",
};

export function Badge({ value, tone }: { value: string; tone?: string }) {
  return <span className={`badge badge-${tone ?? TONES[value] ?? "neutral"}`}>{value.replace(/_/g, " ")}</span>;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = () =>
      Array.from(node?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? []).filter(
        (el) => !el.hasAttribute("disabled"),
      );
    (focusable()[0] ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = focusable();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <h2 id={titleId}>{title}</h2>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation dialog for destructive or consequential actions. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  children,
  disabled,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={() => !busy && onCancel()}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            disabled={busy || disabled}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } catch {
                /* the caller reports failures (toast); keep the dialog open so the user can retry */
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack gap-sm">
        <div>{message}</div>
        {children}
      </div>
    </Modal>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="pager" aria-label="Pagination">
      <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="muted">
        Page {page} of {pages} · {total} total
      </span>
      <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

export function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}
