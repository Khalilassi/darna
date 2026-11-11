import React, { useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../../src/api/client";
import { errorMessage } from "../../src/api/errors";
import { qk, useConversations } from "../../src/api/queries";
import { useAuth } from "../../src/auth/AuthProvider";
import { Button, EmptyState, ErrorState, IconButton, LoadingState, Notice, SignInRequired, T } from "../../src/components";
import { formatTime } from "../../src/i18n/format";
import { useLanguage } from "../../src/i18n/LanguageProvider";
import { useTheme } from "../../src/theme";

const POLL_MS = 4000;

export default function ConversationScreen() {
  return (
    <SignInRequired>
      <Thread />
    </SignInRequired>
  );
}

function Thread() {
  const { id, tip: tipParam } = useLocalSearchParams<{ id: string; tip?: string }>();
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const { me } = useAuth();
  const { colors, radii } = useTheme();
  const qc = useQueryClient();
  const convs = useConversations();
  const conv = convs.data?.find((c) => c.id === id);
  const [draft, setDraft] = useState("");
  const [tip, setTip] = useState<string | null>(tipParam ?? null);
  const listRef = useRef<FlatList>(null);

  const messages = useQuery({
    queryKey: qk.messages(id),
    refetchInterval: POLL_MS,
    queryFn: async () => unwrap(await api.GET("/conversations/{conversation_id}/messages", { params: { path: { conversation_id: id }, query: { limit: 100 } } })),
  });

  const unreadFromOther = (messages.data ?? []).some((m) => m.sender_id !== me?.id && !m.read_at);
  useEffect(() => {
    if (!unreadFromOther || !me) return;
    void api.POST("/conversations/{conversation_id}/read", { params: { path: { conversation_id: id } } }).then(() => {
      void qc.invalidateQueries({ queryKey: qk.conversations });
    });
  }, [unreadFromOther, id, me, qc]);

  const send = useMutation({
    mutationFn: async (body: string) => unwrap(await api.POST("/conversations/{conversation_id}/messages", { params: { path: { conversation_id: id } }, body: { body } })),
    onSuccess: (res) => {
      setDraft("");
      if (res.safety_tip) setTip(res.safety_tip);
      void qc.invalidateQueries({ queryKey: qk.messages(id) });
      void qc.invalidateQueries({ queryKey: qk.conversations });
    },
  });

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: conv?.counterpart_name ?? "",
          headerRight: conv
            ? () => <IconButton icon="home-outline" label={t("chat.viewListing")} onPress={() => router.push(`/listing/${conv.listing_id}`)} />
            : undefined,
        }}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
        {conv ? (
          <View style={[styles.banner, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
            <T variant="caption" tone="muted" numberOfLines={1}>{conv.listing_title}</T>
          </View>
        ) : null}
        {tip ? (
          <View style={{ padding: 12 }}>
            <Notice tone="warning" icon="shield-half-outline" testID="safety-tip">{t(`chat.${tip}`, { defaultValue: t("chat.keep_payments_off_chat") })}</Notice>
          </View>
        ) : null}
        {messages.isPending ? (
          <LoadingState />
        ) : messages.isError ? (
          <ErrorState error={messages.error} onRetry={() => void messages.refetch()} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages.data}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: 16, gap: 8, flexGrow: 1, justifyContent: "flex-end" }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={<EmptyState icon="chatbubble-outline" title={t("chat.empty")} />}
            renderItem={({ item: m }) => {
              const mine = m.sender_id === me?.id;
              return (
                <View
                  style={[
                    styles.bubble,
                    {
                      alignSelf: mine ? "flex-end" : "flex-start",
                      backgroundColor: mine ? colors.primary : colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.lg,
                    },
                  ]}
                  accessibilityLabel={`${mine ? t("common.you") : conv?.counterpart_name ?? ""}: ${m.body}`}
                >
                  <T style={{ color: mine ? colors.onPrimary : colors.text }}>{m.body}</T>
                  <T variant="caption" style={{ color: mine ? colors.onPrimary : colors.textMuted, opacity: 0.8 }}>{formatTime(m.created_at, lang)}</T>
                </View>
              );
            }}
          />
        )}
        {send.isError ? <View style={{ paddingHorizontal: 12 }}><Notice tone="danger">{errorMessage(send.error, t)}</Notice></View> : null}
        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t("chat.placeholder")}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={2000}
            accessibilityLabel={t("chat.placeholder")}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted, borderRadius: radii.lg }]}
            testID="chat-input"
          />
          <Button
            title={t("common.send")}
            icon="send"
            accessibilityLabel={t("chat.send")}
            disabled={!draft.trim()}
            loading={send.isPending}
            onPress={() => send.mutate(draft.trim())}
            testID="chat-send"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  bubble: { maxWidth: "80%", paddingHorizontal: 14, paddingVertical: 8, gap: 2, borderWidth: StyleSheet.hairlineWidth },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
});
