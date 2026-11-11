import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../../src/api/client";
import { errorMessage } from "../../src/api/errors";
import { qk, useListing } from "../../src/api/queries";
import { Button, DateTimeSlots, Notice, Screen, SignInRequired, T, TextField } from "../../src/components";
import { formatDate } from "../../src/i18n/format";
import { useLanguage } from "../../src/i18n/LanguageProvider";
import { isValidViewingTime } from "../../src/lib/viewing";

export default function RequestViewing() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const qc = useQueryClient();
  const listing = useListing(listingId);
  const [when, setWhen] = useState<Date | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const submit = async () => {
    if (!when) return setError(t("validation.choose"));
    if (!isValidViewingTime(when)) return setError(t("errors.invalid_viewing_time"));
    setBusy(true);
    setError(null);
    try {
      // toISOString() is UTC with a "Z" designator, i.e. timezone-aware as the API requires.
      unwrap(await api.POST("/viewings", { body: { listing_id: listingId, proposed_at: when.toISOString(), note: note.trim() || null } }));
      void qc.invalidateQueries({ queryKey: qk.viewings });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SignInRequired>
      <Screen
        footer={
          done ? (
            <Button title={t("common.done")} fullWidth onPress={() => router.back()} />
          ) : (
            <Button title={t("viewing.submit")} fullWidth onPress={() => void submit()} loading={busy} disabled={!when} testID="viewing-submit" />
          )
        }
      >
        {listing.data ? <T variant="heading">{listing.data.title}</T> : null}
        <T tone="muted">{t("viewing.subtitle")}</T>
        {done ? (
          <Notice tone="success" testID="viewing-sent">{`${t("viewing.sent")} ${when ? formatDate(when.toISOString(), lang, true) : ""}`}</Notice>
        ) : (
          <>
            <DateTimeSlots value={when} onChange={setWhen} />
            <T variant="caption" tone="muted">{t("viewing.rangeHint", { tz })}</T>
            <TextField label={t("viewing.note")} placeholder={t("viewing.notePlaceholder")} value={note} onChangeText={setNote} multiline maxLength={500} optional optionalLabel={t("common.optional")} />
            {error ? <Notice tone="danger">{error}</Notice> : null}
          </>
        )}
      </Screen>
    </SignInRequired>
  );
}
