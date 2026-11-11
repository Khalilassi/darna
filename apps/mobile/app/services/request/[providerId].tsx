import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useRequestReferral, useServiceProviders } from "../../../src/api/queries";
import { useAuth } from "../../../src/auth/AuthProvider";
import { Button, Card, EmptyState, ErrorState, LoadingState, Notice, Screen, SignInRequired } from "../../../src/components";
import { ReferralForm } from "../../../src/features/Services";
import { referralErrorMessage } from "../../../src/lib/services";

export default function RequestReferralScreen() {
  return (
    <Screen testID="referral-screen">
      <SignInRequired>
        <RequestReferral />
      </SignInRequired>
    </Screen>
  );
}

function RequestReferral() {
  const { t } = useTranslation();
  const router = useRouter();
  const { me } = useAuth();
  const { providerId, dealId } = useLocalSearchParams<{ providerId: string; dealId?: string }>();
  const q = useServiceProviders();
  const mutation = useRequestReferral();

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const provider = q.data.find((p) => p.id === providerId);
  if (!provider) return <EmptyState icon="briefcase-outline" title={t("services.errors.notFound")} actionLabel={t("services.referrals.browse")} onAction={() => router.replace("/services")} />;

  if (mutation.isSuccess) {
    return (
      <Card testID="referral-sent">
        <Notice tone="success">{t("services.request.sent")}</Notice>
        <Button title={t("services.request.viewMine")} onPress={() => router.replace("/services/referrals")} testID="referral-view-mine" />
        <Button title={t("common.done")} variant="outline" onPress={() => router.back()} />
      </Card>
    );
  }

  return (
    <ReferralForm
      provider={provider}
      me={me}
      dealId={typeof dealId === "string" ? dealId : null}
      submitting={mutation.isPending}
      error={mutation.isError ? referralErrorMessage(mutation.error, t) : null}
      onSubmit={(body) => mutation.mutate(body)}
      onVerifyPhone={() => router.push("/verify-phone")}
    />
  );
}
