import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useListingPerformance } from "../../../src/api/queries";
import { ErrorState, LoadingState, Screen, Segmented, SignInRequired } from "../../../src/components";
import { PerformanceView } from "../../../src/features/PerformanceView";
import { formatNumber } from "../../../src/i18n/format";
import { useLanguage } from "../../../src/i18n/LanguageProvider";
import { PERIODS } from "../../../src/lib/performance";

export default function ListingPerformance() {
  return (
    <SignInRequired>
      <Performance />
    </SignInRequired>
  );
}

function Performance() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const [days, setDays] = useState<string>("30");
  const q = useListingPerformance(id, Number(days));

  return (
    <Screen testID="perf-screen" refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Segmented
        value={days}
        onChange={setDays}
        options={PERIODS.map((p) => ({ value: String(p), label: t("perf.days", { value: formatNumber(p, lang) }) }))}
        testID="perf-period"
      />
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <PerformanceView data={q.data} />
      )}
    </Screen>
  );
}
