import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Schemas } from "@darna/api-client";
import { Button, Card, ChipGroup, Divider, IconButton, Notice, Row, Section, Select, T, TextField } from "../components";
import { lineItemLabel } from "../components/PriceBreakdown";
import { parseAmountInput } from "../i18n/format";
import { DATE_RE, validateAmount, validateDate, validateInt } from "../lib/validation";

/** Owners may only state seller-provided figures, estimates (with an assumption) or unknown. */
export type OwnerProvenance = "seller_provided" | "estimate" | "unknown";
export const OWNER_PROVENANCES: OwnerProvenance[] = ["seller_provided", "estimate", "unknown"];

export interface AmountState { amount: string; provenance: OwnerProvenance; assumption: string }
export interface InstallmentState { due_date: string; amount: string; schedule: string; provenance: "seller_provided" | "estimate" }
export interface FeeState { code: string; value: AmountState; payer: Schemas["Payer"]; buyer_share: string }
type OwnPayer = "buyer" | "seller" | "included_in_price";

export interface ListingFormState {
  purpose: Schemas["ListingPurpose"];
  title: string;
  description: string;
  sale: {
    payment_mode: Schemas["PaymentMode"];
    owner_cash_price: string;
    original_contract_price: AmountState;
    paid_to_developer: AmountState;
    installments: InstallmentState[];
    overdue_payer: OwnPayer;
    maintenance_deposit_due: AmountState;
    maintenance_payer: OwnPayer;
    fees: FeeState[];
  };
  rent: {
    monthly_rent: string;
    security_deposit_months: string;
    advance_months: string;
    min_lease_months: string;
    furnished: boolean;
    utilities_included: boolean;
    annual_increase_pct: string;
    available_from: string;
    fees: FeeState[];
  };
}

export const FEE_CODES = ["transfer_fee", "registration_fee", "club_membership", "utility_connection", "garage", "legal_fees", "compound_fee"];

const emptyAmount = (): AmountState => ({ amount: "", provenance: "seller_provided", assumption: "" });
const fromAmount = (a?: Schemas["Amount-Output"] | null): AmountState =>
  a
    ? { amount: a.amount ?? "", provenance: a.provenance === "verified" ? "seller_provided" : (a.provenance as OwnerProvenance) ?? "seller_provided", assumption: a.assumption ?? "" }
    : emptyAmount();
const fromFee = (f: Schemas["Fee-Output"]): FeeState => ({
  code: f.code, value: fromAmount(f.value), payer: f.payer ?? "buyer", buyer_share: String(Math.round(Number(f.buyer_share ?? 0.5) * 100)),
});

export function initialListingForm(l?: Pick<Schemas["OwnerListingOut"], "purpose" | "title" | "description" | "sale_terms" | "rent_terms">): ListingFormState {
  const s = l?.sale_terms;
  const r = l?.rent_terms;
  return {
    purpose: l?.purpose ?? "sale",
    title: l?.title ?? "",
    description: l?.description ?? "",
    sale: {
      payment_mode: s?.payment_mode ?? "cash",
      owner_cash_price: s?.owner_cash_price.amount ?? "",
      original_contract_price: fromAmount(s?.original_contract_price),
      paid_to_developer: fromAmount(s?.paid_to_developer),
      installments: (s?.installments ?? []).map((i) => ({
        due_date: i.due_date, amount: i.amount, schedule: i.schedule ?? "unit", provenance: i.provenance === "estimate" ? "estimate" : "seller_provided",
      })),
      overdue_payer: (s?.overdue_payer as OwnPayer) ?? "seller",
      maintenance_deposit_due: fromAmount(s?.maintenance_deposit_due),
      maintenance_payer: (s?.maintenance_payer as OwnPayer) ?? "buyer",
      fees: (s?.fees ?? []).map(fromFee),
    },
    rent: {
      monthly_rent: r?.monthly_rent ?? "",
      security_deposit_months: r?.security_deposit_months ?? "1",
      advance_months: String(r?.advance_months ?? 1),
      min_lease_months: String(r?.min_lease_months ?? 12),
      furnished: r?.furnished ?? false,
      utilities_included: r?.utilities_included ?? false,
      annual_increase_pct: r?.annual_increase_pct ?? "",
      available_from: r?.available_from ?? "",
      fees: (r?.fees ?? []).map(fromFee),
    },
  };
}

type Errors = Record<string, string | undefined>;

function amountPayload(a: AmountState, optional: boolean): Schemas["Amount-Input"] | null {
  if (a.provenance === "unknown") return { provenance: "unknown" };
  if (optional && !a.amount.trim()) return null;
  return { amount: parseAmountInput(a.amount), provenance: a.provenance, assumption: a.provenance === "estimate" ? a.assumption.trim() : null };
}

function validateAmountState(a: AmountState, path: string, optional: boolean, t: TFunction, e: Errors) {
  if (a.provenance === "unknown") return;
  if (optional && !a.amount.trim()) return;
  e[`${path}.amount`] = validateAmount(a.amount, t);
  if (a.provenance === "estimate" && !a.assumption.trim()) e[`${path}.assumption`] = t("validation.assumption");
}

function feesPayload(fees: FeeState[]): Schemas["Fee-Input"][] {
  return fees.map((f) => ({
    code: f.code,
    value: amountPayload(f.value, false)!,
    payer: f.payer,
    buyer_share: f.payer === "split" ? (parseAmountInput(f.buyer_share) ?? 50) / 100 : 0.5,
  }));
}

/** Client-side validation; keys mirror the API's validation `loc` paths so server errors land on the same fields. */
export function validateListingForm(s: ListingFormState, t: TFunction): Errors {
  const e: Errors = {};
  if (s.title.trim().length < 5) e.title = t("validation.minLength", { count: 5 });
  const needsSale = s.purpose !== "rent";
  const needsRent = s.purpose !== "sale";
  if (needsSale) {
    const p = "sale_terms";
    e[`${p}.owner_cash_price.amount`] = validateAmount(s.sale.owner_cash_price, t);
    validateAmountState(s.sale.original_contract_price, `${p}.original_contract_price`, true, t, e);
    validateAmountState(s.sale.paid_to_developer, `${p}.paid_to_developer`, true, t, e);
    validateAmountState(s.sale.maintenance_deposit_due, `${p}.maintenance_deposit_due`, true, t, e);
    if (s.sale.payment_mode === "installments" && !s.sale.installments.length) e[`${p}.installments`] = t("validation.required");
    if (s.sale.payment_mode === "installments")
      s.sale.installments.forEach((i, idx) => {
        e[`${p}.installments.${idx}.due_date`] = validateDate(i.due_date, t, { required: true });
        e[`${p}.installments.${idx}.amount`] = validateAmount(i.amount, t);
      });
    s.sale.fees.forEach((f, idx) => validateAmountState(f.value, `${p}.fees.${idx}.value`, false, t, e));
  }
  if (needsRent) {
    const p = "rent_terms";
    e[`${p}.monthly_rent`] = validateAmount(s.rent.monthly_rent, t);
    e[`${p}.advance_months`] = validateInt(s.rent.advance_months, t, 1, 12);
    e[`${p}.min_lease_months`] = validateInt(s.rent.min_lease_months, t, 1, 120);
    const dep = parseAmountInput(s.rent.security_deposit_months);
    if (dep === null || dep < 0 || dep > 12) e[`${p}.security_deposit_months`] = t("validation.range", { min: 0, max: 12 });
    if (s.rent.annual_increase_pct.trim()) {
      const inc = parseAmountInput(s.rent.annual_increase_pct);
      if (inc === null || inc > 100) e[`${p}.annual_increase_pct`] = t("validation.range", { min: 0, max: 100 });
    }
    e[`${p}.available_from`] = validateDate(s.rent.available_from, t);
    s.rent.fees.forEach((f, idx) => validateAmountState(f.value, `${p}.fees.${idx}.value`, false, t, e));
  }
  for (const k of Object.keys(e)) if (!e[k]) delete e[k];
  return e;
}

export function listingPayload(s: ListingFormState) {
  const needsSale = s.purpose !== "rent";
  const needsRent = s.purpose !== "sale";
  const sale_terms: Schemas["SaleTermsIn-Input"] | null = needsSale
    ? {
        payment_mode: s.sale.payment_mode,
        owner_cash_price: { amount: parseAmountInput(s.sale.owner_cash_price), provenance: "seller_provided" },
        original_contract_price: amountPayload(s.sale.original_contract_price, true),
        paid_to_developer: amountPayload(s.sale.paid_to_developer, true),
        installments:
          s.sale.payment_mode === "installments"
            ? s.sale.installments.map((i) => ({ due_date: i.due_date.trim(), amount: parseAmountInput(i.amount)!, schedule: i.schedule.trim() || "unit", provenance: i.provenance }))
            : [],
        overdue_payer: s.sale.overdue_payer,
        maintenance_deposit_due: amountPayload(s.sale.maintenance_deposit_due, true),
        maintenance_payer: s.sale.maintenance_payer,
        fees: feesPayload(s.sale.fees),
      }
    : null;
  const rent_terms: Schemas["RentInput-Input"] | null = needsRent
    ? {
        monthly_rent: parseAmountInput(s.rent.monthly_rent)!,
        security_deposit_months: parseAmountInput(s.rent.security_deposit_months) ?? 1,
        advance_months: Number(parseAmountInput(s.rent.advance_months) ?? 1),
        min_lease_months: Number(parseAmountInput(s.rent.min_lease_months) ?? 12),
        furnished: s.rent.furnished,
        utilities_included: s.rent.utilities_included,
        annual_increase_pct: s.rent.annual_increase_pct.trim() ? parseAmountInput(s.rent.annual_increase_pct) : null,
        available_from: s.rent.available_from.trim() || null,
        fees: feesPayload(s.rent.fees),
      }
    : null;
  return { purpose: s.purpose, title: s.title.trim(), description: s.description.trim(), sale_terms, rent_terms };
}

/** Adds months to a YYYY-MM-DD date. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

function AmountField({
  label, value, onChange, errors, path, help,
}: { label: string; value: AmountState; onChange: (v: AmountState) => void; errors: Errors; path: string; help?: string }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 8 }}>
      <ChipGroup
        label={`${label} · ${t("listingForm.provenance")}`}
        value={value.provenance}
        onChange={(p) => p && onChange({ ...value, provenance: p, amount: p === "unknown" ? "" : value.amount })}
        options={OWNER_PROVENANCES.map((p) => ({ value: p, label: t(`provenance.${p}`) }))}
      />
      {value.provenance !== "unknown" ? (
        <TextField
          label={label}
          value={value.amount}
          onChangeText={(a) => onChange({ ...value, amount: a })}
          keyboardType="numeric"
          hint={help}
          error={errors[`${path}.amount`]}
        />
      ) : (
        <T variant="caption" tone="warning">{t("fin.notConfirmedHelp")}</T>
      )}
      {value.provenance === "estimate" ? (
        <TextField
          label={t("listingForm.assumption")}
          placeholder={t("listingForm.assumptionPlaceholder")}
          value={value.assumption}
          onChangeText={(a) => onChange({ ...value, assumption: a })}
          maxLength={300}
          error={errors[`${path}.assumption`]}
        />
      ) : null}
    </View>
  );
}

function FeesEditor({ fees, onChange, errors, path, allowSplit = true }: { fees: FeeState[]; onChange: (f: FeeState[]) => void; errors: Errors; path: string; allowSplit?: boolean }) {
  const { t } = useTranslation();
  const used = new Set(fees.map((f) => f.code));
  const next = FEE_CODES.find((c) => !used.has(c));
  const payers: Schemas["Payer"][] = allowSplit ? ["buyer", "seller", "included_in_price", "split"] : ["buyer", "seller", "included_in_price"];
  const update = (i: number, patch: Partial<FeeState>) => onChange(fees.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <Section title={t("listingForm.fees")}>
      {fees.map((f, i) => (
        <Card key={i}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Select
                label={t("listingForm.feeCode")}
                value={f.code}
                onChange={(c) => c && update(i, { code: c })}
                options={FEE_CODES.filter((c) => c === f.code || !used.has(c)).map((c) => ({ value: c, label: lineItemLabel(c, t) }))}
              />
            </View>
            <IconButton icon="trash-outline" label={`${t("common.remove")} ${lineItemLabel(f.code, t)}`} onPress={() => onChange(fees.filter((_, j) => j !== i))} />
          </Row>
          <AmountField label={t("listingForm.amount")} value={f.value} onChange={(v) => update(i, { value: v })} errors={errors} path={`${path}.${i}.value`} />
          <ChipGroup label={t("listingForm.payer")} value={f.payer} onChange={(p) => p && update(i, { payer: p })} options={payers.map((p) => ({ value: p, label: t(`enum.payer.${p}`) }))} />
          {f.payer === "split" ? (
            <TextField label={t("listingForm.buyerShare")} value={f.buyer_share} onChangeText={(v) => update(i, { buyer_share: v })} keyboardType="numeric" />
          ) : null}
        </Card>
      ))}
      {next ? (
        <Button
          title={t("listingForm.addFee")}
          variant="outline"
          size="sm"
          icon="add"
          onPress={() => onChange([...fees, { code: next, value: emptyAmount(), payer: "buyer", buyer_share: "50" }])}
          style={{ alignSelf: "flex-start" }}
        />
      ) : null}
    </Section>
  );
}

function InstallmentsEditor({ items, onChange, errors }: { items: InstallmentState[]; onChange: (i: InstallmentState[]) => void; errors: Errors }) {
  const { t } = useTranslation();
  const [gen, setGen] = useState({ count: "16", every: "3", first: "", amount: "" });
  const [genError, setGenError] = useState<string | null>(null);
  const generate = () => {
    const count = parseAmountInput(gen.count);
    const every = parseAmountInput(gen.every);
    const amount = parseAmountInput(gen.amount);
    if (!count || count > 120 || !every || !amount || !DATE_RE.test(gen.first.trim())) return setGenError(t("validation.required"));
    setGenError(null);
    onChange([
      ...items,
      ...Array.from({ length: count }, (_, k) => ({
        due_date: addMonths(gen.first.trim(), k * every), amount: String(amount), schedule: "unit", provenance: "seller_provided" as const,
      })),
    ]);
  };
  const update = (i: number, patch: Partial<InstallmentState>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Section title={t("listingForm.installments")}>
      {errors["sale_terms.installments"] ? <T variant="caption" tone="danger">{errors["sale_terms.installments"]}</T> : null}
      <Card>
        <T variant="bodyStrong">{t("listingForm.quickFill")}</T>
        <Row gap={8}>
          <TextField containerStyle={styles.flex} label={t("listingForm.count")} value={gen.count} onChangeText={(v) => setGen({ ...gen, count: v })} keyboardType="number-pad" />
          <TextField containerStyle={styles.flex} label={t("listingForm.everyMonths")} value={gen.every} onChangeText={(v) => setGen({ ...gen, every: v })} keyboardType="number-pad" />
        </Row>
        <Row gap={8}>
          <TextField containerStyle={styles.flex} label={t("listingForm.firstDue")} placeholder="YYYY-MM-DD" value={gen.first} onChangeText={(v) => setGen({ ...gen, first: v })} />
          <TextField containerStyle={styles.flex} label={t("listingForm.amount")} value={gen.amount} onChangeText={(v) => setGen({ ...gen, amount: v })} keyboardType="numeric" />
        </Row>
        {genError ? <T variant="caption" tone="danger">{genError}</T> : null}
        <Button title={t("listingForm.generate")} variant="secondary" size="sm" onPress={generate} style={{ alignSelf: "flex-start" }} />
      </Card>
      {items.map((it, i) => (
        <View key={i} style={{ gap: 6 }}>
          {i ? <Divider /> : null}
          <Row gap={8} style={{ alignItems: "flex-start" }}>
            <TextField containerStyle={styles.flex} label={t("listingForm.dueDate")} placeholder="YYYY-MM-DD" value={it.due_date} onChangeText={(v) => update(i, { due_date: v })} error={errors[`sale_terms.installments.${i}.due_date`]} />
            <TextField containerStyle={styles.flex} label={t("listingForm.amount")} value={it.amount} onChangeText={(v) => update(i, { amount: v })} keyboardType="numeric" error={errors[`sale_terms.installments.${i}.amount`]} />
            <View style={{ paddingTop: 22 }}>
              <IconButton icon="trash-outline" label={t("common.remove")} onPress={() => onChange(items.filter((_, j) => j !== i))} />
            </View>
          </Row>
          <Row gap={8}>
            <TextField containerStyle={styles.flex} label={t("listingForm.schedule")} value={it.schedule} onChangeText={(v) => update(i, { schedule: v })} maxLength={40} />
            <View style={styles.flex}>
              <ChipGroup
                label={t("listingForm.provenance")}
                value={it.provenance}
                onChange={(p) => p && update(i, { provenance: p })}
                options={(["seller_provided", "estimate"] as const).map((p) => ({ value: p, label: t(`provenance.${p}`) }))}
              />
            </View>
          </Row>
        </View>
      ))}
      <Button
        title={t("listingForm.addInstallment")}
        variant="outline"
        size="sm"
        icon="add"
        onPress={() => onChange([...items, { due_date: "", amount: "", schedule: "unit", provenance: "seller_provided" }])}
        style={{ alignSelf: "flex-start" }}
      />
    </Section>
  );
}

export function ListingForm({
  initial, submitLabel, onSubmit, busy, error, serverErrors = {}, lockPurpose,
}: {
  initial: ListingFormState;
  submitLabel: string;
  onSubmit: (s: ListingFormState) => void;
  busy?: boolean;
  error?: string | null;
  serverErrors?: Errors;
  lockPurpose?: boolean;
}) {
  const { t } = useTranslation();
  const [s, setS] = useState<ListingFormState>(initial);
  const [local, setLocal] = useState<Errors>({});
  const errors = { ...serverErrors, ...local };
  const setSale = (patch: Partial<ListingFormState["sale"]>) => setS((x) => ({ ...x, sale: { ...x.sale, ...patch } }));
  const setRent = (patch: Partial<ListingFormState["rent"]>) => setS((x) => ({ ...x, rent: { ...x.rent, ...patch } }));
  const payerOpts = (["buyer", "seller", "included_in_price"] as const).map((p) => ({ value: p, label: t(`enum.payer.${p}`) }));
  const yesNo = [{ value: true, label: t("common.yes") }, { value: false, label: t("common.no") }];

  const submit = () => {
    const e = validateListingForm(s, t);
    setLocal(e);
    if (!Object.keys(e).length) onSubmit(s);
  };

  return (
    <View style={{ gap: 20 }}>
      {!lockPurpose ? (
        <ChipGroup
          label={t("listingForm.purpose")}
          value={s.purpose}
          onChange={(p) => p && setS({ ...s, purpose: p })}
          options={(["sale", "rent", "sale_and_rent"] as const).map((p) => ({ value: p, label: t(`enum.purpose.${p}`) }))}
        />
      ) : null}
      <TextField label={t("listingForm.title")} placeholder={t("listingForm.titlePlaceholder")} value={s.title} onChangeText={(v) => setS({ ...s, title: v })} maxLength={140} error={errors.title} testID="lf-title" />
      <TextField label={t("listingForm.description")} placeholder={t("listingForm.descriptionPlaceholder")} value={s.description} onChangeText={(v) => setS({ ...s, description: v })} multiline maxLength={5000} />
      <Notice tone="info" icon="shield-checkmark-outline">{t("listingForm.provenanceHelp")}</Notice>

      {s.purpose !== "rent" ? (
        <Section title={t("listingForm.sale")}>
          <ChipGroup
            label={t("listingForm.paymentMode")}
            value={s.sale.payment_mode}
            onChange={(m) => m && setSale({ payment_mode: m })}
            options={(["cash", "installments"] as const).map((m) => ({ value: m, label: t(`enum.paymentMode.${m}`) }))}
          />
          <TextField
            label={t("listingForm.ownerCashPrice")}
            value={s.sale.owner_cash_price}
            onChangeText={(v) => setSale({ owner_cash_price: v })}
            keyboardType="numeric"
            hint={t("listingForm.ownerCashPriceHelp")}
            error={errors["sale_terms.owner_cash_price.amount"]}
            testID="lf-price"
          />
          <AmountField label={t("listingForm.originalContractPrice")} value={s.sale.original_contract_price} onChange={(v) => setSale({ original_contract_price: v })} errors={errors} path="sale_terms.original_contract_price" help={t("listingForm.notProvided")} />
          <AmountField label={t("listingForm.paidToDeveloper")} value={s.sale.paid_to_developer} onChange={(v) => setSale({ paid_to_developer: v })} errors={errors} path="sale_terms.paid_to_developer" help={t("listingForm.notProvided")} />
          {s.sale.payment_mode === "installments" ? (
            <>
              <InstallmentsEditor items={s.sale.installments} onChange={(i) => setSale({ installments: i })} errors={errors} />
              <ChipGroup label={t("listingForm.overduePayer")} value={s.sale.overdue_payer} onChange={(p) => p && setSale({ overdue_payer: p })} options={payerOpts} />
            </>
          ) : null}
          <AmountField label={t("listingForm.maintenanceDeposit")} value={s.sale.maintenance_deposit_due} onChange={(v) => setSale({ maintenance_deposit_due: v })} errors={errors} path="sale_terms.maintenance_deposit_due" help={t("listingForm.notProvided")} />
          <ChipGroup label={t("listingForm.maintenancePayer")} value={s.sale.maintenance_payer} onChange={(p) => p && setSale({ maintenance_payer: p })} options={payerOpts} />
          <FeesEditor fees={s.sale.fees} onChange={(f) => setSale({ fees: f })} errors={errors} path="sale_terms.fees" />
        </Section>
      ) : null}

      {s.purpose !== "sale" ? (
        <Section title={t("listingForm.rent")}>
          <TextField label={t("listingForm.monthlyRent")} value={s.rent.monthly_rent} onChangeText={(v) => setRent({ monthly_rent: v })} keyboardType="numeric" error={errors["rent_terms.monthly_rent"]} testID="lf-rent" />
          <Row gap={8} style={{ alignItems: "flex-start" }}>
            <TextField containerStyle={styles.flex} label={t("listingForm.depositMonths")} value={s.rent.security_deposit_months} onChangeText={(v) => setRent({ security_deposit_months: v })} keyboardType="decimal-pad" error={errors["rent_terms.security_deposit_months"]} />
            <TextField containerStyle={styles.flex} label={t("listingForm.advanceMonths")} value={s.rent.advance_months} onChangeText={(v) => setRent({ advance_months: v })} keyboardType="number-pad" error={errors["rent_terms.advance_months"]} />
          </Row>
          <Row gap={8} style={{ alignItems: "flex-start" }}>
            <TextField containerStyle={styles.flex} label={t("listingForm.minLease")} value={s.rent.min_lease_months} onChangeText={(v) => setRent({ min_lease_months: v })} keyboardType="number-pad" error={errors["rent_terms.min_lease_months"]} />
            <TextField containerStyle={styles.flex} label={t("listingForm.increase")} value={s.rent.annual_increase_pct} onChangeText={(v) => setRent({ annual_increase_pct: v })} keyboardType="decimal-pad" error={errors["rent_terms.annual_increase_pct"]} optional optionalLabel={t("common.optional")} />
          </Row>
          <TextField label={t("listingForm.availableFrom")} placeholder="YYYY-MM-DD" value={s.rent.available_from} onChangeText={(v) => setRent({ available_from: v })} error={errors["rent_terms.available_from"]} optional optionalLabel={t("common.optional")} />
          <ChipGroup label={t("listingForm.furnished")} value={s.rent.furnished} onChange={(v) => v !== undefined && setRent({ furnished: v })} options={yesNo} />
          <ChipGroup label={t("listingForm.utilities")} value={s.rent.utilities_included} onChange={(v) => v !== undefined && setRent({ utilities_included: v })} options={yesNo} />
          <FeesEditor fees={s.rent.fees} onChange={(f) => setRent({ fees: f })} errors={errors} path="rent_terms.fees" allowSplit />
        </Section>
      ) : null}

      {Object.keys(local).length ? <Notice tone="danger">{t("errors.validation_failed")}</Notice> : null}
      {error ? <Notice tone="danger" testID="lf-error">{error}</Notice> : null}
      <Button title={submitLabel} onPress={submit} loading={busy} size="lg" fullWidth testID="lf-submit" />
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
