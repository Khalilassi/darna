import React from "react";
import { render, screen, within } from "@testing-library/react-native";
import type { Schemas } from "@darna/api-client";
import { CashComparisonResult } from "../features/CashComparison";

const base: Schemas["CashComparison"] = {
  annual_discount_rate: "0.2",
  initial_cash: "7599000.00",
  future_nominal: "5136000.00",
  future_present_value: "3559382.14",
  nominal_total: "12735000.00",
  present_value_total: "11158382.14",
  break_even_cash_price: "11158382.14",
  other_known_costs: "0.00",
  cash_alternative: null,
  cash_alternative_all_in: null,
  cheaper_option: null,
  present_value_difference: null,
  excludes_estimates_and_unknowns: true,
  assumption: "Future installments are discounted at 20.00% per year (a rate you chose). Known amounts only.",
};

describe("CashComparisonResult", () => {
  it("shows break-even, nominal vs present value and the server assumption verbatim", async () => {
    await render(<CashComparisonResult data={base} />);
    expect(screen.getByTestId("cmp-break-even")).toHaveTextContent(/EGP\s?11,158,382/);
    expect(screen.getByText(/at 20% a year/)).toBeTruthy();
    expect(screen.getByText(/EGP\s?12,735,000/)).toBeTruthy();
    expect(screen.getByTestId("cmp-pv-total")).toHaveTextContent(/EGP\s?11,158,382/);
    expect(within(screen.getByTestId("cmp-assumption")).getByText(base.assumption)).toBeTruthy();
    expect(screen.getByTestId("cmp-excludes")).toHaveTextContent(/estimates and unconfirmed fees are not included/);
    expect(screen.queryByTestId(/cmp-cheaper-/)).toBeNull();
  });

  it("says cash is cheaper with the present-value saving", async () => {
    await render(
      <CashComparisonResult data={{ ...base, cash_alternative: "5000000.00", cheaper_option: "cash", present_value_difference: "-6158382.14", excludes_estimates_and_unknowns: false }} />,
    );
    const v = screen.getByTestId("cmp-cheaper-cash");
    expect(v).toHaveTextContent(/Cash is cheaper/);
    expect(v).toHaveTextContent(/Your cash price: EGP\s?5,000,000\./);
    expect(v).toHaveTextContent(/saves about EGP\s?6,158,382/);
    expect(screen.queryByTestId("cmp-excludes")).toBeNull();
  });

  it("says installments are cheaper when the cash price is above break-even", async () => {
    await render(
      <CashComparisonResult data={{ ...base, cash_alternative: "12000000", cheaper_option: "installments", present_value_difference: "841617.86" }} />,
    );
    expect(screen.getByTestId("cmp-cheaper-installments")).toHaveTextContent(/costs about EGP\s?841,618 less/);
  });

  it("adds maintenance and fees to the cash offer when the buyer pays them in both options", async () => {
    await render(
      <CashComparisonResult
        data={{ ...base, other_known_costs: "859000.00", break_even_cash_price: "10299382.14", cash_alternative: "10000000.00",
                cash_alternative_all_in: "10859000.00", cheaper_option: "cash", present_value_difference: "-299382.14" }}
      />,
    );
    expect(screen.getByTestId("cmp-other-costs")).toHaveTextContent(/EGP\s?859,000/);
    expect(screen.getByTestId("cmp-cheaper-cash")).toHaveTextContent(/EGP\s?10,859,000/);
  });
});
