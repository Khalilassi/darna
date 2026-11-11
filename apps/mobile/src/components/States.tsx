import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { UseQueryResult } from "@tanstack/react-query";
import { errorMessage } from "../api/errors";
import { useTheme } from "../theme";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { T } from "./T";

export function LoadingState({ label }: { label?: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label ?? t("common.loading")}>
      <ActivityIndicator color={colors.primary} size="large" />
      <T tone="muted" variant="caption">{label ?? t("common.loading")}</T>
    </View>
  );
}

export function EmptyState({
  icon = "home-outline", title, body, actionLabel, onAction, testID,
}: { icon?: IconName; title: string; body?: string; actionLabel?: string; onAction?: () => void; testID?: string }) {
  const { colors, radii } = useTheme();
  return (
    <View style={styles.center} testID={testID}>
      <View style={[styles.iconWrap, { backgroundColor: colors.primaryMuted, borderRadius: radii.pill }]}>
        <Icon name={icon} size={30} color={colors.primary} />
      </View>
      <T variant="heading" center>{title}</T>
      {body ? <T tone="muted" center style={styles.body}>{body}</T> : null}
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} style={{ marginTop: 8 }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const { colors, radii } = useTheme();
  return (
    <View style={styles.center} accessibilityRole="alert">
      <View style={[styles.iconWrap, { backgroundColor: colors.dangerMuted, borderRadius: radii.pill }]}>
        <Icon name="cloud-offline-outline" size={30} color={colors.danger} />
      </View>
      <T variant="heading" center>{t("common.errorTitle")}</T>
      <T tone="muted" center style={styles.body}>{errorMessage(error, t)}</T>
      {onRetry ? <Button title={t("common.retry")} variant="secondary" icon="refresh" onPress={onRetry} style={{ marginTop: 8 }} /> : null}
    </View>
  );
}

/** Renders loading / error (with retry) / content for a react-query result. */
export function QueryView<T>({
  query, children, isEmpty, empty,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => React.ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: React.ReactNode;
}) {
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (isEmpty?.(query.data) && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10, minHeight: 280 },
  iconWrap: { width: 64, height: 64, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  body: { maxWidth: 320 },
});
