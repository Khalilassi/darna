import React, { useState } from "react";
import { Linking, Platform, StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../src/api/errors";
import { useNotificationPrefs, useSetNotificationPref } from "../src/api/queries";
import { useAuth } from "../src/auth/AuthProvider";
import { Button, Card, Divider, ErrorState, LoadingState, Notice, Screen, SignInRequired, T } from "../src/components";
import { usePush } from "../src/notifications/PushProvider";
import { PUSH_CATEGORIES, type PushStatus } from "../src/notifications/push";
import { useTheme } from "../src/theme";

export default function NotificationSettings() {
  const { status } = useAuth();
  return (
    <Screen testID="notification-settings">
      <PushStatusCard />
      {status === "signedIn" ? <Categories /> : <SignInRequired>{null}</SignInRequired>}
    </Screen>
  );
}

const STATUS_TONE: Record<PushStatus, "info" | "warning" | "danger" | "success" | "neutral"> = {
  checking: "neutral",
  signed_out: "neutral",
  unsupported_web: "info",
  unsupported_device: "info",
  not_configured: "warning",
  undetermined: "info",
  denied: "warning",
  registered: "success",
  error: "danger",
};

const STATUS_TEXT: Record<PushStatus, string> = {
  checking: "notifPrefs.push.checking",
  signed_out: "notifPrefs.push.signedOut",
  unsupported_web: "notifPrefs.push.unsupportedWeb",
  unsupported_device: "notifPrefs.push.unsupportedDevice",
  not_configured: "notifPrefs.push.notConfigured",
  undetermined: "notifPrefs.push.undetermined",
  denied: "notifPrefs.push.denied",
  registered: "notifPrefs.push.registered",
  error: "notifPrefs.push.error",
};

function PushStatusCard() {
  const { t } = useTranslation();
  const { status: auth } = useAuth();
  const { status, refresh } = usePush();
  const [busy, setBusy] = useState(false);
  const run = async (prompt: "explicit" | "never") => {
    setBusy(true);
    await refresh(prompt).finally(() => setBusy(false));
  };
  return (
    <Card>
      <T variant="heading" accessibilityRole="header">{t("notifPrefs.push.title")}</T>
      <Notice tone={STATUS_TONE[status]} testID={`push-status-${status}`}>{t(STATUS_TEXT[status])}</Notice>
      {auth === "signedIn" && status === "undetermined" ? (
        <Button title={t("notifPrefs.push.enable")} icon="notifications-outline" onPress={() => void run("explicit")} loading={busy} />
      ) : null}
      {status === "denied" ? (
        <Button title={t("notifPrefs.push.openSettings")} icon="settings-outline" variant="outline" onPress={() => void Linking.openSettings()} />
      ) : null}
      {auth === "signedIn" && status === "error" ? (
        <Button title={t("notifPrefs.push.retry")} icon="refresh" variant="secondary" onPress={() => void run("never")} loading={busy} />
      ) : null}
    </Card>
  );
}

function Categories() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const prefs = useNotificationPrefs();
  const setPref = useSetNotificationPref();
  const [saveError, setSaveError] = useState<string | null>(null);

  if (prefs.isPending) return <LoadingState />;
  if (prefs.isError) return <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} />;

  const toggle = (category: string, enabled: boolean) => {
    setSaveError(null);
    setPref.mutate(
      { category, enabled },
      { onError: (e) => setSaveError(`${t("notifPrefs.saveError")} ${errorMessage(e, t)}`) },
    );
  };

  return (
    <Card>
      <T variant="heading" accessibilityRole="header">{t("notifPrefs.categoriesTitle")}</T>
      <T variant="caption" tone="muted">{t("notifPrefs.intro")}</T>
      {saveError ? <Notice tone="danger" testID="prefs-error">{saveError}</Notice> : null}
      {PUSH_CATEGORIES.map((c, i) => {
        const on = prefs.data.push[c] ?? true;
        const label = t(`notifPrefs.categories.${c}.label`);
        return (
          <View key={c} style={{ gap: 12 }}>
            {i ? <Divider /> : null}
            <View style={styles.row}>
              <View style={styles.text}>
                <T variant="bodyStrong">{label}</T>
                <T variant="caption" tone="muted">{t(`notifPrefs.categories.${c}.description`)}</T>
              </View>
              {/* react-native-web mispositions the Switch thumb under dir="rtl"; native handles RTL itself. */}
              <View style={Platform.OS === "web" ? styles.ltr : undefined}>
              <Switch
                value={on}
                onValueChange={(v) => toggle(c, v)}
                accessibilityLabel={label}
                accessibilityRole="switch"
                accessibilityState={{ checked: on }}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor={colors.surface}
                {...({ activeThumbColor: colors.surface } as object)}
                testID={`pref-${c}`}
              />
              </View>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
  text: { flex: 1, gap: 2 },
  ltr: { direction: "ltr" },
});
