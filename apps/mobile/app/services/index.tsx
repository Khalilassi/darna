import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useServiceProviders } from "../../src/api/queries";
import { useAuth } from "../../src/auth/AuthProvider";
import { ChipGroup, EmptyState, ErrorState, LoadingState, Notice, Screen, T } from "../../src/components";
import { ProviderCard, ServicesDisclaimer } from "../../src/features/Services";
import { isServiceCategory, SERVICE_CATEGORIES, type Provider, type ServiceCategory } from "../../src/lib/services";

/** Directory of verified, independent professionals. Params: `category` (pre-selected chip), `dealId` (carried to requests). */
export default function ServicesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { status } = useAuth();
  const params = useLocalSearchParams<{ category?: string; dealId?: string }>();
  const dealId = typeof params.dealId === "string" && params.dealId ? params.dealId : undefined;
  const [category, setCategory] = useState<ServiceCategory | "all">(isServiceCategory(params.category) ? params.category : "all");
  const [linkError, setLinkError] = useState(false);
  const q = useServiceProviders();

  const providers = useMemo(
    () => (q.data ?? []).filter((p) => category === "all" || p.category === category),
    [q.data, category],
  );
  const options = [{ value: "all" as const, label: t("services.allCategories") }, ...SERVICE_CATEGORIES.map((c) => ({ value: c, label: t(`services.category.${c}`) }))];

  const request = (p: Provider) => {
    const path = `/services/request/${p.id}${dealId ? `?dealId=${encodeURIComponent(dealId)}` : ""}`;
    router.push(status === "signedIn" ? path : "/login");
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()} testID="services-screen">
      <View style={{ gap: 4 }}>
        <T variant="title" accessibilityRole="header">{t("services.title")}</T>
        <T tone="muted">{t("services.intro")}</T>
      </View>
      <ServicesDisclaimer />
      {dealId ? <Notice tone="info" testID="services-for-deal">{t("services.forDeal")}</Notice> : null}
      <ChipGroup scroll label={t("services.categoriesLabel")} options={options} value={category} onChange={(v) => setCategory(v ?? "all")} />
      {linkError ? <Notice tone="danger">{t("services.linkFailed")}</Notice> : null}
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : providers.length === 0 ? (
        <EmptyState icon="briefcase-outline" title={t("services.empty")} body={t("services.emptyBody")} testID="services-empty" />
      ) : (
        providers.map((p) => <ProviderCard key={p.id} provider={p} onRequest={request} onLinkError={() => setLinkError(true)} />)
      )}
    </Screen>
  );
}
