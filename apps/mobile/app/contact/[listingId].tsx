import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../../src/api/client";
import { errorMessage } from "../../src/api/errors";
import { qk, useListing } from "../../src/api/queries";
import { Button, Notice, Screen, SignInRequired, T, TextField } from "../../src/components";

export default function Contact() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const listing = useListing(listingId);
  const [body, setBody] = useState(t("listing.contactDefault"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!body.trim()) return setError(t("validation.required"));
    setBusy(true);
    setError(null);
    try {
      const sent = unwrap(await api.POST("/conversations", { body: { listing_id: listingId, message: body.trim() } }));
      // The API returns the message, not the conversation id: resolve it from the conversation list.
      const convs = await qc.fetchQuery({ queryKey: qk.conversations, queryFn: async () => unwrap(await api.GET("/conversations")), staleTime: 0 });
      void qc.invalidateQueries({ queryKey: qk.listing(listingId) });
      const conv = convs.find((c) => c.listing_id === listingId && c.my_role === "buyer");
      const tip = sent.safety_tip ? `?tip=${encodeURIComponent(sent.safety_tip)}` : "";
      if (conv) router.replace(`/conversation/${conv.id}${tip}`);
      else router.back();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SignInRequired>
      <Screen>
        {listing.data ? <T variant="heading">{listing.data.title}</T> : null}
        <Notice tone="warning" icon="shield-half-outline">{t("listing.safety")}</Notice>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <TextField label={t("offer.message")} value={body} onChangeText={setBody} multiline maxLength={2000} testID="contact-body" />
        <Button title={t("common.send")} icon="send" onPress={() => void send()} loading={busy} size="lg" fullWidth testID="contact-send" />
      </Screen>
    </SignInRequired>
  );
}
