import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { api, unwrap } from "../../src/api/client";
import { errorCode, errorMessage, fieldErrors } from "../../src/api/errors";
import { qk, useProjects } from "../../src/api/queries";
import { Button, Card, ChipGroup, Notice, QueryView, Row, Screen, Section, Select, SignInRequired, T, TextField } from "../../src/components";
import { ClaimForm } from "../../src/features/ClaimForm";
import { parseAmountInput } from "../../src/i18n/format";
import { useLanguage } from "../../src/i18n/LanguageProvider";
import { DELIVERY, enumOptions, FINISHINGS, ORIENTATIONS, PROPERTY_TYPES, UNIT_REQUIRED } from "../../src/lib/enums";
import { validateInt } from "../../src/lib/validation";

type Identity = Pick<Schemas["PropertyIn"], "project_id" | "district_id" | "property_type" | "group_code" | "building_code" | "unit_code">;

export default function RegisterProperty() {
  return (
    <SignInRequired>
      <Flow />
    </SignInRequired>
  );
}

function Flow() {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const qc = useQueryClient();
  const projects = useProjects();
  const [id, setId] = useState<Partial<Identity>>({ property_type: "apartment" });
  const [idErrors, setIdErrors] = useState<Record<string, string | undefined>>({});
  const [specs, setSpecs] = useState({ floor: "", area: "", garden: "", bedrooms: "", bathrooms: "" });
  const [finishing, setFinishing] = useState<Schemas["Finishing"]>("fully_finished");
  const [delivery, setDelivery] = useState<Schemas["DeliveryStatus"]>("ready");
  const [orientation, setOrientation] = useState<Schemas["Orientation"] | undefined>();
  const [specErrors, setSpecErrors] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    if (!id.project_id && projects.data?.length) setId((x) => ({ ...x, project_id: projects.data[0].id }));
  }, [projects.data, id.project_id]);

  const project = projects.data?.find((p) => p.id === id.project_id);
  const unitNeeded = id.property_type ? UNIT_REQUIRED.includes(id.property_type) : true;
  const setField = (k: keyof Identity, v: string | undefined) => setId((x) => ({ ...x, [k]: v }));
  const register = useMutation({
    mutationFn: async (claim: Schemas["ClaimIn"]) => {
      const property: Schemas["PropertyIn"] = {
        ...(id as Identity),
        unit_code: unitNeeded ? id.unit_code : null,
        floor: specs.floor.trim() ? Number(specs.floor) : null,
        area_sqm: parseAmountInput(specs.area)!,
        garden_sqm: specs.garden.trim() ? parseAmountInput(specs.garden) : null,
        bedrooms: Number(parseAmountInput(specs.bedrooms)),
        bathrooms: Number(parseAmountInput(specs.bathrooms)),
        finishing,
        delivery_status: delivery,
        orientation: orientation ?? null,
      };
      return unwrap(await api.POST("/properties", { body: { property, claim } }));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.myProperties }),
    onError: (e) => {
      const fe = fieldErrors(e);
      setSpecErrors((s) => ({ ...s, ...Object.fromEntries(Object.entries(fe).map(([k, v]) => [k.replace(/^property\./, ""), v])) }));
    },
  });

  const identityValid = () => {
    const e = {
      district_id: id.district_id ? undefined : t("validation.choose"),
      group_code: id.group_code?.trim() ? undefined : t("validation.required"),
      building_code: id.building_code?.trim() ? undefined : t("validation.required"),
      unit_code: unitNeeded && !id.unit_code?.trim() ? t("validation.required") : undefined,
    };
    setIdErrors(e);
    return !Object.values(e).some(Boolean);
  };

  const specsValid = () => {
    const area = parseAmountInput(specs.area);
    const e = {
      area_sqm: area === null || area <= 10 || area > 5000 ? t("validation.range", { min: 10, max: 5000 }) : undefined,
      bedrooms: validateInt(specs.bedrooms, t, 0, 12),
      bathrooms: validateInt(specs.bathrooms, t, 1, 12),
      floor: specs.floor.trim() && !/^-?\d+$/.test(specs.floor.trim()) ? t("validation.integer") : undefined,
    };
    setSpecErrors(e);
    return !Object.values(e).some(Boolean);
  };

  if (register.isSuccess)
    return (
      <Screen>
        <Notice tone="success">{register.data.claimed_existing ? t("property.claimedExisting") : t("property.registered")}</Notice>
        <Button title={t("common.done")} onPress={() => router.replace("/owner")} />
      </Screen>
    );

  return (
    <Screen>
      <QueryView query={projects}>
        {(list) => (
          <Section title={t("property.identityStep")}>
            <T variant="caption" tone="muted">{t("property.identityHelp")}</T>
            {list.length > 1 ? (
              <Select label={t("property.project")} value={id.project_id} onChange={(v) => setField("project_id", v)} options={list.map((p) => ({ value: p.id, label: lang === "ar" ? p.name_ar : p.name_en }))} />
            ) : null}
            <Select
              label={t("property.district")}
              value={id.district_id}
              onChange={(v) => setField("district_id", v)}
              placeholder={t("common.select")}
              options={(project?.districts ?? []).map((d) => ({ value: d.id, label: lang === "ar" ? d.name_ar : d.name_en }))}
              error={idErrors.district_id}
              testID="pn-district"
            />
            <ChipGroup label={t("property.type")} value={id.property_type} onChange={(v) => v && setField("property_type", v)} options={enumOptions(PROPERTY_TYPES, "propertyType", t)} />
            <Row gap={8} style={{ alignItems: "flex-start" }}>
              <TextField containerStyle={{ flex: 1 }} label={t("property.group")} value={id.group_code ?? ""} onChangeText={(v) => setField("group_code", v)} autoCapitalize="characters" error={idErrors.group_code} testID="pn-group" />
              <TextField containerStyle={{ flex: 1 }} label={unitNeeded ? t("property.building") : t("property.buildingVilla")} value={id.building_code ?? ""} onChangeText={(v) => setField("building_code", v)} autoCapitalize="characters" error={idErrors.building_code} testID="pn-building" />
            </Row>
            {unitNeeded ? (
              <TextField label={t("property.unit")} value={id.unit_code ?? ""} onChangeText={(v) => setField("unit_code", v)} autoCapitalize="characters" error={idErrors.unit_code} testID="pn-unit" />
            ) : null}
          </Section>
        )}
      </QueryView>

      <>
          <Section title={t("property.specsStep")}>
            <Row gap={8} style={{ alignItems: "flex-start" }}>
              <TextField containerStyle={{ flex: 1 }} label={t("property.area")} value={specs.area} onChangeText={(v) => setSpecs({ ...specs, area: v })} keyboardType="decimal-pad" error={specErrors.area_sqm} />
              <TextField containerStyle={{ flex: 1 }} label={t("property.garden")} value={specs.garden} onChangeText={(v) => setSpecs({ ...specs, garden: v })} keyboardType="decimal-pad" optional optionalLabel={t("common.optional")} />
            </Row>
            <Row gap={8} style={{ alignItems: "flex-start" }}>
              <TextField containerStyle={{ flex: 1 }} label={t("property.bedrooms")} value={specs.bedrooms} onChangeText={(v) => setSpecs({ ...specs, bedrooms: v })} keyboardType="number-pad" error={specErrors.bedrooms} />
              <TextField containerStyle={{ flex: 1 }} label={t("property.bathrooms")} value={specs.bathrooms} onChangeText={(v) => setSpecs({ ...specs, bathrooms: v })} keyboardType="number-pad" error={specErrors.bathrooms} />
              <TextField containerStyle={{ flex: 1 }} label={t("property.floor")} value={specs.floor} onChangeText={(v) => setSpecs({ ...specs, floor: v })} keyboardType="numbers-and-punctuation" error={specErrors.floor} optional />
            </Row>
            <ChipGroup label={t("property.finishing")} value={finishing} onChange={(v) => v && setFinishing(v)} options={enumOptions(FINISHINGS, "finishing", t)} />
            <ChipGroup label={t("property.delivery")} value={delivery} onChange={(v) => v && setDelivery(v)} options={enumOptions(DELIVERY, "delivery", t)} />
            <ChipGroup label={t("property.orientation")} value={orientation} allowClear onChange={setOrientation} options={enumOptions(ORIENTATIONS, "orientation", t)} />
          </Section>
          <Section title={t("property.claimStep")}>
            <ClaimForm
              submitLabel={t("property.submit")}
              onSubmit={(c) => {
                const okId = identityValid();
                if (specsValid() && okId) register.mutate(c);
              }}
              busy={register.isPending}
              error={register.isError ? errorMessage(register.error, t) : null}
            />
          </Section>
      </>
    </Screen>
  );
}
