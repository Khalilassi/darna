import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../../src/api/client";
import { errorCode, errorMessage, fieldErrors } from "../../src/api/errors";
import { qk } from "../../src/api/queries";
import { Notice, Screen, SignInRequired } from "../../src/components";
import { initialListingForm, ListingForm, listingPayload, type ListingFormState } from "../../src/features/ListingForm";

export default function NewListing() {
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const submit = async (s: ListingFormState) => {
    setBusy(true);
    setError(null);
    try {
      const created = unwrap(await api.POST("/listings", { body: { property_id: propertyId, ...listingPayload(s) } }));
      void qc.invalidateQueries({ queryKey: qk.myListings });
      void qc.invalidateQueries({ queryKey: qk.myProperties });
      router.replace(`/owner/listing/${created.id}?created=1`);
    } catch (e) {
      setServerErrors(fieldErrors(e));
      setError(errorMessage(e, t));
      if (errorCode(e) === "property_already_listed") void qc.invalidateQueries({ queryKey: qk.myProperties });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SignInRequired>
      <Screen>
        {!propertyId ? <Notice tone="danger">{t("errors.not_found")}</Notice> : null}
        <ListingForm initial={initialListingForm()} submitLabel={t("listingForm.save")} onSubmit={(s) => void submit(s)} busy={busy} error={error} serverErrors={serverErrors} />
      </Screen>
    </SignInRequired>
  );
}
