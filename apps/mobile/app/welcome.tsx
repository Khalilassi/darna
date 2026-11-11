import React from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { brand } from "@darna/design-tokens";
import { Button, Icon, T, type IconName } from "../src/components";
import { useLanguage } from "../src/i18n/LanguageProvider";
import { useTheme } from "../src/theme";

export default function Welcome() {
  const { t } = useTranslation();
  const router = useRouter();
  const { lang, setLanguage } = useLanguage();
  const { colors, radii } = useTheme();
  const points: [IconName, string][] = [
    ["people-outline", t("welcome.point1")],
    ["shield-checkmark-outline", t("welcome.point2")],
    ["calculator-outline", t("welcome.point3")],
  ];
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.primary }]} edges={["top", "bottom"]}>
      <View style={styles.top}>
        <View style={styles.brandRow}>
          <View style={[styles.logo, { backgroundColor: colors.accent, borderRadius: radii.md }]}>
            <Icon name="home" size={22} color="#fff" />
          </View>
          <T variant="title" style={{ color: "#fff" }}>{lang === "ar" ? brand.nameAr : brand.name}</T>
          <View style={styles.flex} />
          <Button
            title={lang === "ar" ? "English" : "العربية"}
            variant="ghost"
            size="sm"
            icon="language-outline"
            onPress={() => void setLanguage(lang === "ar" ? "en" : "ar")}
            style={{ borderColor: "rgba(255,255,255,0.4)" }}
            accessibilityLabel={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
            testID="welcome-language"
          />
        </View>
        <T variant="display" style={styles.headline}>{t("welcome.title")}</T>
        <T style={{ color: "rgba(255,255,255,0.85)", fontSize: 17, lineHeight: 25 }}>{t("welcome.body")}</T>
        <View style={{ gap: 14, marginTop: 24 }}>
          {points.map(([icon, text]) => (
            <View key={text} style={styles.point}>
              <View style={[styles.pointIcon, { borderRadius: radii.pill }]}>
                <Icon name={icon} size={18} color="#fff" />
              </View>
              <T style={{ color: "#fff", flex: 1 }} variant="bodyStrong">{text}</T>
            </View>
          ))}
        </View>
      </View>
      <View style={[styles.sheet, { backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28 }]}>
        <Button title={t("welcome.getStarted")} size="lg" fullWidth onPress={() => router.push("/register")} testID="welcome-register" />
        <Button title={t("welcome.signIn")} size="lg" variant="outline" fullWidth onPress={() => router.push("/login")} testID="welcome-login" />
        <Button title={t("welcome.browse")} variant="ghost" fullWidth onPress={() => router.replace("/explore")} testID="welcome-browse" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, position: "absolute", top: 16, start: 24, end: 24 },
  logo: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headline: { color: "#fff", fontSize: 38, lineHeight: 44, marginTop: 40 },
  point: { flexDirection: "row", alignItems: "center", gap: 12 },
  pointIcon: { width: 34, height: 34, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  sheet: { padding: 24, gap: 10 },
});
