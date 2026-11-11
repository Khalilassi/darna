import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useProjects } from "../src/api/queries";
import { Button, ChipGroup, MultiChipGroup, Row, Screen, Section, Select, TextField } from "../src/components";
import { parseAmountInput } from "../src/i18n/format";
import { useLanguage } from "../src/i18n/LanguageProvider";
import { DELIVERY, enumOptions, FINISHINGS, ORIENTATIONS, PAYMENT_MODES, PROPERTY_TYPES } from "../src/lib/enums";
import { emptyFilters, useFilters, type Filters } from "../src/state/filters";

const numStr = (n: number | undefined) => (n === undefined ? "" : String(n));
const toNum = (s: string) => {
  const n = parseAmountInput(s);
  return n === null ? undefined : n;
};

export default function FiltersScreen() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const { filters, setFilters } = useFilters();
  const projects = useProjects();
  const [draft, setDraft] = useState<Filters>(filters);
  const [text, setText] = useState({
    area_min: numStr(filters.area_min), area_max: numStr(filters.area_max),
    price_min: numStr(filters.price_min), price_max: numStr(filters.price_max),
    floor_min: numStr(filters.floor_min), floor_max: numStr(filters.floor_max),
  });
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const project = projects.data?.find((p) => p.id === draft.project_id);
  const counts = [0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: n === 0 ? t("common.any") : `${new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en").format(n)}+` }));
  const rangeError = (a?: number, b?: number) => (a !== undefined && b !== undefined && a > b ? t("validation.range", { min: a, max: b }) : undefined);

  const apply = () => {
    const next: Filters = {
      ...draft,
      area_min: toNum(text.area_min), area_max: toNum(text.area_max),
      price_min: toNum(text.price_min), price_max: toNum(text.price_max),
      floor_min: text.floor_min.trim() ? Number(text.floor_min) : undefined,
      floor_max: text.floor_max.trim() ? Number(text.floor_max) : undefined,
      group_code: draft.group_code?.trim() || undefined,
    };
    if (rangeError(next.area_min, next.area_max) || rangeError(next.price_min, next.price_max)) return;
    setFilters(next);
    router.back();
  };

  return (
    <Screen
      footer={
        <Row>
          <Button title={t("filters.reset")} variant="outline" onPress={() => {
            setDraft(emptyFilters({ project_id: filters.project_id, q: filters.q }));
            setText({ area_min: "", area_max: "", price_min: "", price_max: "", floor_min: "", floor_max: "" });
          }} />
          <Button title={t("filters.show")} onPress={apply} style={{ flex: 1 }} testID="apply-filters" />
        </Row>
      }
    >
      <ChipGroup
        label={t("filters.purpose")}
        value={draft.purpose}
        allowClear
        onChange={(v) => set("purpose", v)}
        options={[{ value: "sale" as const, label: t("explore.buy") }, { value: "rent" as const, label: t("explore.rent") }]}
      />
      {project ? (
        <Section>
          <Select
            label={t("filters.district")}
            value={draft.district_id}
            allowClear
            clearLabel={t("filters.allDistricts")}
            placeholder={t("filters.allDistricts")}
            onChange={(v) => set("district_id", v)}
            options={project.districts.map((d) => ({ value: d.id, label: lang === "ar" ? d.name_ar : d.name_en }))}
            testID="district-select"
          />
          <TextField label={t("filters.group")} placeholder={t("filters.groupPlaceholder")} value={draft.group_code ?? ""} onChangeText={(v) => set("group_code", v)} autoCapitalize="characters" />
        </Section>
      ) : null}
      <MultiChipGroup label={t("filters.propertyType")} values={draft.property_type} onChange={(v) => set("property_type", v)} options={enumOptions(PROPERTY_TYPES, "propertyType", t)} />
      <ChipGroup label={t("filters.bedrooms")} value={draft.bedrooms_min ?? 0} onChange={(v) => set("bedrooms_min", v ? v : undefined)} options={counts} />
      <ChipGroup label={t("filters.bathrooms")} value={draft.bathrooms_min ?? 0} onChange={(v) => set("bathrooms_min", v ? v : undefined)} options={counts.slice(0, 5)} />
      <Section title={draft.purpose === "rent" ? t("filters.priceRent") : t("filters.price")}>
        <Row gap={12}>
          <TextField containerStyle={{ flex: 1 }} label={t("filters.min")} value={text.price_min} onChangeText={(v) => setText((x) => ({ ...x, price_min: v }))} keyboardType="numeric" />
          <TextField containerStyle={{ flex: 1 }} label={t("filters.max")} value={text.price_max} onChangeText={(v) => setText((x) => ({ ...x, price_max: v }))} keyboardType="numeric" error={rangeError(toNum(text.price_min), toNum(text.price_max))} />
        </Row>
      </Section>
      <Section title={t("filters.area")}>
        <Row gap={12}>
          <TextField containerStyle={{ flex: 1 }} label={t("filters.min")} value={text.area_min} onChangeText={(v) => setText((x) => ({ ...x, area_min: v }))} keyboardType="numeric" />
          <TextField containerStyle={{ flex: 1 }} label={t("filters.max")} value={text.area_max} onChangeText={(v) => setText((x) => ({ ...x, area_max: v }))} keyboardType="numeric" error={rangeError(toNum(text.area_min), toNum(text.area_max))} />
        </Row>
      </Section>
      <Section title={t("filters.floor")}>
        <Row gap={12}>
          <TextField containerStyle={{ flex: 1 }} label={t("filters.min")} value={text.floor_min} onChangeText={(v) => setText((x) => ({ ...x, floor_min: v.replace(/[^-0-9]/g, "") }))} keyboardType="numbers-and-punctuation" />
          <TextField containerStyle={{ flex: 1 }} label={t("filters.max")} value={text.floor_max} onChangeText={(v) => setText((x) => ({ ...x, floor_max: v.replace(/[^-0-9]/g, "") }))} keyboardType="numbers-and-punctuation" />
        </Row>
      </Section>
      <MultiChipGroup label={t("filters.finishing")} values={draft.finishing} onChange={(v) => set("finishing", v)} options={enumOptions(FINISHINGS, "finishing", t)} />
      <ChipGroup label={t("filters.delivery")} value={draft.delivery_status} allowClear onChange={(v) => set("delivery_status", v)} options={enumOptions(DELIVERY, "delivery", t)} />
      <MultiChipGroup label={t("filters.orientation")} values={draft.orientation} onChange={(v) => set("orientation", v)} options={enumOptions(ORIENTATIONS, "orientation", t)} />
      {draft.purpose !== "rent" ? (
        <ChipGroup label={t("filters.paymentMode")} value={draft.payment_mode} allowClear onChange={(v) => set("payment_mode", v)} options={enumOptions(PAYMENT_MODES, "paymentMode", t)} />
      ) : null}
      <ChipGroup
        label={t("filters.furnished")}
        value={draft.furnished}
        allowClear
        onChange={(v) => set("furnished", v)}
        options={[{ value: true, label: t("common.yes") }, { value: false, label: t("common.no") }]}
      />
    </Screen>
  );
}
