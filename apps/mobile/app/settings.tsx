import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../src/api/client";
import { errorMessage, fieldErrors } from "../src/api/errors";
import { useAuth } from "../src/auth/AuthProvider";
import { Button, Card, Notice, Screen, Segmented, SignInRequired, T, TextField } from "../src/components";
import { useLanguage } from "../src/i18n/LanguageProvider";
import type { Language } from "../src/i18n/language";
import { validatePhone } from "../src/lib/validation";
import { useTheme, type ThemePref } from "../src/theme";

export default function Settings() {
  const { t } = useTranslation();
  const { lang, setLanguage } = useLanguage();
  const { pref, setPref } = useTheme();
  const { status } = useAuth();
  const router = useRouter();

  const changeLanguage = async (l: Language) => {
    if (l === lang) return;
    if (status === "signedIn") void api.PATCH("/auth/me", { body: { locale: l } });
    await setLanguage(l);
  };

  return (
    <Screen>
      <Card>
        <T variant="heading">{t("settings.language")}</T>
        <Segmented<Language>
          value={lang}
          onChange={(l) => void changeLanguage(l)}
          options={[{ value: "en", label: t("settings.english") }, { value: "ar", label: t("settings.arabic") }]}
          testID="settings-language"
        />
        {Platform.OS !== "web" ? <T variant="caption" tone="muted">{t("settings.reloadNote")}</T> : null}
      </Card>
      <Card>
        <T variant="heading">{t("settings.appearance")}</T>
        <Segmented<ThemePref>
          value={pref}
          onChange={setPref}
          options={[{ value: "system", label: t("settings.system") }, { value: "light", label: t("settings.light") }, { value: "dark", label: t("settings.dark") }]}
        />
      </Card>
      <Card>
        <T variant="heading">{t("notifPrefs.title")}</T>
        <Button title={t("notifPrefs.link")} icon="notifications-outline" variant="outline" onPress={() => router.push("/notification-settings")} testID="settings-notifications" />
      </Card>
      {status === "signedIn" ? <ProfileForm /> : <SignInRequired>{null}</SignInRequired>}
    </Screen>
  );
}

function ProfileForm() {
  const { t } = useTranslation();
  const { me, refreshMe } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  useEffect(() => {
    if (me) {
      setName(me.full_name);
      setPhone(me.phone ?? "");
    }
  }, [me]);
  const save = useMutation({
    mutationFn: async () => unwrap(await api.PATCH("/auth/me", { body: { full_name: name.trim(), phone: phone.trim() || null } })),
    onSuccess: () => void refreshMe(),
    onError: (e) => setErrors(fieldErrors(e)),
  });
  const submit = () => {
    const e = { full_name: name.trim().length >= 2 ? undefined : t("validation.minLength", { count: 2 }), phone: validatePhone(phone, t) };
    setErrors(e);
    if (!e.full_name && !e.phone) save.mutate();
  };
  return (
    <Card>
      <T variant="heading">{t("settings.profile")}</T>
      <TextField label={t("settings.email")} value={me?.email ?? ""} editable={false} />
      <TextField label={t("settings.name")} value={name} onChangeText={setName} error={errors.full_name} testID="settings-name" />
      <TextField label={t("settings.phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={errors.phone} optional optionalLabel={t("common.optional")} />
      {save.isError && !Object.keys(fieldErrors(save.error)).length ? <Notice tone="danger">{errorMessage(save.error, t)}</Notice> : null}
      {save.isSuccess ? <Notice tone="success">{t("settings.saved")}</Notice> : null}
      <Button title={t("common.save")} onPress={submit} loading={save.isPending} testID="settings-save" />
    </Card>
  );
}
