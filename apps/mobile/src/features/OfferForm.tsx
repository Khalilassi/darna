import React, { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { Button, ChipGroup, DateField, Notice, T, TextField } from "../components";
import { formatMoney, parseAmountInput } from "../i18n/format";
import { useLanguage } from "../i18n/LanguageProvider";
import { todayISO } from "../lib/date";
import { hasErrors, validateAmount, validateDate, validateInt } from "../lib/validation";

export interface OfferPayload {
  amount: number;
  terms: Schemas["OfferTerms"];
  message?: string | null;
  expires_in_hours?: number | null;
}

/** Offer / counter-offer form for sale (price + handover + payment note) or rent (rent + lease + start). */
export function OfferForm({
  kind, asking, initialTerms, submitLabel, onSubmit, busy, error, fieldErrors = {},
}: {
  kind: Schemas["DealKind"];
  asking?: string | null;
  initialTerms?: Schemas["OfferTerms"];
  submitLabel: string;
  onSubmit: (p: OfferPayload) => void;
  busy?: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const [amount, setAmount] = useState("");
  const [handover, setHandover] = useState(initialTerms?.proposed_handover_date ?? "");
  const [paymentNote, setPaymentNote] = useState(initialTerms?.payment_note ?? "");
  const [leaseMonths, setLeaseMonths] = useState(initialTerms?.lease_months ? String(initialTerms.lease_months) : "");
  const [startDate, setStartDate] = useState(initialTerms?.start_date ?? "");
  const [furnished, setFurnished] = useState<boolean | undefined>(initialTerms?.furnished ?? undefined);
  const [message, setMessage] = useState("");
  const [expiry, setExpiry] = useState<number>(72);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const submit = () => {
    const e =
      kind === "sale"
        ? { amount: validateAmount(amount, t), handover: validateDate(handover, t, { future: true }) }
        : {
            amount: validateAmount(amount, t),
            lease_months: validateInt(leaseMonths, t, 1, 120),
            start_date: validateDate(startDate, t, { future: true }),
          };
    setErrors(e);
    if (hasErrors(e)) return;
    const terms: Schemas["OfferTerms"] =
      kind === "sale"
        ? { proposed_handover_date: handover.trim() || null, payment_note: paymentNote.trim() || null }
        : { lease_months: Number(parseAmountInput(leaseMonths)), start_date: startDate.trim() || null, furnished: furnished ?? null };
    onSubmit({ amount: parseAmountInput(amount)!, terms, message: message.trim() || null, expires_in_hours: expiry });
  };

  return (
    <View style={{ gap: 14 }}>
      <TextField
        label={kind === "sale" ? t("offer.amountSale") : t("offer.amountRent")}
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        hint={asking ? t("offer.asking", { price: formatMoney(asking, lang) }) : undefined}
        error={errors.amount ?? fieldErrors.amount}
        testID="offer-amount"
      />
      {kind === "sale" ? (
        <>
          <DateField label={t("offer.handoverDate")} value={handover} onChange={setHandover} min={todayISO()} optional error={errors.handover ?? fieldErrors["terms.proposed_handover_date"]} testID="offer-handover" />
          <TextField label={t("offer.paymentNote")} value={paymentNote} onChangeText={setPaymentNote} placeholder={t("offer.paymentNotePlaceholder")} maxLength={300} optional optionalLabel={t("common.optional")} />
        </>
      ) : (
        <>
          <TextField label={t("offer.leaseMonths")} value={leaseMonths} onChangeText={setLeaseMonths} keyboardType="number-pad" error={errors.lease_months ?? fieldErrors["terms.lease_months"]} testID="offer-lease-months" />
          <DateField label={t("offer.startDate")} value={startDate} onChange={setStartDate} min={todayISO()} optional error={errors.start_date ?? fieldErrors["terms.start_date"]} testID="offer-start-date" />
          <ChipGroup label={t("offer.furnished")} value={furnished} allowClear onChange={setFurnished} options={[{ value: true, label: t("common.yes") }, { value: false, label: t("common.no") }]} />
        </>
      )}
      <TextField label={t("offer.message")} value={message} onChangeText={setMessage} placeholder={t("offer.messagePlaceholder")} multiline maxLength={1000} />
      <ChipGroup
        label={t("offer.expiry")}
        value={expiry}
        onChange={(v) => v && setExpiry(v)}
        options={[{ value: 24, label: t("offer.h24") }, { value: 72, label: t("offer.h72") }, { value: 168, label: t("offer.h168") }]}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <T variant="caption" tone="muted">{t("offer.nonBinding")}</T>
      <Button title={submitLabel} onPress={submit} loading={busy} fullWidth size="lg" testID="offer-submit" />
    </View>
  );
}
