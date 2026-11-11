"use client";

import { useState } from "react";
import { useApi, useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { ConfirmDialog } from "./ui";

/** Maintenance: expires offers past their deadline (POST /admin/maintenance/expire-offers). */
export function ExpireOffersButton({ onDone }: { onDone?: () => void }) {
  const api = useApi();
  const { can } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (!can("deal.monitor")) return null;
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Expire stale offers
      </button>
      {open && (
        <ConfirmDialog
          title="Expire stale offers"
          message="All pending offers past their expiry time will be marked expired. Parties are notified. This cannot be undone."
          confirmLabel="Expire offers"
          onCancel={() => setOpen(false)}
          onConfirm={async () => {
            try {
              const res = await api.expireOffers();
              toast.success(`${res.expired} stale offer${res.expired === 1 ? "" : "s"} expired.`);
              setOpen(false);
              onDone?.();
            } catch (e) {
              toast.error(e);
            }
          }}
        />
      )}
    </>
  );
}
