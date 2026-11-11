import type { Schemas } from "@darna/api-client";

type DayStats = Schemas["DayStats"];
export type Metric = "views" | "saves" | "inquiries" | "viewing_requests" | "offers";
export const METRICS: Metric[] = ["views", "saves", "inquiries", "viewing_requests", "offers"];
export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export interface Bucket {
  /** First day (YYYY-MM-DD) in the bucket. */
  start: string;
  /** Last day (YYYY-MM-DD) in the bucket. */
  end: string;
  views: number;
  saves: number;
  inquiries: number;
  viewing_requests: number;
  offers: number;
}

const toBucket = (days: DayStats[]): Bucket => {
  const b: Bucket = { start: days[0].day, end: days[days.length - 1].day, views: 0, saves: 0, inquiries: 0, viewing_requests: 0, offers: 0 };
  for (const d of days) for (const m of METRICS) b[m] += d[m];
  return b;
};

/**
 * Groups a daily series (oldest first) into 7-day buckets. Weeks are anchored on the most recent day so
 * the latest bucket is always a full week; only the oldest bucket may be shorter. Totals are preserved.
 */
export function aggregateWeekly(series: DayStats[]): Bucket[] {
  const out: Bucket[] = [];
  for (let end = series.length; end > 0; end -= 7) out.unshift(toBucket(series.slice(Math.max(0, end - 7), end)));
  return out;
}

/** Bars for the chart: one per day up to 31 days, weekly buckets beyond that. */
export function chartBuckets(series: DayStats[]): { weekly: boolean; buckets: Bucket[] } {
  if (series.length > 31) return { weekly: true, buckets: aggregateWeekly(series) };
  return { weekly: false, buckets: series.map((d) => toBucket([d])) };
}

export const hasActivity = (totals: Pick<DayStats, Metric>) => METRICS.some((m) => totals[m] > 0);

export type InsightKey = "lowSaves" | "noOffers" | "savesNoInquiries" | "fewViews" | "hasOffers" | "steady";

/**
 * A one-line, suggestion-only hint from the period totals (first matching rule wins).
 * Returns null when there is no activity at all (the screen shows its empty state instead).
 * These are heuristics, not causes: copy must phrase them as things to consider.
 */
export function performanceInsight(totals: Pick<DayStats, Metric>): InsightKey | null {
  const { views, saves, inquiries, offers } = totals;
  if (!hasActivity(totals)) return null;
  if (views >= 50 && saves / views < 0.02) return "lowSaves";
  if (inquiries > 0 && offers === 0) return "noOffers";
  if (saves >= 5 && inquiries === 0) return "savesNoInquiries";
  if (views < 10 && offers === 0) return "fewViews";
  if (offers > 0) return "hasOffers";
  return "steady";
}
