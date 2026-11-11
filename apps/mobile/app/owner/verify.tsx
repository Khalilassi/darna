import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { api, unwrap } from "../../src/api/client";
import { errorMessage } from "../../src/api/errors";
import { qk } from "../../src/api/queries";
import { useAuth } from "../../src/auth/AuthProvider";
import { Badge, Button, DocumentUploader, Notice, Screen, SignInRequired, T, TextField } from "../../src/components";

export default function VerifyIdentity() {
  return (
    <SignInRequired>
      <VerifyForm />
    </SignInRequired>
  );
}

function VerifyForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { me, refreshMe } = useAuth();
  const [docs, setDocs] = useState<Schemas["DocumentOut"][]>([]);
  const [note, setNote] = useState("");
  const [docError, setDocError] = useState<string | null>(null);
  const identity = me?.verification.identity ?? "none";
  const submit = useMutation({
    mutationFn: async () => unwrap(await api.POST("/verifications/identity", { body: { document_ids: docs.map((d) => d.id), note: note.trim() || null } })),
    onSuccess: () => {
      void refreshMe();
      void qc.invalidateQueries({ queryKey: qk.verifications });
    },
  });
  return (
    <Screen>
      <T tone="muted">{t("verify.body")}</T>
      <Badge label={t("verify.status", { status: t(`enum.verificationStatus.${identity}`, { defaultValue: identity }) })} tone={identity === "approved" ? "verified" : "neutral"} />
      {submit.isSuccess ? (
        <>
          <Notice tone="success">{t("verify.submitted")}</Notice>
          <Button title={t("common.done")} onPress={() => router.back()} />
        </>
      ) : (
        <>
          <DocumentUploader label={t("verify.docKind")} kinds={["national_id", "passport"]} docs={docs} onChange={setDocs} error={docError} />
          <TextField label={t("verify.note")} value={note} onChangeText={setNote} multiline maxLength={1000} optional optionalLabel={t("common.optional")} />
          {submit.isError ? <Notice tone="danger">{errorMessage(submit.error, t)}</Notice> : null}
          <Button
            title={t("verify.submit")}
            loading={submit.isPending}
            onPress={() => {
              if (!docs.length) return setDocError(t("verify.needDoc"));
              setDocError(null);
              submit.mutate();
            }}
            testID="verify-submit"
          />
        </>
      )}
    </Screen>
  );
}
