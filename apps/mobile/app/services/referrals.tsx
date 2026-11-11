import React, { useState } from "react";
import { Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { useCancelReferral, useMyReferrals } from "../../src/api/queries";
import { EmptyState, ErrorState, LoadingState, Notice, Screen, SignInRequired } from "../../src/components";
import { ReferralRow, ServicesDisclaimer } from "../../src/features/Services";
import { referralErrorMessage } from "../../src/lib/services";

function confirmThen(message: string, ok: string, cancel: string, fn: () => void) {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(message) ?? true) fn();
    return;
  }
  Alert.alert(message, undefined, [{ text: cancel, style: "cancel" }, { text: ok, style: "destructive", onPress: fn }]);
}

export default function MyReferralsScreen() {
  const q = useMyReferrals();
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()} testID="referrals-screen">
      <SignInRequired>
        <MyReferrals />
      </SignInRequired>
    </Screen>
  );
}

function MyReferrals() {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useMyReferrals();
  const cancel = useCancelReferral();
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const onCancel = (r: Schemas["ReferralOut"]) =>
    confirmThen(t("services.referrals.cancelConfirm"), t("services.referrals.cancel"), t("common.back"), () =>
      cancel.mutate(r.id, {
        onSuccess: () => setNotice({ tone: "success", text: t("services.referrals.cancelled") }),
        onError: (e) => setNotice({ tone: "danger", text: referralErrorMessage(e, t) }),
      }),
    );

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length)
    return (
      <EmptyState
        icon="briefcase-outline"
        title={t("services.referrals.empty")}
        body={t("services.referrals.emptyBody")}
        actionLabel={t("services.referrals.browse")}
        onAction={() => router.push("/services")}
        testID="referrals-empty"
      />
    );
  return (
    <>
      {notice ? <Notice tone={notice.tone} testID="referrals-notice">{notice.text}</Notice> : null}
      {q.data.map((r) => (
        <ReferralRow key={r.id} referral={r} onCancel={onCancel} cancelling={cancel.isPending && cancel.variables === r.id} />
      ))}
      <ServicesDisclaimer />
    </>
  );
}
