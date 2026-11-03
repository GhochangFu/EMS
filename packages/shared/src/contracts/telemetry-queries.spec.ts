import { expect } from "vitest";
import type { z } from "zod";

import { MAX_WIDGET_WINDOW_MINUTES } from "./dashboard-builder";
import {
  assetHistoryExportQuerySchema,
  parsePointsList,
  pointAggregateQuerySchema,
} from "./telemetry-queries";

/**
 * `F4.303` U2 (ADR 0108 Amendment 6 item 3) — the aggregate read's range rules,
 * pinned so the shared function did not change them, and the history export query
 * that runs the same function. Vitest entry point: the sibling `.test.ts`.
 */

const FROM = "2026-10-01T00:00:00.000Z";
const TO = "2026-10-02T00:00:00.000Z";

function issues(schema: z.ZodTypeAny, input: unknown): { path: string; message: string }[] {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

const AGGREGATE_FAULTS: readonly (readonly [string, Record<string, string>, string, string])[] = [
  ["from without to", { from: FROM }, "", "from and to must be given together"],
  [
    "from and to with windowMinutes",
    { from: FROM, to: TO, windowMinutes: "60" },
    "",
    "from/to and windowMinutes are exclusive; give one or the other",
  ],
  ["to not after from", { from: TO, to: FROM }, "to", "to must be after from"],
  [
    "a span over the maximum",
    { from: "2024-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" },
    "to",
    `the from/to span must not exceed ${MAX_WIDGET_WINDOW_MINUTES} minutes`,
  ],
  [
    "an instant past now plus one day",
    { from: FROM, to: "2999-01-01T00:00:00.000Z" },
    "to",
    "to must lie between 1970-01-01T00:00:00Z and one day after now",
  ],
];

/** Q1 — one claim per fault: `pointAggregateQuerySchema` keeps its message and path. */
export function aggregateFaultKeepsItsMessage(index: number): void {
  const [, input, path, message] = AGGREGATE_FAULTS[index];
  expect(issues(pointAggregateQuerySchema, input)).toEqual([{ path, message }]);
}

export const AGGREGATE_FAULT_NAMES = AGGREGATE_FAULTS.map(([name]) => name);

/** Q2 — a trailing window. */
export function theExportAdmitsATrailingWindow(): void {
  const parsed = assetHistoryExportQuerySchema.safeParse({ points: "kw,pf", windowMinutes: "1440" });
  expect(parsed.success).toBe(true);
}

/** Q2 — a custom range with compare. */
export function theExportAdmitsACustomRangeWithCompare(): void {
  const parsed = assetHistoryExportQuerySchema.safeParse({ points: "kw", from: FROM, to: TO, compare: "true" });
  expect(parsed.success && parsed.data.compare).toBe(true);
}

/** Q2 — the default function. */
export function theExportBucketFunctionDefaultsToAvg(): void {
  const parsed = assetHistoryExportQuerySchema.safeParse({ points: "kw" });
  expect(parsed.success && parsed.data.bucketFunction).toBe("avg");
}

/** Q3 — points faults, each naming its path. */
export function theExportRefusesAPointsFault(points: string): void {
  const found = issues(assetHistoryExportQuerySchema, { points });
  expect(found.length).toBeGreaterThan(0);
  expect(found.every((issue) => issue.path === "points")).toBe(true);
}

/** Q3 — an unknown key. */
export function theExportRefusesAnUnknownKey(): void {
  expect(issues(assetHistoryExportQuerySchema, { points: "kw", bucketStats: "true" }).length).toBeGreaterThan(0);
}

/** Q3 — the five range faults of Q1, with the same message. */
export function theExportRefusesARangeFaultWithTheSameMessage(index: number): void {
  const [, input, path, message] = AGGREGATE_FAULTS[index];
  expect(issues(assetHistoryExportQuerySchema, { points: "kw", ...input })).toEqual([{ path, message }]);
}

/** Q4 */
export function parsePointsListTrimsAndSplits(): void {
  expect(parsePointsList("kw, pf")).toEqual(["kw", "pf"]);
}
