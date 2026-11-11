import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../src/api/errors";
import { useAuth } from "../src/auth/AuthProvider";
import { Button, Notice, Screen, T, TextField } from "../src/components";
import { validateEmail } from "../src/lib/validation";

export default function Login() {
  const { t } = useTranslation();
  const router = useRouter();
  const { expired } = useLocalSearchParams<{ expired?: string }>();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next = { email: validateEmail(email, t), password: password ? undefined : t("validation.required") };
    setErrors(next);
    if (next.email || next.password) return;
    setBusy(true);
    setFormError(null);
    try {
      await signIn(email, password);
      if (router.canDismiss()) router.dismissAll();
      router.replace("/explore");
    } catch (e) {
      setFormError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <T variant="title">{t("auth.loginTitle")}</T>
      <T tone="muted">{t("auth.loginSubtitle")}</T>
      {expired ? <Notice tone="warning">{t("auth.sessionExpired")}</Notice> : null}
      {formError ? <Notice tone="danger" testID="login-error">{formError}</Notice> : null}
      <TextField
        label={t("auth.email")}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
        error={errors.email}
        testID="login-email"
      />
      <TextField
        label={t("auth.password")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        error={errors.password}
        onSubmitEditing={() => void submit()}
        testID="login-password"
      />
      <Button title={t("common.signIn")} onPress={() => void submit()} loading={busy} size="lg" fullWidth testID="login-submit" />
      <Button title={t("auth.noAccount")} variant="ghost" onPress={() => router.replace("/register")} />
      {__DEV__ ? <T variant="caption" tone="muted" center>{t("auth.demoHint")}</T> : null}
    </Screen>
  );
}
