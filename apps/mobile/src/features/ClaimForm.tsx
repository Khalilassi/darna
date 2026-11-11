import React, { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { Button, ChipGroup, DocumentUploader, MultiChipGroup, Notice, T, TextField } from "../components";
import { validateDate } from "../lib/validation";

const CLAIM_DOC_KINDS: Schemas["DocumentKind"][] = ["ownership_contract", "developer_statement", "power_of_attorney", "payment_receipt", "other"];
type Scope = "list" | "negotiate" | "sign";

/** Ownership claim: capacity (owner / legal representative), authority, documents, note. */
export function ClaimForm({
  submitLabel, onSubmit, busy, error,
}: { submitLabel: string; onSubmit: (c: Schemas["ClaimIn"]) => void; busy?: boolean; error?: string | null }) {
  const { t } = useTranslation();
  const [capacity, setCapacity] = useState<Schemas["ClaimCapacity"]>("owner");
  const [principal, setPrincipal] = useState("");
  const [scope, setScope] = useState<Scope[]>(["list", "negotiate"]);
  const [expiry, setExpiry] = useState("");
  const [docs, setDocs] = useState<Schemas["DocumentOut"][]>([]);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const rep = capacity === "legal_representative";

  const submit = () => {
    const kinds = new Set(docs.map((d) => d.kind));
    const e: Record<string, string | undefined> = {
      docs: !kinds.has("ownership_contract") && !kinds.has("developer_statement") ? t("claim.needOwnershipDoc") : rep && !kinds.has("power_of_attorney") ? t("claim.needPoa") : undefined,
      principal: rep && principal.trim().length < 2 ? t("validation.required") : undefined,
      scope: rep && !scope.length ? t("claim.needScope") : undefined,
      expiry: rep ? validateDate(expiry, t, { future: true }) : undefined,
    };
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    onSubmit({
      capacity,
      principal_name: rep ? principal.trim() : null,
      authority_scope: rep ? scope : [],
      authority_expires_on: rep && expiry.trim() ? expiry.trim() : null,
      document_ids: docs.map((d) => d.id),
      note: note.trim() || null,
    });
  };

  return (
    <View style={{ gap: 16 }}>
      <ChipGroup
        label={t("claim.capacity")}
        value={capacity}
        onChange={(c) => c && setCapacity(c)}
        options={(["owner", "legal_representative"] as const).map((c) => ({ value: c, label: t(`enum.capacity.${c}`) }))}
      />
      {rep ? (
        <>
          <TextField label={t("claim.principal")} value={principal} onChangeText={setPrincipal} maxLength={160} error={errors.principal} />
          <MultiChipGroup
            label={t("claim.scope")}
            values={scope}
            onChange={setScope}
            options={(["list", "negotiate", "sign"] as const).map((s) => ({ value: s, label: t(`enum.scope.${s}`) }))}
            error={errors.scope}
          />
          <TextField label={t("claim.expiry")} placeholder="YYYY-MM-DD" value={expiry} onChangeText={setExpiry} optional optionalLabel={t("common.optional")} error={errors.expiry} />
        </>
      ) : null}
      <T variant="caption" tone="muted">{t("claim.docsHelp")}</T>
      <DocumentUploader label={t("claim.docs")} kinds={CLAIM_DOC_KINDS} docs={docs} onChange={setDocs} error={errors.docs} />
      <TextField label={t("claim.note")} value={note} onChangeText={setNote} multiline maxLength={1000} optional optionalLabel={t("common.optional")} />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button title={submitLabel} onPress={submit} loading={busy} size="lg" fullWidth testID="claim-submit" />
    </View>
  );
}
