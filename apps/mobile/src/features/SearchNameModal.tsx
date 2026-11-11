import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button";
import { Checkbox } from "../components/Choice";
import { Row } from "../components/Layout";
import { Notice } from "../components/Notice";
import { T } from "../components/T";
import { TextField } from "../components/TextField";
import { MAX_NAME } from "../lib/savedSearch";
import { useTheme } from "../theme";

/** Name prompt for saving or renaming a search (works on web, where Alert.prompt does not exist). */
export function SearchNameModal({
  visible, title, initialName, withAlerts, busy, error, onCancel, onSubmit,
}: {
  visible: boolean;
  title: string;
  initialName: string;
  /** Show the "alert me" checkbox (save only). */
  withAlerts?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (name: string, alerts: boolean) => void;
}) {
  const { t } = useTranslation();
  const { colors, radii } = useTheme();
  const [name, setName] = useState(initialName);
  const [alerts, setAlerts] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setName(initialName);
      setNameError(null);
    }
  }, [visible, initialName]);
  const submit = () => {
    const n = name.trim();
    if (!n) return setNameError(t("validation.required"));
    if (n.length > MAX_NAME) return setNameError(t("savedSearch.nameTooLong", { max: MAX_NAME }));
    onSubmit(n, alerts);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityRole="button" accessibilityLabel={t("common.close")} />
        <View style={[styles.box, { backgroundColor: colors.surface, borderRadius: radii.xl }]} testID="search-name-modal">
          <T variant="heading" accessibilityRole="header">{title}</T>
          <TextField label={t("savedSearch.name.label")} value={name} onChangeText={setName} maxLength={MAX_NAME} error={nameError} autoFocus onSubmitEditing={submit} testID="search-name-input" />
          {withAlerts ? (
            <Checkbox checked={alerts} onChange={setAlerts} label={t("savedSearch.alertMe")} help={t("savedSearch.alertMeHelp")} testID="search-alerts" />
          ) : null}
          {error ? <Notice tone="danger" testID="search-save-error">{error}</Notice> : null}
          <Row gap={10} style={{ justifyContent: "flex-end" }}>
            <Button title={t("common.cancel")} variant="outline" onPress={onCancel} />
            <Button title={t("common.save")} onPress={submit} loading={busy} testID="search-name-save" />
          </Row>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 16 },
  box: { padding: 20, gap: 14, width: "100%", maxWidth: 480, alignSelf: "center" },
});
