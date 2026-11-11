import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../../../src/api/client";
import { errorMessage, fieldErrors } from "../../../src/api/errors";
import { qk, useMyListing } from "../../../src/api/queries";
import { QueryView, Screen, SignInRequired } from "../../../src/components";
import { initialListingForm, ListingForm, listingPayload, type ListingFormState } from "../../../src/features/ListingForm";

export default function EditListing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useMyListing(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const submit = async (s: ListingFormState) => {
    setBusy(true);
    setError(null);
    const p = listingPayload(s);
    try {
      unwrap(await api.PATCH("/listings/{listing_id}", {
        params: { path: { listing_id: id } },
        body: {
          ...p,
          sale_terms: p.sale_terms ?? undefined,
          rent_terms: p.rent_terms ?? undefined,
          clear_sale_terms: !p.sale_terms,
          clear_rent_terms: !p.rent_terms,
        },
      }));
      void qc.invalidateQueries({ queryKey: qk.myListing(id) });
      void qc.invalidateQueries({ queryKey: qk.myListings });
      router.back();
    } catch (e) {
      setServerErrors(fieldErrors(e));
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SignInRequired>
      <Screen>
        <QueryView query={q}>
          {(l) => <ListingForm initial={initialListingForm(l)} submitLabel={t("listingForm.saveChanges")} onSubmit={(s) => void submit(s)} busy={busy} error={error} serverErrors={serverErrors} />}
        </QueryView>
      </Screen>
    </SignInRequired>
  );
}
