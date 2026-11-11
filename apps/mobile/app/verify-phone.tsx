import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "@darna/api-client";
import { api, unwrap } from "../src/api/client";
import { errorMessage } from "../src/api/errors";
import { useAuth } from "../src/auth/AuthProvider";
import { Button, Card, Notice, Screen, SignInRequired, T, TextField } from "../src/components";
import { onlyDigits, resendLabelSeconds } from "../src/lib/phoneVerification";

/** Two steps: send a 6-digit SMS code to the number, then confirm it. */
export default function VerifyPhone() {
  const { status } = useAuth();
  return <Screen>{status === "signedIn" ? <Flow /> : <SignInRequired>{null}</SignInRequired>}</Screen>;
}

function Flow() {
  const { t } = useTranslation();
  const router = useRouter();
  const { me, refreshMe } = useAuth();
  const [phone, setPhone] = useState(me?.phone ?? "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number>(0);
  const [now, setNow] = useState(Date.now());
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!sentTo) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sentTo]);

  const send = useMutation({
    mutationFn: async () => unwrap(await api.POST("/auth/phone/start", { body: { phone: phone.trim() } })),
    onSuccess: (r) => {
      setSentTo(r.phone);
      setResendAt(Date.now() + r.resend_after_seconds * 1000);
      setCode("");
    },
  });
  const verify = useMutation({
    mutationFn: async () => unwrap(await api.POST("/auth/phone/verify", { body: { code } })),
    onSuccess: async () => {
      await refreshMe();
    },
    onError: () => setCode(""),
  });

  if (verify.isSuccess) {
    return (
      <Card>
        <Notice tone="success" testID="phone-done">{t("phone.done")}</Notice>
        <Button title={t("common.done")} onPress={() => router.back()} />
      </Card>
    );
  }

  const attemptsLeft =
    verify.error instanceof ApiError ? (verify.error.details as { attempts_left?: number } | undefined)?.attempts_left : undefined;
  const wait = resendLabelSeconds(resendAt, now);

  return (
    <Card>
      <T variant="heading">{t("phone.title")}</T>
      <T tone="muted">{t("phone.intro")}</T>
      {!sentTo ? (
        <>
          <TextField
            label={t("phone.numberLabel")}
            hint={t("phone.numberHint")}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            testID="phone-number"
          />
          {send.isError ? <Notice tone="danger">{errorMessage(send.error, t)}</Notice> : null}
          <Button title={t("phone.send")} onPress={() => send.mutate()} loading={send.isPending} disabled={phone.trim().length < 10} testID="phone-send" />
        </>
      ) : (
        <>
          <Notice tone="info">{t("phone.sentTo", { phone: sentTo })}</Notice>
          <TextField
            label={t("phone.codeLabel")}
            value={code}
            onChangeText={(v) => setCode(onlyDigits(v, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            testID="phone-code"
          />
          {verify.isError ? (
            <Notice tone="danger">
              {errorMessage(verify.error, t)}
              {attemptsLeft !== undefined ? ` ${t("phone.attemptsLeft", { count: attemptsLeft })}` : ""}
            </Notice>
          ) : null}
          {send.isError ? <Notice tone="danger">{errorMessage(send.error, t)}</Notice> : null}
          <Button title={t("phone.verify")} onPress={() => verify.mutate()} loading={verify.isPending} disabled={code.length !== 6} testID="phone-verify-submit" />
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Button
              title={wait > 0 ? t("phone.resendIn", { count: wait }) : t("phone.resend")}
              variant="outline"
              size="sm"
              disabled={wait > 0}
              loading={send.isPending}
              onPress={() => send.mutate()}
              testID="phone-resend"
            />
            <Button title={t("phone.changeNumber")} variant="ghost" size="sm" onPress={() => { setSentTo(null); setCode(""); verify.reset(); }} />
          </View>
        </>
      )}
    </Card>
  );
}
