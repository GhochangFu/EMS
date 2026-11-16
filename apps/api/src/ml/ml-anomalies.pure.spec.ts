import { ANOMALY_LIST_MAX_ROWS, anomalyListRowSchema, anomalyScoreSchema } from "@bms/shared";
import { expect } from "vitest";

import {
  anomalyListSinceOf,
  anomalyWindowOf,
  toAnomalyList,
  toAnomalyListRow,
  toAnomalyScore,
  type AnomalyListDbRow,
} from "./ml-anomalies.pure";
import { HOUR_MS } from "./ml-forecasts.pure";

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-e — the anomaly read's pure step (plan T2.7).
 * Assertions live here; `ml-anomalies.pure.test.ts` is the vitest entry point
 * (ADR 0014). Fixtures are synthetic.
 */
const DAY_MS = 24 * HOUR_MS;
const H = Date.parse("2026-11-16T10:00:00.000Z");
const NOW = new Date(H + 25 * 60_000);
const ASSET = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";

const dbRow = (bucketMs: number, overrides: Partial<AnomalyListDbRow> = {}): AnomalyListDbRow => ({
  bucket_ms: bucketMs,
  detector: "baseline_mad",
  score: 0.995,
  contributing_points: ["kw"],
  asset_id: ASSET,
  asset_code: "DEMO-M1",
  asset_name: "Demo meter 1",
  asset_rtu_name: null,
  location_id: LOCATION,
  location_name: "Demo site",
  location_time_zone: "Pacific/Chatham",
  organization_time_zone: "Asia/Kolkata",
  ...overrides,
});

export function theWindowStartsAtFromsUtcHourAndEndsAtTo(): void {
  const window = anomalyWindowOf({ from: new Date(H - 2 * HOUR_MS + 59 * 60_000), to: new Date(H + 30 * 60_000) });
  expect(window).toEqual({ fromHourMs: H - 2 * HOUR_MS, endMs: H + 30 * 60_000 });
  // An offset instant floors on the UTC hour, not the local one (+05:30 is half an hour off).
  expect(anomalyWindowOf({ from: new Date("2026-11-16T15:45:00+05:30"), to: new Date(H + DAY_MS) }).fromHourMs).toBe(H);
  // Not clipped to the current hour: a future `to` stays.
  expect(anomalyWindowOf({ from: new Date(H), to: new Date(H + 10 * DAY_MS) }).endMs).toBe(H + 10 * DAY_MS);
}

export function theSinceIsClampedToSevenDaysAndFloored(): void {
  const sevenDaysAgo = H - 7 * DAY_MS; // NOW − 7 d is H − 7 d + 25 min, floored to H − 7 d
  // Absent: 7 days.
  expect(anomalyListSinceOf(undefined, NOW)).toEqual({ sinceMs: sevenDaysAgo, empty: false });
  // Older than 7 days: clamped, not refused.
  expect(anomalyListSinceOf(new Date(H - 30 * DAY_MS), NOW)).toEqual({ sinceMs: sevenDaysAgo, empty: false });
  // Inside the 7 days: taken, floored to its hour.
  expect(anomalyListSinceOf(new Date(H - 3 * HOUR_MS + 59 * 60_000), NOW)).toEqual({ sinceMs: H - 3 * HOUR_MS, empty: false });
  // The current hour: not empty.
  expect(anomalyListSinceOf(new Date(H + 20 * 60_000), NOW)).toEqual({ sinceMs: H, empty: false });
  // A future hour: an empty window.
  expect(anomalyListSinceOf(new Date(H + 2 * HOUR_MS), NOW)).toEqual({ sinceMs: H + 2 * HOUR_MS, empty: true });
}

export function truncatedIsOneRowMoreThanTheCap(): void {
  const rows = (n: number): AnomalyListDbRow[] => Array.from({ length: n }, (_, i) => dbRow(H - i * HOUR_MS));
  expect(ANOMALY_LIST_MAX_ROWS).toBe(500);
  const exact = toAnomalyList(rows(ANOMALY_LIST_MAX_ROWS));
  expect(exact.truncated).toBe(false);
  expect(exact.items).toHaveLength(ANOMALY_LIST_MAX_ROWS);
  const over = toAnomalyList(rows(ANOMALY_LIST_MAX_ROWS + 1));
  expect(over.truncated).toBe(true);
  expect(over.items).toHaveLength(ANOMALY_LIST_MAX_ROWS);
  // The newest 500 go out, in the read's order: the extra row is the oldest.
  expect(over.items.at(-1)?.t).toBe(new Date(H - (ANOMALY_LIST_MAX_ROWS - 1) * HOUR_MS).toISOString());
  expect(toAnomalyList([])).toEqual({ truncated: false, items: [] });
}

export function theDtosHaveExactlyTheContractsKeys(): void {
  const row = toAnomalyListRow(dbRow(H - HOUR_MS, { contributing_points: ["kw", "pf"] }));
  expect(row).toEqual({
    assetId: ASSET,
    assetCode: "DEMO-M1",
    assetName: "Demo meter 1",
    assetRtuName: null,
    locationId: LOCATION,
    assetLocationName: "Demo site",
    timeZone: "Pacific/Chatham",
    t: new Date(H - HOUR_MS).toISOString(),
    detector: "baseline_mad",
    score: 0.995,
    contributingPoints: ["kw", "pf"],
  });
  expect(Object.keys(row).sort()).toEqual(Object.keys(anomalyListRowSchema.shape).sort());
  anomalyListRowSchema.parse(row);
  // The zone chain: the organization's when the site has none, else UTC.
  expect(toAnomalyListRow(dbRow(H, { location_time_zone: null })).timeZone).toBe("Asia/Kolkata");
  expect(toAnomalyListRow(dbRow(H, { location_time_zone: null, organization_time_zone: null })).timeZone).toBe("UTC");

  const score = toAnomalyScore({ bucket_ms: H, detector: "isolation_forest", score: 0.4, contributing_points: [] });
  expect(score).toEqual({ t: new Date(H).toISOString(), detector: "isolation_forest", score: 0.4, contributingPoints: [] });
  expect(Object.keys(score).sort()).toEqual(Object.keys(anomalyScoreSchema.shape).sort());
}
