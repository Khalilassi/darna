import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { useMarketSummary, useProjects } from "../src/api/queries";
import { ErrorState, LoadingState, MultiChipGroup, Screen, Segmented, T } from "../src/components";
import { MarketSummaryView } from "../src/features/MarketSummaryView";
import { useLanguage } from "../src/i18n/LanguageProvider";
import { enumOptions, PROPERTY_TYPES } from "../src/lib/enums";
import { useFilters } from "../src/state/filters";

type PropertyType = Schemas["PropertyType"];

/** Market insights: asking-price medians per m² by district, monthly trend and methodology. */
export default function Market() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const params = useLocalSearchParams<{ purpose?: string; district?: string; property_type?: string; project?: string }>();
  const { filters } = useFilters();
  const projects = useProjects();
  // A listing link carries its own project; otherwise use the Explore project, then the first project.
  const projectId = params.project ?? filters.project_id ?? projects.data?.[0]?.id;
  const project = projects.data?.find((p) => p.id === projectId);
  const [purpose, setPurpose] = useState<"sale" | "rent">(params.purpose === "rent" ? "rent" : filters.purpose ?? "sale");
  const [types, setTypes] = useState<PropertyType[]>(
    params.property_type && (PROPERTY_TYPES as string[]).includes(params.property_type) ? [params.property_type as PropertyType] : [],
  );
  const q = useMarketSummary(projectId, purpose, types, lang);

  return (
    <Screen testID="market-screen" refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <T tone="muted">{project ? t("market.subtitle", { project: lang === "ar" ? project.name_ar : project.name_en }) : t("market.subtitleNoProject")}</T>
      <Segmented
        value={purpose}
        onChange={setPurpose}
        options={[
          { value: "sale", label: t("market.sale") },
          { value: "rent", label: t("market.rent") },
        ]}
        testID="market-purpose"
      />
      <MultiChipGroup label={t("market.propertyType")} values={types} onChange={setTypes} options={enumOptions(PROPERTY_TYPES, "propertyType", t)} />
      {projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
      ) : q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <MarketSummaryView data={q.data} highlightDistrict={params.district} />
      )}
    </Screen>
  );
}
