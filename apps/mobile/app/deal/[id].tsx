import React, { useState } from "react";
import { Alert, Platform, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { api, unwrap } from "../../src/api/client";
import { errorCode, errorMessage } from "../../src/api/errors";
import { qk, useDeal, useServiceSuggestions } from "../../src/api/queries";
import {
  Badge, Button, Card, Divider, ErrorState, KeyValue, LoadingState, Notice, Row, Screen, Section, SignInRequired, Stepper, T, TextField, type BadgeTone,
} from "../../src/components";
import { OfferForm, type OfferPayload } from "../../src/features/OfferForm";
import { ServiceSuggestionsCard } from "../../src/features/Services";
import { formatDate, formatMoney, formatRelative, localizeDigits } from "../../src/i18n/format";
import { useLanguage } from "../../src/i18n/LanguageProvider";
import { CHECKLIST_DOC_KIND, checklistAvailable, DEAL_TRACK, roleLabel, type ChecklistAction } from "../../src/lib/deal";
import { useIdempotencyKeys } from "../../src/lib/idempotency";
import { pickDocument, uploadDocument } from "../../src/lib/upload";
import { useTheme } from "../../src/theme";

type Deal = Schemas["DealOut"];
type Offer = Schemas["OfferOut"];

const OFFER_TONE: Record<Schemas["OfferStatus"], BadgeTone> = {
  pending: "warning", accepted: "success", rejected: "danger", countered: "info", withdrawn: "neutral", expired: "neutral",
};
const CHECK_TONE: Record<Schemas["ChecklistStatus"], BadgeTone> = { pending: "warning", submitted: "info", accepted: "success", waived: "neutral" };

function confirmThen(message: string, fn: () => void) {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(message) ?? true) fn();
    return;
  }
  Alert.alert(message, undefined, [{ text: "Cancel", style: "cancel" }, { text: "OK", onPress: fn }]);
}

export default function DealScreen() {
  return (
    <SignInRequired>
      <DealWorkspace />
    </SignInRequired>
  );
}

function DealWorkspace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useDeal(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <DealView deal={q.data} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />;
}

function OfferTerms({ offer, kind }: { offer: Pick<Offer, "terms">; kind: Schemas["DealKind"] }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const terms = offer.terms as Schemas["OfferTerms"];
  const parts: string[] = [];
  if (kind === "sale") {
    if (terms.proposed_handover_date) parts.push(`${t("offer.handoverDate")}: ${formatDate(terms.proposed_handover_date, lang)}`);
    if (terms.payment_note) parts.push(`${t("offer.paymentNote")}: ${terms.payment_note}`);
  } else {
    if (terms.lease_months) parts.push(`${t("offer.leaseMonths")}: ${localizeDigits(String(terms.lease_months), lang)}`);
    if (terms.start_date) parts.push(`${t("offer.startDate")}: ${formatDate(terms.start_date, lang)}`);
    if (terms.furnished !== undefined && terms.furnished !== null) parts.push(`${t("offer.furnished")}: ${terms.furnished ? t("common.yes") : t("common.no")}`);
  }
  if (!parts.length) return null;
  return <T variant="caption" tone="muted">{parts.join(" · ")}</T>;
}

function DealView({ deal: d, refreshing, onRefresh }: { deal: Deal; refreshing: boolean; onRefresh: () => void }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const router = useRouter();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const withKey = useIdempotencyKeys();
  const suggestions = useServiceSuggestions(d.id, d.status);
  const [mode, setMode] = useState<"none" | "counter" | "new">("none");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const me = roleLabel(d.my_role, d.kind, t);
  const otherRole = d.my_role === "buyer" ? "owner" : "buyer";
  const statusLabel = (s: Schemas["DealStatus"]) => t(`enum.dealStatus.${s}`);
  const pending = d.offers.find((o) => o.status === "pending");
  const mineToRespond = pending && pending.made_by !== d.my_role;
  const track = DEAL_TRACK[d.kind];
  const currentIndex = d.status === "cancelled" ? -1 : track.indexOf(d.status);
  const available = checklistAvailable(d.status);

  const onDone = (next: Deal) => {
    qc.setQueryData(qk.deal(d.id), next);
    void qc.invalidateQueries({ queryKey: qk.deals });
    setActionError(null);
  };
  const onFail = (e: unknown) => {
    setActionError(errorMessage(e, t));
    if (errorCode(e) === "offer_not_pending" || errorCode(e) === "negotiation_closed") onRefresh();
  };

  const respond = useMutation({
    mutationFn: async ({ offerId, action }: { offerId: string; action: Schemas["RespondIn"]["action"] }) => {
      const body = { action };
      return withKey(`respond.${offerId}`, body, async (key) =>
        unwrap(await api.POST("/deals/{deal_id}/offers/{offer_id}/respond", {
          params: { path: { deal_id: d.id, offer_id: offerId }, header: { "idempotency-key": key } },
          body,
        })));
    },
    onSuccess: onDone,
    onError: onFail,
  });
  const counter = useMutation({
    mutationFn: ({ offerId, p }: { offerId: string; p: OfferPayload }) =>
      withKey(`counter.${offerId}`, p, async (key) =>
        unwrap(await api.POST("/deals/{deal_id}/offers/{offer_id}/counter", {
          params: { path: { deal_id: d.id, offer_id: offerId }, header: { "idempotency-key": key } },
          body: p,
        }))),
    onSuccess: (n) => {
      setMode("none");
      onDone(n);
    },
    onError: onFail,
  });
  const newOffer = useMutation({
    mutationFn: async (p: OfferPayload) => {
      const body: Schemas["OfferIn"] = { listing_id: d.listing_id, kind: d.kind, ...p };
      return withKey("offer", body, async (key) =>
        unwrap(await api.POST("/deals/offers", { params: { header: { "idempotency-key": key } }, body })));
    },
    onSuccess: (n) => {
      setMode("none");
      onDone(n);
    },
    onError: onFail,
  });
  const advance = useMutation({
    mutationFn: async (target: Schemas["DealStatus"]) => {
      const body = { target };
      return withKey(`advance.${d.status}`, body, async (key) =>
        unwrap(await api.POST("/deals/{deal_id}/advance", {
          params: { path: { deal_id: d.id }, header: { "idempotency-key": key } },
          body,
        })));
    },
    onSuccess: onDone,
    onError: onFail,
  });
  const cancel = useMutation({
    mutationFn: async () => unwrap(await api.POST("/deals/{deal_id}/cancel", { params: { path: { deal_id: d.id } }, body: { reason: reason.trim() } })),
    onSuccess: (n) => {
      setCancelOpen(false);
      onDone(n);
    },
    onError: onFail,
  });
  const checklist = useMutation({
    mutationFn: async ({ item, action }: { item: Schemas["ChecklistOut"]; action: ChecklistAction | "upload" }) => {
      let document_id: string | null = null;
      if (action === "upload") {
        const f = await pickDocument();
        if (!f) return null;
        document_id = (await uploadDocument(f, CHECKLIST_DOC_KIND[item.code] ?? "other")).id;
      }
      return unwrap(await api.POST("/deals/{deal_id}/checklist/{item_id}", {
        params: { path: { deal_id: d.id, item_id: item.id } },
        body: { action: action === "upload" ? "submit" : action, document_id },
      }));
    },
    onSuccess: (n) => n && onDone(n),
    onError: onFail,
  });

  const busyAny = respond.isPending || counter.isPending || newOffer.isPending || advance.isPending || cancel.isPending || checklist.isPending;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh} testID="deal-workspace">
      <Stack.Screen options={{ title: t(`enum.dealKind.${d.kind}`) }} />
      <Card>
        <Row style={{ justifyContent: "space-between" }} wrap>
          <Badge label={t(`enum.dealKind.${d.kind}`)} tone="neutral" />
          <Badge label={statusLabel(d.status)} tone={d.status === "cancelled" ? "danger" : d.status === "negotiating" ? "warning" : "success"} testID="deal-status" />
        </Row>
        <T variant="heading" onPress={() => router.push(`/listing/${d.listing_id}`)} accessibilityRole="link">{d.listing_title}</T>
        <T tone="muted">{`${t("deals.asRole", { role: me })} · ${t("deals.with", { name: d.counterpart_name })}`}</T>
      </Card>

      <Notice tone="warning" title={t("deal.legalTitle")} icon="scale-outline" testID="legal-notice">
        {lang === "ar" ? <T variant="caption">{t("deal.legalBody")}</T> : null}
        {/* The API's notice is always shown verbatim. */}
        <T variant="caption" tone={lang === "ar" ? "muted" : "default"}>{d.legal_notice}</T>
      </Notice>

      {actionError ? <Notice tone="danger" testID="deal-error">{actionError}</Notice> : null}
      {d.status === "cancelled" && d.cancel_reason ? <Notice tone="danger">{t("deal.cancelledReason", { reason: d.cancel_reason })}</Notice> : null}

      {d.status === "negotiating" ? (
        <Section title={t("deal.negotiation")}>
          {pending ? (
            <Card testID="pending-offer">
              <Row style={{ justifyContent: "space-between" }}>
                <T variant="label" tone="muted">{pending.made_by === d.my_role ? t("deal.yourOffer") : t("deal.theirOffer", { name: d.counterpart_name })}</T>
                <Badge label={t("enum.offerStatus.pending")} tone="warning" />
              </Row>
              <T variant="display">{`${formatMoney(pending.amount, lang)}${d.kind === "rent" ? ` ${t("common.perMonth")}` : ""}`}</T>
              <OfferTerms offer={pending} kind={d.kind} />
              {pending.message ? <T>{`“${pending.message}”`}</T> : null}
              <T variant="caption" tone="muted">{t("deal.expires", { date: formatDate(pending.expires_at, lang, true) })}</T>
              {mineToRespond ? (
                <Row gap={8} wrap>
                  <Button title={t("deal.accept")} icon="checkmark" onPress={() => confirmThen(t("deal.confirmAction"), () => respond.mutate({ offerId: pending.id, action: "accept" }))} loading={respond.isPending && respond.variables?.action === "accept"} disabled={busyAny} testID="offer-accept" />
                  <Button title={t("deal.counter")} variant="secondary" onPress={() => setMode(mode === "counter" ? "none" : "counter")} disabled={busyAny} testID="offer-counter" />
                  <Button title={t("deal.reject")} variant="danger" onPress={() => confirmThen(t("deal.confirmAction"), () => respond.mutate({ offerId: pending.id, action: "reject" }))} loading={respond.isPending && respond.variables?.action === "reject"} disabled={busyAny} testID="offer-reject" />
                </Row>
              ) : (
                <>
                  <T variant="caption" tone="muted">{t("deal.waitingForResponse", { name: d.counterpart_name })}</T>
                  <Button title={t("deal.withdraw")} variant="outline" onPress={() => confirmThen(t("deal.confirmAction"), () => respond.mutate({ offerId: pending.id, action: "withdraw" }))} loading={respond.isPending} disabled={busyAny} testID="offer-withdraw" />
                </>
              )}
              {mode === "counter" ? (
                <>
                  <Divider />
                  <OfferForm
                    kind={d.kind}
                    initialTerms={pending.terms as Schemas["OfferTerms"]}
                    submitLabel={t("deal.sendCounter")}
                    onSubmit={(p) => counter.mutate({ offerId: pending.id, p })}
                    busy={counter.isPending}
                  />
                </>
              ) : null}
            </Card>
          ) : d.my_role === "buyer" ? (
            <Card>
              {mode === "new" ? (
                <OfferForm kind={d.kind} submitLabel={t("offer.submit")} onSubmit={(p) => newOffer.mutate(p)} busy={newOffer.isPending} />
              ) : (
                <Button title={t("deal.newOffer")} icon="pricetag-outline" onPress={() => setMode("new")} />
              )}
            </Card>
          ) : (
            <Notice tone="info">{t("deal.waitingForOffer")}</Notice>
          )}
        </Section>
      ) : null}

      {d.agreed_terms ? (
        <Section title={t("deal.agreedTerms")}>
          <Card>
            <KeyValue label={t("deal.amount")} value={`${formatMoney(String(d.agreed_terms.amount ?? ""), lang)}${d.kind === "rent" ? ` ${t("common.perMonth")}` : ""}`} strong />
            <OfferTerms offer={{ terms: d.agreed_terms }} kind={d.kind} />
            <Badge label={t("deal.preliminary")} tone="warning" />
          </Card>
        </Section>
      ) : null}

      {d.property_disclosure ? (
        <Section title={t("deal.disclosure")}>
          <Card testID="disclosure">
            <T variant="caption" tone="muted">{t("deal.disclosureHelp")}</T>
            <KeyValue label={t("deal.groupLabel")} value={String(d.property_disclosure.group ?? "—")} />
            <KeyValue label={t("deal.building")} value={String(d.property_disclosure.building ?? "—")} />
            {d.property_disclosure.unit ? <KeyValue label={t("deal.unit")} value={String(d.property_disclosure.unit)} /> : null}
            {d.property_disclosure.floor !== null && d.property_disclosure.floor !== undefined ? (
              <KeyValue label={t("listing.floor")} value={String(d.property_disclosure.floor)} />
            ) : null}
          </Card>
        </Section>
      ) : null}

      <Section title={t("deal.progress")}>
        <Card>
          <Stepper steps={track.map(statusLabel)} current={currentIndex === -1 ? 0 : currentIndex} cancelled={d.status === "cancelled"} />
          {d.status === "cancelled" ? <Badge label={statusLabel("cancelled")} tone="danger" /> : null}
        </Card>
      </Section>

      {d.status !== "negotiating" ? (
        <Section title={t("deal.nextSteps")}>
          {d.next_steps.length === 0 ? <T tone="muted">{t("deal.noNextSteps")}</T> : null}
          {d.next_steps.map((s) => {
            const label = statusLabel(s.status);
            const blocked = s.blocking_items.length > 0;
            const notMine = (s.who === "owner" || s.who === "buyer") && s.who !== d.my_role;
            const waiting = s.who === "both" && s.my_confirmation_given;
            return (
              <Card key={s.status} testID={`step-${s.status}`}>
                <T variant="heading">{label}</T>
                <T variant="caption" tone="muted">{t(`enum.who.${s.who}`)}</T>
                {s.who === "both" ? (
                  <Row wrap>
                    <Badge label={s.my_confirmation_given ? t("deal.youConfirmed") : t("deal.youNotConfirmed")} tone={s.my_confirmation_given ? "success" : "neutral"} icon={s.my_confirmation_given ? "checkmark" : undefined} />
                    <Badge
                      label={s.counterpart_confirmation_given ? t("deal.theyConfirmed", { name: d.counterpart_name }) : t("deal.theyNotConfirmed", { name: d.counterpart_name })}
                      tone={s.counterpart_confirmation_given ? "success" : "neutral"}
                      icon={s.counterpart_confirmation_given ? "checkmark" : undefined}
                    />
                  </Row>
                ) : null}
                {blocked ? (
                  <Notice tone="warning">{t("deal.blocked", { items: s.blocking_items.map((c) => t(`enum.checklistCode.${c}`, { defaultValue: c })).join(lang === "ar" ? "، " : ", ") })}</Notice>
                ) : null}
                {notMine ? (
                  <T variant="caption" tone="muted">{t("deal.notYourStep", { role: roleLabel(s.who, d.kind, t) })}</T>
                ) : waiting ? (
                  <T variant="caption" tone="muted">{t("deal.waitingFor", { name: d.counterpart_name })}</T>
                ) : (
                  <Button
                    title={s.who === "both" ? t("deal.confirmStep", { status: label }) : t("deal.moveTo", { status: label })}
                    disabled={blocked || busyAny}
                    loading={advance.isPending && advance.variables === s.status}
                    onPress={() => confirmThen(t("deal.confirmAction"), () => advance.mutate(s.status))}
                    testID={`advance-${s.status}`}
                  />
                )}
              </Card>
            );
          })}
        </Section>
      ) : null}

      <ServiceSuggestionsCard
        suggestions={suggestions.data}
        onOpen={(category) => router.push(`/services?category=${category}&dealId=${d.id}`)}
      />

      <Section title={t("deal.checklist")}>
        {!available && d.status === "negotiating" ? <T variant="caption" tone="muted">{t("deal.checklistLocked")}</T> : null}
        <Card>
          {d.checklist.map((item, i) => {
            const actions: ChecklistAction[] = item.allowed_actions ?? [];
            const mine = item.responsible === d.my_role;
            return (
              <View key={item.id} style={{ gap: 6 }} testID={`check-${item.code}`}>
                {i ? <Divider /> : null}
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T variant="bodyStrong">{t(`enum.checklistCode.${item.code}`, { defaultValue: item.code })}</T>
                    <T variant="caption" tone="muted">
                      {`${mine ? t("deal.responsibleYou") : t("deal.responsibleThem", { name: d.counterpart_name })} · ${t("deal.requiredFor", { status: statusLabel(item.required_for) })}`}
                    </T>
                    {item.document_id ? <T variant="caption" tone="info">{t("deal.hasDocument")}</T> : null}
                  </View>
                  <Badge label={t(`enum.checklistStatus.${item.status}`)} tone={CHECK_TONE[item.status]} />
                </Row>
                {actions.length ? (
                  <Row wrap>
                    {actions.includes("submit") ? (
                      <>
                        <Button size="sm" title={t("deal.upload")} icon="cloud-upload-outline" onPress={() => checklist.mutate({ item, action: "upload" })} disabled={busyAny} loading={checklist.isPending && checklist.variables?.item.id === item.id && checklist.variables.action === "upload"} />
                        <Button size="sm" variant="outline" title={t("deal.submitNoFile")} onPress={() => checklist.mutate({ item, action: "submit" })} disabled={busyAny} />
                      </>
                    ) : null}
                    {actions.includes("accept") ? <Button size="sm" title={t("deal.acceptItem")} onPress={() => checklist.mutate({ item, action: "accept" })} disabled={busyAny} /> : null}
                    {actions.includes("reopen") ? <Button size="sm" variant="outline" title={t("deal.reopen")} onPress={() => checklist.mutate({ item, action: "reopen" })} disabled={busyAny} /> : null}
                    {actions.includes("waive") ? <Button size="sm" variant="ghost" title={t("deal.waive")} onPress={() => confirmThen(t("deal.confirmAction"), () => checklist.mutate({ item, action: "waive" }))} disabled={busyAny} /> : null}
                  </Row>
                ) : null}
              </View>
            );
          })}
        </Card>
      </Section>

      <Section title={t("deal.history")}>
        <Card>
          {[...d.offers].reverse().map((o, i) => (
            <View key={o.id} style={{ gap: 4 }}>
              {i ? <Divider /> : null}
              <Row style={{ justifyContent: "space-between" }}>
                <T variant="bodyStrong">{`${o.made_by === d.my_role ? t("common.you") : d.counterpart_name} · ${formatMoney(o.amount, lang)}`}</T>
                <Badge label={t(`enum.offerStatus.${o.status}`)} tone={OFFER_TONE[o.status]} />
              </Row>
              <OfferTerms offer={o} kind={d.kind} />
              {o.message ? <T variant="caption">{`“${o.message}”`}</T> : null}
              <T variant="caption" tone="muted">{formatRelative(o.created_at, lang)}</T>
            </View>
          ))}
        </Card>
      </Section>

      <Section title={t("deal.activity")}>
        <Card>
          {[...d.events].reverse().map((e) => {
            const data = e.data as Record<string, string>;
            const extra =
              e.type === "deal.status_changed" && data.to ? ` → ${statusLabel(data.to as Schemas["DealStatus"])}`
              : e.type === "milestone.confirmed" && data.target ? ` · ${statusLabel(data.target as Schemas["DealStatus"])}`
              : data.code ? ` · ${t(`enum.checklistCode.${data.code}`, { defaultValue: data.code })}`
              : data.amount ? ` · ${formatMoney(data.amount, lang)}` : "";
            return (
              <Row key={e.id} style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <T style={{ flex: 1 }}>{`${t(`events.${e.type}`, { defaultValue: e.type })}${extra}`}</T>
                <T variant="caption" tone="muted">{formatRelative(e.created_at, lang)}</T>
              </Row>
            );
          })}
        </Card>
      </Section>

      {d.can_cancel ? (
        <Section>
          {cancelOpen ? (
            <Card>
              <T variant="heading">{t("deal.cancelTitle")}</T>
              <TextField label={t("deal.cancelReason")} placeholder={t("deal.cancelReasonPlaceholder")} value={reason} onChangeText={setReason} multiline maxLength={500} error={reason.length > 0 && reason.trim().length < 3 ? t("validation.minLength", { count: 3 }) : undefined} />
              <Row>
                <Button title={t("common.back")} variant="outline" onPress={() => setCancelOpen(false)} />
                <Button title={t("deal.cancelConfirm")} variant="danger" disabled={reason.trim().length < 3} loading={cancel.isPending} onPress={() => cancel.mutate()} style={{ flex: 1 }} testID="deal-cancel-confirm" />
              </Row>
            </Card>
          ) : (
            <Button title={t("deal.cancel")} variant="danger" icon="close-circle-outline" onPress={() => setCancelOpen(true)} testID="deal-cancel" />
          )}
        </Section>
      ) : null}
      <View style={{ height: 24, backgroundColor: colors.background }} />
    </Screen>
  );
}
