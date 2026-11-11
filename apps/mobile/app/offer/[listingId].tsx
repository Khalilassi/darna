import React, { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { api, unwrap } from "../../src/api/client";
import { errorMessage, fieldErrors as toFieldErrors } from "../../src/api/errors";
import { qk, useListing } from "../../src/api/queries";
import { ErrorState, LoadingState, Screen, Segmented, SignInRequired, T } from "../../src/components";
import { OfferForm, type OfferPayload } from "../../src/features/OfferForm";
import { useIdempotencyKeys } from "../../src/lib/idempotency";

export default function MakeOffer() {
  return (
    <SignInRequired>
      <OfferScreen />
    </SignInRequired>
  );
}

function OfferScreen() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const listing = useListing(listingId);
  const withKey = useIdempotencyKeys();
  const [kind, setKind] = useState<Schemas["DealKind"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  if (listing.isPending) return <LoadingState />;
  if (listing.isError) return <ErrorState error={listing.error} onRetry={() => void listing.refetch()} />;
  const l = listing.data;
  const kinds: Schemas["DealKind"][] = l.purpose === "sale" ? ["sale"] : l.purpose === "rent" ? ["rent"] : ["sale", "rent"];
  const active = kind ?? kinds[0];

  const submit = async (p: OfferPayload) => {
    setBusy(true);
    setError(null);
    setFe({});
    const body: Schemas["OfferIn"] = { listing_id: l.id, kind: active, ...p };
    try {
      const deal = await withKey("offer", body, async (key) =>
        unwrap(await api.POST("/deals/offers", { params: { header: { "idempotency-key": key } }, body })));
      void qc.invalidateQueries({ queryKey: qk.deals });
      void qc.invalidateQueries({ queryKey: qk.listing(l.id) });
      router.replace(`/deal/${deal.id}`);
    } catch (e) {
      setError(errorMessage(e, t));
      setFe(toFieldErrors(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: active === "rent" ? t("offer.titleRent") : t("offer.titleSale") }} />
      <T variant="heading">{l.title}</T>
      {kinds.length > 1 ? (
        <Segmented value={active} onChange={setKind} options={kinds.map((k) => ({ value: k, label: t(`enum.dealKind.${k}`) }))} />
      ) : null}
      <OfferForm
        key={active}
        kind={active}
        asking={active === "sale" ? l.sale_cash_price : l.monthly_rent}
        initialTerms={active === "rent" ? { lease_months: l.rent_terms?.min_lease_months ?? 12, start_date: l.rent_terms?.available_from ?? null } : undefined}
        submitLabel={t("offer.submit")}
        onSubmit={(p) => void submit(p)}
        busy={busy}
        error={error}
        fieldErrors={fe}
      />
    </Screen>
  );
}
