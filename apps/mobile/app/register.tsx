import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { errorCode, errorMessage, fieldErrors } from "../src/api/errors";
import { useAuth } from "../src/auth/AuthProvider";
import { Button, Checkbox, Notice, Screen, T, TextField } from "../src/components";
import { useLanguage } from "../src/i18n/LanguageProvider";
import { hasErrors, validateEmail, validatePassword, validatePhone } from "../src/lib/validation";

export default function Register() {
  const { t } = useTranslation();
  const router = useRouter();
  const { lang } = useLanguage();
  const { register } = useAuth();
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "", attest: false });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const next = {
      full_name: form.full_name.trim().length >= 2 ? undefined : t("validation.minLength", { count: 2 }),
      email: validateEmail(form.email, t),
      phone: validatePhone(form.phone, t),
      password: validatePassword(form.password, t),
      attest: form.attest ? undefined : t("validation.attest"),
    };
    setErrors(next);
    if (hasErrors(next)) return;
    setBusy(true);
    setFormError(null);
    try {
      await register({
        full_name: form.full_name.trim(),
        email: form.email,
        phone: form.phone.trim() || null,
        password: form.password,
        locale: lang,
        attest_not_broker: form.attest,
      });
      router.replace("/explore");
    } catch (e) {
      const fe = fieldErrors(e);
      if (Object.keys(fe).length) setErrors((p) => ({ ...p, ...fe }));
      if (errorCode(e) === "email_taken") setErrors((p) => ({ ...p, email: errorMessage(e, t) }));
      else setFormError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <T variant="title">{t("auth.registerTitle")}</T>
      <T tone="muted">{t("auth.registerSubtitle")}</T>
      {formError ? <Notice tone="danger">{formError}</Notice> : null}
      <TextField label={t("auth.fullName")} value={form.full_name} onChangeText={set("full_name")} autoComplete="name" error={errors.full_name} testID="reg-name" />
      <TextField label={t("auth.email")} value={form.email} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={errors.email} testID="reg-email" />
      <TextField label={t("auth.phone")} value={form.phone} onChangeText={set("phone")} keyboardType="phone-pad" autoComplete="tel" optional optionalLabel={t("common.optional")} error={errors.phone} />
      <TextField label={t("auth.password")} value={form.password} onChangeText={set("password")} secureTextEntry autoComplete="new-password" hint={t("auth.passwordHint")} error={errors.password} testID="reg-password" />
      <Checkbox checked={form.attest} onChange={set("attest")} label={t("auth.attestLabel")} help={t("auth.attestHelp")} error={errors.attest ?? errors.attest_not_broker} testID="reg-attest" />
      <Button title={t("auth.createAccount")} onPress={() => void submit()} loading={busy} size="lg" fullWidth testID="reg-submit" />
      <Button title={t("auth.haveAccount")} variant="ghost" onPress={() => router.replace("/login")} />
    </Screen>
  );
}
