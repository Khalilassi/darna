import React, { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { reloadAppAsync } from "expo";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "@darna/api-client";
import { AuthProvider, useAuth } from "../src/auth/AuthProvider";
import { initI18n } from "../src/i18n";
import { applyDirection } from "../src/i18n/direction";
import { detectInitialLanguage, LanguageProvider } from "../src/i18n/LanguageProvider";
import type { Language } from "../src/i18n/language";
import { PushProvider } from "../src/notifications/PushProvider";
import { CompareProvider } from "../src/state/compare";
import { FiltersProvider } from "../src/state/filters";
import { ThemeProvider, useTheme } from "../src/theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

export default function RootLayout() {
  const [lang, setLang] = useState<Language | null>(null);
  useEffect(() => {
    void detectInitialLanguage().then((l) => {
      initI18n(l);
      if (applyDirection(l) && Platform.OS !== "web") {
        void reloadAppAsync("apply-layout-direction").catch(() => undefined);
      }
      setLang(l);
    });
  }, []);
  if (!lang) return <View style={{ flex: 1, backgroundColor: "#F8F6F2" }} />;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider initial={lang}>
          <ThemeProvider>
            <AuthProvider>
              <FiltersProvider>
                <CompareProvider>
                  <Navigation />
                </CompareProvider>
              </FiltersProvider>
            </AuthProvider>
          </ThemeProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function Navigation() {
  const { colors, scheme } = useTheme();
  const { t } = useTranslation();
  const { expired } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (expired) router.replace("/login?expired=1");
  }, [expired, router]);

  return (
    <PushProvider>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "600" },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: t("common.signIn") }} />
        <Stack.Screen name="register" options={{ title: t("auth.createAccount") }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="listing/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="filters" options={{ presentation: "modal", title: t("filters.title") }} />
        <Stack.Screen name="compare" options={{ title: t("compare.title") }} />
        <Stack.Screen name="contact/[listingId]" options={{ presentation: "modal", title: t("listing.contactTitle") }} />
        <Stack.Screen name="viewing/[listingId]" options={{ presentation: "modal", title: t("viewing.title") }} />
        <Stack.Screen name="offer/[listingId]" options={{ title: t("offer.titleSale") }} />
        <Stack.Screen name="conversation/[id]" options={{ title: "" }} />
        <Stack.Screen name="deal/[id]" options={{ title: "" }} />
        <Stack.Screen name="notifications" options={{ title: t("notifications.title") }} />
        <Stack.Screen name="settings" options={{ title: t("settings.title") }} />
        <Stack.Screen name="support" options={{ title: t("support.title") }} />
        <Stack.Screen name="viewings" options={{ title: t("profile.viewings") }} />
        <Stack.Screen name="owner/index" options={{ title: t("owner.hubTitle") }} />
        <Stack.Screen name="owner/verify" options={{ title: t("verify.title") }} />
        <Stack.Screen name="owner/property-new" options={{ title: t("property.title") }} />
        <Stack.Screen name="owner/claim/[propertyId]" options={{ title: t("claim.title") }} />
        <Stack.Screen name="owner/listing-new" options={{ title: t("listingForm.titleNew") }} />
        <Stack.Screen name="owner/listing/[id]" options={{ title: t("manage.title") }} />
        <Stack.Screen name="owner/listing-edit/[id]" options={{ title: t("listingForm.titleEdit") }} />
        <Stack.Screen name="notification-settings" options={{ title: t("notifPrefs.title") }} />
        <Stack.Screen name="market" options={{ title: t("market.title") }} />
        <Stack.Screen name="saved-searches/index" options={{ title: t("savedSearch.title") }} />
        <Stack.Screen name="saved-searches/[id]" options={{ title: t("savedSearch.resultsTitle") }} />
      </Stack>
    </PushProvider>
  );
}
