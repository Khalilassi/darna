import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { errorMessage } from "../api/errors";
import { pickDocument, pickImage, uploadDocument } from "../lib/upload";
import { useTheme } from "../theme";
import { Button, IconButton } from "./Button";
import { Select } from "./Choice";
import { Icon } from "./Icon";
import { T } from "./T";

type Doc = Schemas["DocumentOut"];
type Kind = Schemas["DocumentKind"];

/**
 * Pick a file (photo or PDF), upload it to `/documents` with a kind, and keep the list of uploaded
 * documents. The parent submits the resulting document ids.
 */
export function DocumentUploader({
  kinds, docs, onChange, error, label,
}: { kinds: Kind[]; docs: Doc[]; onChange: (docs: Doc[]) => void; error?: string | null; label?: string }) {
  const { t } = useTranslation();
  const { colors, radii } = useTheme();
  const [kind, setKind] = useState<Kind>(kinds[0]);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const run = async (picker: typeof pickImage) => {
    setUploadError(null);
    const f = await picker();
    if (!f) return;
    setBusy(true);
    try {
      const doc = await uploadDocument(f, kind);
      onChange([...docs, doc]);
    } catch (e) {
      setUploadError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      {label ? <T variant="label" tone="muted">{label}</T> : null}
      {kinds.length > 1 ? (
        <Select label={t("claim.docKind")} value={kind} onChange={(v) => v && setKind(v)} options={kinds.map((k) => ({ value: k, label: t(`enum.documentKind.${k}`) }))} />
      ) : null}
      <View style={styles.row}>
        <Button title={t("common.choosePhoto")} icon="image-outline" variant="secondary" size="sm" onPress={() => void run(pickImage)} loading={busy} />
        <Button title={t("common.chooseDocument")} icon="document-attach-outline" variant="outline" size="sm" onPress={() => void run(pickDocument)} disabled={busy} />
      </View>
      {docs.map((d) => (
        <View key={d.id} style={[styles.doc, { backgroundColor: colors.surfaceMuted, borderRadius: radii.md }]}>
          <Icon name={d.content_type === "application/pdf" ? "document-text-outline" : "image-outline"} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <T variant="bodyStrong" numberOfLines={1}>{t(`enum.documentKind.${d.kind}`)}</T>
            <T variant="caption" tone="muted" numberOfLines={1}>{d.original_name}</T>
          </View>
          <IconButton icon="close" label={`${t("common.remove")} ${d.original_name}`} disabled={busy} onPress={() => onChange(docs.filter((x) => x.id !== d.id))} />
        </View>
      ))}
      {uploadError || error ? <T variant="caption" tone="danger">{uploadError ?? error}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  doc: { flexDirection: "row", alignItems: "center", gap: 10, paddingStart: 12, paddingVertical: 4 },
});
