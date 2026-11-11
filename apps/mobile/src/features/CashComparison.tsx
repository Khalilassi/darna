import React, { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@darna/api-client";
import { errorMessage } from "../api/errors";
import { useCashComparison } from "../api/queries";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ChipGroup } from "../components/Choice";
import { Divider, KeyValue, Row } from "../components/Layout";
import { Notice } from "../components/Notice";
import { T } from "../components/T";
import { TextField } from "../components/TextField";
import { formatMoney, formatPercent, parseAmountInput, toNumber } from "../i18n/format";
import { useLanguage } from "../i18n/LanguageProvider";

type Comparison = Schemas["CashComparison"];

export const RATE_PRESETS = [10, 15, 20, 25] as const;

/** Result of `GET /listings/{id}/financials/compare`. The server's `assumption` is shown verbatim. */
export function CashComparisonResult({ data }: { data: Comparison }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const rate = formatPercent(data.annual_discount_rate, lang, 2);
  const diff = toNumber(data.present_value_difference);
  const verdict =
    data.cheaper_option === "cash"
      ? { tone: "success" as const, text: t("cashCmp.cashCheaper", { amount: formatMoney(Math.abs(diff ?? 0), lang) }) }
      : data.cheaper_option === "installments"
        ? { tone: "info" as const, text: t("cashCmp.installmentsCheaper", { amount: formatMoney(Math.abs(diff ?? 0), lang) }) }
        : data.cheaper_option === "equal"
          ? { tone: "neutral" as const, text: t("cashCmp.equal") }
          : null;
  return (
    <View style={{ gap: 10 }} testID="cmp-result">
      <View style={{ gap: 2 }}>
        <T variant="caption" tone="muted">{t("cashCmp.breakEven")}</T>
        <T variant="title" testID="cmp-break-even">{formatMoney(data.break_even_cash_price, lang)}</T>
        <T variant="caption" tone="muted">{t("cashCmp.breakEvenHelp", { rate })}</T>
        {(toNumber(data.other_known_costs) ?? 0) > 0 ? (
          <T variant="caption" tone="muted" testID="cmp-other-costs">
            {t("cashCmp.otherCostsHelp", { amount: formatMoney(data.other_known_costs, lang) })}
          </T>
        ) : null}
      </View>
      {verdict ? (
        <Notice tone={verdict.tone} title={t(`cashCmp.cheaper.${data.cheaper_option}`)} testID={`cmp-cheaper-${data.cheaper_option}`}>
          {`${
            (toNumber(data.other_known_costs) ?? 0) > 0
              ? t("cashCmp.yourCashAllIn", {
                  amount: formatMoney(data.cash_alternative, lang),
                  other: formatMoney(data.other_known_costs, lang),
                  allIn: formatMoney(data.cash_alternative_all_in, lang),
                })
              : t("cashCmp.yourCash", { amount: formatMoney(data.cash_alternative, lang) })
          } ${verdict.text}`}
        </Notice>
      ) : null}
      <Divider />
      <KeyValue label={t("cashCmp.initialCash")} value={formatMoney(data.initial_cash, lang)} />
      <KeyValue label={t("cashCmp.futureNominal")} value={formatMoney(data.future_nominal, lang)} />
      <KeyValue label={t("cashCmp.futurePv", { rate })} value={formatMoney(data.future_present_value, lang)} tone="muted" />
      <Divider />
      <KeyValue label={t("cashCmp.nominalTotal")} value={formatMoney(data.nominal_total, lang)} />
      <KeyValue label={t("cashCmp.pvTotal")} help={t("cashCmp.pvTotalHelp")} value={<T variant="bodyStrong" testID="cmp-pv-total">{formatMoney(data.present_value_total, lang)}</T>} strong />
      {data.excludes_estimates_and_unknowns ? (
        <Notice tone="warning" testID="cmp-excludes">{t("cashCmp.excludes")}</Notice>
      ) : null}
      <Notice tone="neutral" title={t("cashCmp.assumption")} testID="cmp-assumption">{data.assumption}</Notice>
    </View>
  );
}

/** "Cash or installments?" tool for installment sale listings. */
export function CashComparisonTool({ listingId }: { listingId: string }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const [preset, setPreset] = useState<number | "custom" | undefined>(undefined);
  const [customRate, setCustomRate] = useState("");
  const [cashText, setCashText] = useState("");
  const [params, setParams] = useState<{ rate: number; cash: number | null } | null>(null);
  const [errors, setErrors] = useState<{ rate?: string; cash?: string }>({});
  const q = useCashComparison(listingId, params?.rate ?? null, params?.cash ?? null, lang);

  const parseCash = (): number | null | "invalid" => {
    if (!cashText.trim()) return null;
    const n = parseAmountInput(cashText);
    return n === null || n <= 0 ? "invalid" : n;
  };
  const run = (p: number | "custom" | undefined = preset) => {
    const next: typeof errors = {};
    let rate: number | null = null;
    if (p === "custom") {
      const n = parseAmountInput(customRate);
      if (n === null || n < 0 || n > 100) next.rate = t("cashCmp.rateError");
      else rate = n / 100;
    } else if (p === undefined) next.rate = t("cashCmp.pickRate");
    else rate = p / 100;
    const cash = parseCash();
    if (cash === "invalid") next.cash = t("cashCmp.cashError");
    setErrors(next);
    if (rate === null || cash === "invalid") return;
    setParams({ rate, cash });
  };

  const options = [
    ...RATE_PRESETS.map((r) => ({ value: r as number | "custom", label: formatPercent(r / 100, lang) })),
    { value: "custom" as const, label: t("cashCmp.custom") },
  ];

  return (
    <Card testID="cash-vs-installments">
      <T variant="heading" accessibilityRole="header">{t("cashCmp.title")}</T>
      <T variant="caption" tone="muted">{t("cashCmp.body")}</T>
      <ChipGroup
        label={t("cashCmp.rate")}
        value={preset}
        onChange={(v) => {
          setPreset(v);
          if (v !== undefined && v !== "custom") run(v);
        }}
        options={options}
        error={preset !== "custom" ? errors.rate : undefined}
      />
      <T variant="caption" tone="muted">{t("cashCmp.rateHelp")}</T>
      {preset === "custom" ? (
        <TextField label={t("cashCmp.customRate")} value={customRate} onChangeText={setCustomRate} keyboardType="decimal-pad" suffix="%" error={errors.rate} testID="cmp-custom-rate" />
      ) : null}
      <TextField
        label={t("cashCmp.cashPrice")}
        optional
        optionalLabel={t("common.optional")}
        hint={t("cashCmp.cashPriceHelp")}
        value={cashText}
        onChangeText={setCashText}
        keyboardType="numeric"
        suffix={t("cashCmp.egp")}
        error={errors.cash}
        testID="cmp-cash"
      />
      <Row>
        <Button title={t("cashCmp.calculate")} onPress={() => run()} loading={q.isFetching} variant="secondary" icon="calculator-outline" testID="cmp-calc" />
      </Row>
      {q.isError ? <Notice tone="danger" testID="cmp-error">{errorMessage(q.error, t)}</Notice> : null}
      {q.data && !q.isError ? <CashComparisonResult data={q.data} /> : null}
    </Card>
  );
}
