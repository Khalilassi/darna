import React from "react";
import { Tabs } from "expo-router/js-tabs";
import { useTranslation } from "react-i18next";
import { useConversations, useDeals } from "../../src/api/queries";
import { Icon, type IconName } from "../../src/components";
import { useTheme } from "../../src/theme";

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const conversations = useConversations();
  const deals = useDeals();
  const unread = (conversations.data ?? []).reduce((n, c) => n + c.unread, 0);
  const pendingForMe = (deals.data ?? []).filter((d) => d.latest_offer?.status === "pending" && d.latest_offer.made_by !== d.my_role).length;
  const icon = (name: IconName, active: IconName) =>
    function TabIcon({ color, focused }: { color: unknown; focused: boolean }) {
      return <Icon name={focused ? active : name} color={String(color)} size={24} />;
    };
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, minHeight: 60 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="explore" options={{ title: t("tabs.explore"), tabBarIcon: icon("search-outline", "search") }} />
      <Tabs.Screen name="saved" options={{ title: t("tabs.saved"), tabBarIcon: icon("heart-outline", "heart") }} />
      <Tabs.Screen
        name="inbox"
        options={{ title: t("tabs.inbox"), tabBarIcon: icon("chatbubbles-outline", "chatbubbles"), tabBarBadge: unread || undefined }}
      />
      <Tabs.Screen
        name="deals"
        options={{ title: t("tabs.deals"), tabBarIcon: icon("briefcase-outline", "briefcase"), tabBarBadge: pendingForMe || undefined }}
      />
      <Tabs.Screen name="profile" options={{ title: t("tabs.profile"), tabBarIcon: icon("person-circle-outline", "person-circle") }} />
    </Tabs>
  );
}
