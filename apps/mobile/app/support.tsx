import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { api, unwrap } from "../src/api/client";
import { errorMessage, fieldErrors } from "../src/api/errors";
import { qk } from "../src/api/queries";
import { Badge, Button, Card, ChipGroup, Notice, QueryView, Row, Screen, Section, SignInRequired, T, TextField } from "../src/components";
import { formatDate } from "../src/i18n/format";
import { useLanguage } from "../src/i18n/LanguageProvider";
import { enumOptions } from "../src/lib/enums";

const CATEGORIES: Schemas["SupportCategory"][] = ["broker_report", "fraud", "listing_issue", "account", "other"];

export default function Support() {
  return (
    <SignInRequired>
      <SupportForm />
    </SignInRequired>
  );
}

function SupportForm() {
  const params = useLocalSearchParams<{ category?: string; subject_type?: string; subject_id?: string }>();
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const qc = useQueryClient();
  const [category, setCategory] = useState<Schemas["SupportCategory"]>(
    CATEGORIES.includes(params.category as Schemas["SupportCategory"]) ? (params.category as Schemas["SupportCategory"]) : "broker_report",
  );
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | undefined>();
  const cases = useQuery({ queryKey: qk.supportCases, queryFn: async () => unwrap(await api.GET("/support/cases")) });
  const send = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/support/cases", {
        body: { category, description: description.trim(), subject_type: params.subject_type ?? null, subject_id: params.subject_id ?? null },
      })),
    onSuccess: () => {
      setDescription("");
      void qc.invalidateQueries({ queryKey: qk.supportCases });
    },
    onError: (e) => setError(fieldErrors(e).description),
  });
  const submit = () => {
    if (description.trim().length < 10) return setError(t("validation.minLength", { count: 10 }));
    setError(undefined);
    send.mutate();
  };
  return (
    <Screen>
      <T tone="muted">{t("support.body")}</T>
      {params.subject_type ? <Badge label={t("support.about", { type: params.subject_type })} tone="info" /> : null}
      <ChipGroup label={t("support.category")} value={category} onChange={(v) => v && setCategory(v)} options={enumOptions(CATEGORIES, "supportCategory", t)} />
      <TextField label={t("support.description")} placeholder={t("support.descriptionPlaceholder")} value={description} onChangeText={setDescription} multiline maxLength={4000} error={error} testID="support-description" />
      {send.isError && !error ? <Notice tone="danger">{errorMessage(send.error, t)}</Notice> : null}
      {send.isSuccess ? <Notice tone="success">{t("support.sent")}</Notice> : null}
      <Button title={t("support.submit")} onPress={submit} loading={send.isPending} testID="support-submit" />
      <Section title={t("support.myCases")}>
        <QueryView query={cases} isEmpty={(d) => d.length === 0} empty={<T tone="muted">{t("support.empty")}</T>}>
          {(data) =>
            data.map((c) => (
              <Card key={c.id}>
                <Row style={{ justifyContent: "space-between" }}>
                  <T variant="bodyStrong">{t(`enum.supportCategory.${c.category}`)}</T>
                  <Badge label={t(`enum.supportStatus.${c.status}`)} tone={c.status === "resolved" || c.status === "closed" ? "success" : "warning"} />
                </Row>
                <T numberOfLines={3}>{c.description}</T>
                {c.resolution_note ? <Notice tone="info">{c.resolution_note}</Notice> : null}
                <T variant="caption" tone="muted">{formatDate(c.created_at, lang)}</T>
              </Card>
            ))
          }
        </QueryView>
      </Section>
    </Screen>
  );
}
