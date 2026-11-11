import React from "react";
import { render, screen, within } from "@testing-library/react-native";
import { PriceBreakdown } from "../components/PriceBreakdown";
import { rent, sale } from "./fixtures";

describe("PriceBreakdown", () => {
  it("shows headline totals and the installment schedule", async () => {
    await render(<PriceBreakdown sale={sale} />);
    expect(screen.getByTestId("initial-cash")).toHaveTextContent(/7,599,000/);
    expect(screen.getByText("Known total cost")).toBeTruthy();
    expect(screen.getByText(/12,735,000/)).toBeTruthy();
    expect(screen.getByText("4 payments · Unit")).toBeTruthy();
  });

  it("labels every line with its provenance", async () => {
    await render(<PriceBreakdown sale={sale} />);
    expect(within(screen.getByTestId("line-owner_cash_price")).getByTestId("provenance-verified")).toBeTruthy();
    expect(within(screen.getByTestId("line-future_installments")).getByTestId("provenance-seller_provided")).toBeTruthy();
    expect(within(screen.getByTestId("line-club_membership")).getByTestId("provenance-estimate")).toBeTruthy();
    expect(within(screen.getByTestId("line-transfer_fee")).getByTestId("provenance-unknown")).toBeTruthy();
  });

  it("renders unconfirmed items as 'Not yet confirmed' without an amount", async () => {
    await render(<PriceBreakdown sale={sale} />);
    const row = screen.getByTestId("line-transfer_fee");
    expect(within(row).getByTestId("not-confirmed")).toHaveTextContent("Not yet confirmed");
    expect(within(row).queryByText(/EGP/)).toBeNull();
    expect(within(row).getByText(/Not included in any total/)).toBeTruthy();
  });

  it("shows estimate assumptions and warnings as notices", async () => {
    await render(<PriceBreakdown sale={sale} />);
    expect(within(screen.getByTestId("line-club_membership")).getByTestId("assumption")).toHaveTextContent("Assumption: based on 2025 club rates");
    expect(screen.getByTestId("warning-unconfirmed_fees")).toBeTruthy();
    expect(screen.getByTestId("warning-contains_estimates")).toBeTruthy();
    expect(screen.getAllByText("Plus estimates").length).toBeGreaterThan(0);
  });

  it("renders rent move-in cash, deposit and minimum-term total", async () => {
    await render(<PriceBreakdown rent={rent} minLeaseMonths={12} />);
    expect(screen.getByTestId("move-in")).toHaveTextContent(/42,000/);
    expect(screen.getAllByText("Security deposit")).toHaveLength(2);
    expect(screen.getByText(/Rent over the minimum term · 12 months/)).toBeTruthy();
    expect(screen.getByText(/252,000/)).toBeTruthy();
  });
});
