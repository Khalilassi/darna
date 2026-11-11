import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { api, unwrap } from "../../../src/api/client";
import { errorMessage } from "../../../src/api/errors";
import { qk } from "../../../src/api/queries";
import { Button, Notice, Screen, SignInRequired, T } from "../../../src/components";
import { ClaimForm } from "../../../src/features/ClaimForm";

export default function ClaimProperty() {
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async (c: Schemas["ClaimIn"]) => unwrap(await api.POST("/properties/{property_id}/claims", { params: { path: { property_id: propertyId } }, body: c })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.myProperties }),
  });
  return (
    <SignInRequired>
      <Screen>
        <T tone="muted">{t("property.existsBody")}</T>
        {m.isSuccess ? (
          <>
            <Notice tone="success">{t("claim.submitted")}</Notice>
            <Button title={t("common.done")} onPress={() => router.replace("/owner")} />
          </>
        ) : (
          <ClaimForm submitLabel={t("claim.submit")} onSubmit={(c) => m.mutate(c)} busy={m.isPending} error={m.isError ? errorMessage(m.error, t) : null} />
        )}
      </Screen>
    </SignInRequired>
  );
}
