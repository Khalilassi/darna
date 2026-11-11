import React, { useState } from "react";
import { Linking, StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { Badge, type BadgeTone } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Checkbox } from "../components/Choice";
import { Row } from "../components/Layout";
import { Notice } from "../components/Notice";
import { T } from "../components/T";
import { TextField } from "../components/TextField";
import { formatDate, localizeDigits } from "../i18n/format";
import { useLanguage } from "../i18n/LanguageProvider";
import {
  buildReferralBody, canSharePhone, canSubmitReferral, contactLinks, hasDisclosure, isOpenReferral, MAX_REFERRAL_MESSAGE, providerText,
  type Provider, type ReferralStatus, type ServiceCategory,
} from "../lib/services";
import { useTheme } from "../theme";

/** Standing note: providers are independent; Darna is not a party to their services. */
export function ServicesDisclaimer({ testID = "services-disclaimer" }: { testID?: string }) {
  const { t } = useTranslation();
  return (
    <Notice tone="neutral" icon="information-circle-outline" title={t("services.independentTitle")} testID={testID}>
      {t("services.independent")}
    </Notice>
  );
}

export function ProviderCard({
  provider, onRequest, onLinkError,
}: { provider: Provider; onRequest?: (p: Provider) => void; onLinkError?: () => void }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const { name, description } = providerText(provider, lang);
  const links = contactLinks(provider);
  const open = (url: string) => {
    void Linking.openURL(url).catch(() => onLinkError?.());
  };
  return (
    <Card testID={`provider-${provider.id}`}>
      <Row wrap>
        <Badge label={t(`services.category.${provider.category}`)} tone="neutral" />
        {provider.verified ? <Badge label={t("services.verified")} tone="verified" icon="shield-checkmark" testID="provider-verified" /> : null}
        {hasDisclosure(provider) ? <Badge label={t("services.referralFee")} tone="warning" icon="cash-outline" testID="provider-fee" /> : null}
      </Row>
      <T variant="heading" accessibilityRole="header">{name}</T>
      {description ? <T tone="muted">{description}</T> : null}
      {provider.license_number ? (
        <T variant="caption" tone="muted" testID="provider-license">{t("services.license", { number: localizeDigits(provider.license_number, lang) })}</T>
      ) : null}
      <Row wrap>
        {links.tel ? (
          <Button size="sm" variant="outline" icon="call-outline" title={t("services.call")} accessibilityLabel={t("services.callLabel", { name })} onPress={() => open(links.tel!)} />
        ) : null}
        {links.mailto ? (
          <Button size="sm" variant="outline" icon="mail-outline" title={t("services.email")} accessibilityLabel={t("services.emailLabel", { name })} onPress={() => open(links.mailto!)} />
        ) : null}
        {links.web ? (
          <Button size="sm" variant="outline" icon="globe-outline" title={t("services.website")} accessibilityLabel={t("services.websiteLabel", { name })} onPress={() => open(links.web!)} />
        ) : null}
      </Row>
      {onRequest ? (
        <Button
          title={t("services.requestReferral")}
          accessibilityLabel={t("services.requestReferralLabel", { name })}
          icon="paper-plane-outline"
          variant="secondary"
          onPress={() => onRequest(provider)}
          testID={`request-${provider.id}`}
        />
      ) : null}
    </Card>
  );
}

/** Deal-workspace card: categories suggested for the deal's current stage. Renders nothing without categories. */
export function ServiceSuggestionsCard({
  suggestions, onOpen,
}: { suggestions: Pick<Schemas["SuggestionsOut"], "categories" | "note"> | undefined; onOpen: (category: ServiceCategory) => void }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  if (!suggestions?.categories.length) return null;
  return (
    <Card testID="service-suggestions">
      <T variant="heading" accessibilityRole="header">{t("services.suggestions.title")}</T>
      {/* The API note is English; Arabic readers get the same statement localized. */}
      <T variant="caption" tone="muted" testID="service-suggestions-note">
        {lang === "ar" || !suggestions.note ? t("services.suggestions.note") : suggestions.note}
      </T>
      <Row wrap>
        {suggestions.categories.map((c) => {
          const category = t(`services.category.${c}`);
          return (
            <Button
              key={c}
              size="sm"
              variant="secondary"
              icon="briefcase-outline"
              title={t("services.suggestions.open", { category })}
              accessibilityLabel={t("services.suggestions.openLabel", { category })}
              onPress={() => onOpen(c)}
              testID={`suggestion-${c}`}
            />
          );
        })}
      </Row>
    </Card>
  );
}

export interface ReferralFormProps {
  provider: Provider;
  me: Pick<Schemas["MeDetailOut"], "phone" | "phone_verified_at"> | undefined;
  dealId?: string | null;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (body: Schemas["ReferralIn"]) => void;
  onVerifyPhone: () => void;
}

/** Referral request: optional message, opt-in phone sharing (verified numbers only) and the disclosure acknowledgement. */
export function ReferralForm({ provider, me, dealId, submitting, error, onSubmit, onVerifyPhone }: ReferralFormProps) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const { colors, radii } = useTheme();
  const [message, setMessage] = useState("");
  const [sharePhone, setSharePhone] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const { name, disclosure } = providerText(provider, lang);
  const needsAck = hasDisclosure(provider);
  const phoneOk = canSharePhone(me);
  const ready = canSubmitReferral({ provider, acknowledged, message });
  const tooLong = message.length > MAX_REFERRAL_MESSAGE;

  const submit = () => {
    if (!ready) return;
    onSubmit(buildReferralBody({ provider, dealId, message, sharePhone: phoneOk && sharePhone, acknowledged }));
  };

  return (
    <View style={{ gap: 16 }} testID="referral-form">
      <View style={{ gap: 4 }}>
        <T variant="title" accessibilityRole="header">{t("services.request.title")}</T>
        <T variant="bodyStrong">{t("services.request.to", { name })}</T>
        <T tone="muted" variant="caption">{t("services.request.what")}</T>
      </View>

      {needsAck ? (
        <View
          testID="referral-disclosure"
          accessibilityRole="summary"
          style={[styles.disclosure, { borderColor: colors.warning, backgroundColor: colors.warningMuted, borderRadius: radii.md }]}
        >
          <T variant="heading" tone="warning">{t("services.request.disclosureTitle")}</T>
          <T variant="caption" tone="muted">{t("services.request.disclosureIntro")}</T>
          <T variant="bodyStrong" testID="referral-disclosure-text">{disclosure}</T>
          <Checkbox
            testID="referral-ack"
            checked={acknowledged}
            onChange={setAcknowledged}
            label={t("services.request.acknowledge")}
          />
        </View>
      ) : null}

      <TextField
        label={t("services.request.message")}
        placeholder={t("services.request.messagePlaceholder")}
        value={message}
        onChangeText={setMessage}
        multiline
        maxLength={MAX_REFERRAL_MESSAGE + 50}
        error={tooLong ? t("services.request.tooLong", { count: MAX_REFERRAL_MESSAGE }) : null}
        testID="referral-message"
      />

      <Card>
        <Row style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="bodyStrong" nativeID="share-phone-label">{t("services.request.sharePhone")}</T>
            <T variant="caption" tone="muted">
              {!phoneOk
                ? t("services.request.phoneUnverified")
                : sharePhone
                  ? t("services.request.sharePhoneHelp", { phone: localizeDigits(me?.phone ?? "", lang) })
                  : t("services.request.sharePhoneOff")}
            </T>
          </View>
          <Switch
            testID="referral-share-phone"
            value={phoneOk && sharePhone}
            onValueChange={setSharePhone}
            disabled={!phoneOk}
            accessibilityLabel={t("services.request.sharePhone")}
            accessibilityHint={!phoneOk ? t("services.request.phoneUnverified") : undefined}
            accessibilityState={{ disabled: !phoneOk, checked: phoneOk && sharePhone }}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </Row>
        {!phoneOk ? (
          <Button title={t("services.request.verifyPhone")} variant="ghost" size="sm" icon="call-outline" onPress={onVerifyPhone} testID="referral-verify-phone" style={{ alignSelf: "flex-start" }} />
        ) : null}
      </Card>

      {dealId ? <T variant="caption" tone="muted">{t("services.request.dealLinked")}</T> : null}
      <ServicesDisclaimer testID="referral-disclaimer" />
      {error ? <Notice tone="danger" testID="referral-error">{error}</Notice> : null}

      <Button
        title={t("services.request.submit")}
        icon="paper-plane-outline"
        onPress={submit}
        loading={submitting}
        disabled={!ready}
        fullWidth
        testID="referral-submit"
        accessibilityHint={needsAck && !acknowledged ? t("services.request.acknowledgeRequired") : undefined}
      />
      {needsAck && !acknowledged ? (
        <T variant="caption" tone="muted" center testID="referral-ack-hint">{t("services.request.acknowledgeRequired")}</T>
      ) : null}
    </View>
  );
}

const STATUS_TONE: Record<ReferralStatus, BadgeTone> = { requested: "info", contacted: "warning", completed: "success", cancelled: "neutral" };

export function ReferralRow({
  referral, onCancel, cancelling,
}: { referral: Schemas["ReferralOut"]; onCancel?: (r: Schemas["ReferralOut"]) => void; cancelling?: boolean }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const { name } = providerText(referral.provider, lang);
  return (
    <Card testID={`referral-${referral.id}`}>
      <Row style={{ justifyContent: "space-between" }} wrap>
        <Badge label={t(`services.category.${referral.provider.category}`)} tone="neutral" />
        <Badge label={t(`services.referrals.status.${referral.status}`)} tone={STATUS_TONE[referral.status]} testID="referral-status" />
      </Row>
      <T variant="heading">{name}</T>
      <T variant="caption" tone="muted">
        {`${t("services.referrals.sentOn", { date: formatDate(referral.created_at, lang) })} · ${
          referral.share_phone ? t("services.referrals.sharedPhone") : t("services.referrals.notSharedPhone")
        }`}
      </T>
      {referral.message ? <T>{referral.message}</T> : null}
      {onCancel && isOpenReferral(referral.status) ? (
        <Button
          title={t("services.referrals.cancel")}
          accessibilityLabel={t("services.referrals.cancelLabel", { name })}
          variant="danger"
          size="sm"
          icon="close-circle-outline"
          loading={cancelling}
          onPress={() => onCancel(referral)}
          style={{ alignSelf: "flex-start" }}
          testID={`referral-cancel-${referral.id}`}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  disclosure: { borderWidth: 1, padding: 14, gap: 8 },
});
