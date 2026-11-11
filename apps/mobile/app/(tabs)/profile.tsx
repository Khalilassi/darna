import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useNotifications, useSavedSearches } from "../../src/api/queries";
import { useAuth } from "../../src/auth/AuthProvider";
import { Badge, Button, Card, Icon, Screen, T, type IconName } from "../../src/components";
import { formatDate } from "../../src/i18n/format";
import { useLanguage } from "../../src/i18n/LanguageProvider";
import { useTheme } from "../../src/theme";

function MenuRow({ icon, label, onPress, badge, testID }: { icon: IconName; label: string; onPress: () => void; badge?: number; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceMuted : "transparent" }]}
    >
      <Icon name={icon} color={colors.primary} />
      <T style={{ flex: 1 }}>{label}</T>
      {badge ? <Badge label={String(badge)} tone="primary" /> : null}
      <Icon name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export default function Profile() {
  const { t } = useTranslation();
  const { lang, setLanguage } = useLanguage();
  const router = useRouter();
  const { colors } = useTheme();
  const { status, me, signOut } = useAuth();
  const notifications = useNotifications();
  const savedSearches = useSavedSearches();
  const newMatches = (savedSearches.data ?? []).reduce((n, s) => n + s.new_since_last_alert, 0);
  const signedIn = status === "signedIn";
  const identity = me?.verification.identity ?? "none";

  return (
    <Screen edges={["top"]}>
      <T variant="title" accessibilityRole="header">{t("profile.title")}</T>
      <Card>
        <View style={styles.head}>
          <View style={[styles.avatar, { backgroundColor: colors.primaryMuted }]}>
            <Icon name="person" size={26} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="heading" testID="profile-name">{signedIn ? me?.full_name ?? "…" : t("profile.guest")}</T>
            {signedIn && me ? (
              <>
                <T variant="caption" tone="muted">{me.email}</T>
                <T variant="caption" tone="muted">{t("profile.memberSince", { date: formatDate(me.created_at, lang) })}</T>
              </>
            ) : (
              <T variant="caption" tone="muted">{t("profile.guestBody")}</T>
            )}
          </View>
        </View>
        {signedIn && me ? (
          <Badge
            label={t("profile.identity", { status: t(`enum.verificationStatus.${identity}`, { defaultValue: identity }) })}
            tone={identity === "approved" ? "verified" : identity === "none" ? "neutral" : "warning"}
            icon={identity === "approved" ? "shield-checkmark" : "shield-outline"}
          />
        ) : (
          <Button title={t("common.signIn")} onPress={() => router.push("/login")} fullWidth />
        )}
      </Card>

      {signedIn ? (
        <Card padded={false}>
          <MenuRow icon="home-outline" label={t("profile.ownerHub")} onPress={() => router.push("/owner")} testID="menu-owner" />
          <MenuRow icon="bookmark-outline" label={t("savedSearch.title")} onPress={() => router.push("/saved-searches")} badge={newMatches} testID="menu-saved-searches" />
          <MenuRow icon="stats-chart-outline" label={t("market.title")} onPress={() => router.push("/market")} testID="menu-market" />
          <MenuRow icon="calendar-outline" label={t("profile.viewings")} onPress={() => router.push("/viewings")} />
          <MenuRow icon="notifications-outline" label={t("profile.notifications")} onPress={() => router.push("/notifications")} badge={notifications.data?.unread} />
          <MenuRow icon="options-outline" label={t("profile.notificationSettings")} onPress={() => router.push("/notification-settings")} testID="menu-notification-settings" />
          <MenuRow icon="settings-outline" label={t("profile.settings")} onPress={() => router.push("/settings")} testID="menu-settings" />
          <MenuRow icon="flag-outline" label={t("profile.help")} onPress={() => router.push("/support")} />
        </Card>
      ) : null}

      <Card>
        <T variant="label" tone="muted">{t("settings.language")}</T>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="English" variant={lang === "en" ? "primary" : "outline"} size="sm" onPress={() => void setLanguage("en")} testID="lang-en" />
          <Button title="العربية" variant={lang === "ar" ? "primary" : "outline"} size="sm" onPress={() => void setLanguage("ar")} testID="lang-ar" />
        </View>
      </Card>

      {signedIn ? <Button title={t("profile.signOut")} icon="log-out-outline" variant="danger" onPress={() => void signOut()} testID="sign-out" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", gap: 12, alignItems: "center" },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 16 },
});
