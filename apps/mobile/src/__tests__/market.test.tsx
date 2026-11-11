import React from "react";
import { render, screen, within } from "@testing-library/react-native";
import type { Schemas } from "@darna/api-client";
import { MarketSummaryView } from "../features/MarketSummaryView";
import { PriceHistoryView } from "../features/PriceHistory";
import { barFractions, figureView, priceSteps, splitDistricts } from "../lib/market";
import { initI18n } from "../i18n";

const district = (name: string, sale: [number, string | null], rent: [number, string | null] = [0, null]): Schemas["DistrictSummary"] => ({
  district_id: `id-${name}`,
  district_name_en: name,
  district_name_ar: `حي ${name}`,
  active_listings: sale[0] + rent[0],
  sale: { sample_size: sale[0], median_per_sqm: sale[1] },
  rent: { sample_size: rent[0], median_per_sqm: rent[1] },
});

const summary: Schemas["MarketSummary"] = {
  project_id: "p1",
  purpose: "sale",
  property_types: [],
  districts: [district("B2", [1, null]), district("B1", [6, "50701"]), district("B10", [0, null]), district("B6", [2, null])],
  trend: [
    { month: "2026-09", sample_size: 2, median_per_sqm: null },
    { month: "2026-10", sample_size: 12, median_per_sqm: "57044" },
  ],
  min_sample: 3,
  methodology: "Based on asking prices of listings published on Darna.",
  generated_at: "2026-11-11T14:20:25Z",
};

describe("market helpers", () => {
  it("treats a null median as hidden, never as zero", () => {
    expect(figureView({ sample_size: 2, median_per_sqm: null })).toEqual({ kind: "hidden", sample: 2 });
    expect(figureView({ sample_size: 6, median_per_sqm: "50701" })).toEqual({ kind: "value", median: 50701, sample: 6 });
    expect(barFractions([null, 50, 100])).toEqual([null, 0.5, 1]);
  });
  it("orders districts with figures first and separates districts without listings", () => {
    const { withData, empty } = splitDistricts(summary.districts, "sale");
    expect(withData.map((d) => d.district_name_en)).toEqual(["B1", "B2", "B6"]);
    expect(empty.map((d) => d.district_name_en)).toEqual(["B10"]);
  });
  it("computes asking-price steps with % change", () => {
    const steps = priceSteps(
      [
        { kind: "price_changed", sale_cash_price: "6400000", sale_known_total: null, monthly_rent: null, created_at: "2026-11-01T00:00:00Z" },
        { kind: "listed", sale_cash_price: "6740000", sale_known_total: null, monthly_rent: null, created_at: "2026-10-01T00:00:00Z" },
      ],
      "sale_cash_price",
    );
    expect(steps.map((s) => s.price)).toEqual([6740000, 6400000]);
    expect(steps[0].change).toBeNull();
    expect(steps[1].change).toBeCloseTo(-0.0504, 3);
  });
});

describe("MarketSummaryView", () => {
  afterAll(() => initI18n("en"));

  it("shows medians and an explicit 'not enough listings' state for null medians", async () => {
    await render(<MarketSummaryView data={summary} />);
    expect(screen.getByTestId("median-B1")).toHaveTextContent(/EGP\s?50,701/);
    for (const name of ["B2", "B6"]) {
      const row = screen.getByTestId(`district-${name}`);
      expect(within(row).getByTestId(`hidden-${name}`)).toHaveTextContent("Not enough listings to show (min 3)");
      expect(within(row).queryByText(/EGP/)).toBeNull();
      expect(within(row).queryByText(/\b0\b/)).toBeNull();
    }
    expect(screen.getByText("Based on 6 listings")).toBeTruthy();
    expect(screen.getByText("1 district with no listings")).toBeTruthy();
    expect(screen.queryByTestId("district-B10")).toBeNull();
    expect(within(screen.getByTestId("market-methodology")).getByText(summary.methodology)).toBeTruthy();
    // Trend: the hidden month is a gap with a label, not a zero bar.
    expect(screen.getByTestId("trend-2026-09")).toHaveTextContent(/^—Sep/);
    expect(screen.getByLabelText(/Not enough listings to show/)).toBeTruthy();
  });

  it("pins and labels the listing's district", async () => {
    await render(<MarketSummaryView data={summary} highlightDistrict="B6" />);
    expect(within(screen.getByTestId("district-B6")).getByText("This home")).toBeTruthy();
  });

  it("renders Arabic-Indic digits and Arabic names in Arabic", async () => {
    initI18n("ar");
    await render(<MarketSummaryView data={summary} />);
    expect(screen.getByTestId("median-B1")).toHaveTextContent(/٥٠٬?٧٠١/);
    expect(screen.getByTestId("hidden-B2")).toHaveTextContent("لا توجد إعلانات كافية للعرض (الحد الأدنى ٣)");
    expect(screen.getByText("حي B1")).toBeTruthy();
  });
});

describe("PriceHistoryView", () => {
  it("states the listing price when it never changed", async () => {
    await render(
      <PriceHistoryView
        purpose="sale"
        points={[{ kind: "listed", sale_cash_price: "6740000.00", sale_known_total: "12735000.00", monthly_rent: null, created_at: "2026-10-28T14:18:57Z" }]}
      />,
    );
    expect(screen.getByTestId("price-history-single")).toHaveTextContent(/Listed at EGP\s?6,740,000 on Oct 28, 2026/);
  });
  it("shows each change with its percentage", async () => {
    await render(
      <PriceHistoryView
        purpose="rent"
        points={[
          { kind: "listed", sale_cash_price: null, sale_known_total: null, monthly_rent: "20000", created_at: "2026-09-01T10:00:00Z" },
          { kind: "price_changed", sale_cash_price: null, sale_known_total: null, monthly_rent: "18000", created_at: "2026-10-01T10:00:00Z" },
        ]}
      />,
    );
    expect(screen.getByTestId("price-history")).toBeTruthy();
    expect(screen.getByText("−10%")).toBeTruthy();
    expect(screen.getByText(/down 10% from EGP\s?20,000/)).toBeTruthy();
  });
});
