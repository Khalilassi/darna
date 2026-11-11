import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { Schemas } from "@darna/api-client";
import { PerformanceView } from "../features/PerformanceView";
import { initI18n } from "../i18n";
import { aggregateWeekly, chartBuckets, METRICS, performanceInsight } from "../lib/performance";

const zero = { views: 0, saves: 0, inquiries: 0, viewing_requests: 0, offers: 0 };
const t = (o: Partial<typeof zero>) => ({ ...zero, ...o });

function series(n: number, f: (i: number) => Partial<typeof zero> = () => ({ views: 1 })): Schemas["DayStats"][] {
  const start = Date.UTC(2026, 7, 14);
  return Array.from({ length: n }, (_, i) => ({ ...t(f(i)), day: new Date(start + i * 86400_000).toISOString().slice(0, 10) }));
}

describe("performanceInsight", () => {
  it("returns null without any activity", () => {
    expect(performanceInsight(zero)).toBeNull();
  });
  it("flags many views with few saves (rate < 2%)", () => {
    expect(performanceInsight(t({ views: 50, saves: 0 }))).toBe("lowSaves");
    expect(performanceInsight(t({ views: 200, saves: 3 }))).toBe("lowSaves");
    expect(performanceInsight(t({ views: 49, saves: 0 }))).not.toBe("lowSaves");
    expect(performanceInsight(t({ views: 100, saves: 2 }))).not.toBe("lowSaves");
  });
  it("flags inquiries without offers", () => {
    expect(performanceInsight(t({ views: 30, saves: 3, inquiries: 2 }))).toBe("noOffers");
    expect(performanceInsight(t({ views: 30, saves: 3, inquiries: 2, offers: 1 }))).toBe("hasOffers");
  });
  it("flags saves without inquiries, few views, and falls back to steady", () => {
    expect(performanceInsight(t({ views: 40, saves: 6 }))).toBe("savesNoInquiries");
    expect(performanceInsight(t({ views: 3 }))).toBe("fewViews");
    expect(performanceInsight(t({ saves: 1 }))).toBe("fewViews");
    expect(performanceInsight(t({ views: 30, saves: 2 }))).toBe("steady");
  });
});

describe("weekly aggregation", () => {
  it("anchors weeks on the latest day and preserves totals", () => {
    const s = series(90, (i) => ({ views: i, saves: i % 3 === 0 ? 1 : 0, offers: i === 89 ? 2 : 0 }));
    const w = aggregateWeekly(s);
    expect(w).toHaveLength(13);
    expect(w[0]).toMatchObject({ start: s[0].day, end: s[5].day }); // 90 = 6 + 12*7
    expect(w[12]).toMatchObject({ start: s[83].day, end: s[89].day, offers: 2 });
    for (const m of METRICS) {
      expect(w.reduce((a, b) => a + b[m], 0)).toBe(s.reduce((a, d) => a + d[m], 0));
    }
  });
  it("keeps daily bars up to a month and weekly beyond", () => {
    expect(chartBuckets(series(30))).toMatchObject({ weekly: false });
    expect(chartBuckets(series(30)).buckets).toHaveLength(30);
    expect(chartBuckets(series(90))).toMatchObject({ weekly: true });
    expect(aggregateWeekly(series(7))).toHaveLength(1);
    expect(aggregateWeekly([])).toEqual([]);
  });
});

const perf = (over: Partial<Schemas["Performance"]> = {}): Schemas["Performance"] => {
  const s = series(7, (i) => (i === 6 ? { views: 4, saves: 1, inquiries: 3 } : {}));
  return {
    listing_id: "l1",
    days: 7,
    published_at: "2026-08-01T10:00:00Z",
    days_on_market: 22,
    total_views_all_time: 41,
    series: s,
    totals: { day: s[6].day, views: 4, saves: 1, inquiries: 3, viewing_requests: 0, offers: 0 },
    funnel: [
      { step: "views", count: 4, rate_from_previous: null },
      { step: "saves", count: 1, rate_from_previous: 0.25 },
      { step: "inquiries", count: 3, rate_from_previous: 3 },
      { step: "viewing_requests", count: 0, rate_from_previous: 0 },
      { step: "offers", count: 0, rate_from_previous: null },
    ],
    note: "",
    ...over,
  };
};

describe("PerformanceView", () => {
  afterAll(() => initI18n("en"));

  it("shows totals, uncapped step rates and — for a null rate", async () => {
    initI18n("en");
    await render(<PerformanceView data={perf()} />);
    expect(screen.getByTestId("perf-total-inquiries")).toHaveTextContent("3");
    expect(screen.getByTestId("perf-days-on-market")).toHaveTextContent("22");
    expect(screen.getByTestId("perf-step-saves-rate")).toHaveTextContent("25% of previous step");
    expect(screen.getByTestId("perf-step-inquiries-rate")).toHaveTextContent("300% of previous step");
    expect(screen.getByTestId("perf-step-offers-rate")).toHaveTextContent("—");
    expect(screen.getByTestId("perf-insight")).toHaveTextContent(/Inquiries but no offers yet/);
  });

  it("shows the empty state without activity, and Arabic-Indic digits in Arabic", async () => {
    initI18n("ar");
    const s = series(7, () => ({}));
    await render(<PerformanceView data={perf({ series: s, totals: { ...zero, day: s[6].day }, funnel: [] })} />);
    expect(screen.getByTestId("perf-empty")).toBeTruthy();
    expect(screen.getByTestId("perf-days-on-market")).toHaveTextContent("٢٢");
    expect(screen.queryByTestId("perf-chart")).toBeNull();
  });
});
