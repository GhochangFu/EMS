import type { SystemStatusResponse } from "@bms/shared";

import { dataQualityBand, summaryLine, titleLine } from "./system-status-bands";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F3.30` (ADR 0075 decision 5). One claim per exported function, one `it()`
 * each in the wrapper — the shape `alarm-severity.spec.ts` uses.
 */

function body(
  states: readonly [string, string, string],
): SystemStatusResponse {
  const keys = ["queue", "storage", "field_data"] as const;
  const components = keys.map((key, i) => ({ key, state: states[i] })) as SystemStatusResponse["components"];
  return {
    status: states.includes("degraded") ? "degraded" : "operational",
    components,
    dataQuality: { percent: 100, freshAssets: 1, streamingAssets: 1, windowSeconds: 25 },
    checkedAt: "2026-09-25T00:00:00.000Z",
  };
}

export function dataQualityBandGoodAtThreshold(): void {
  assert(dataQualityBand(95) === "good", "95 is the Good threshold and must band Good");
}

export function dataQualityBandFairJustBelowGood(): void {
  assert(dataQualityBand(94.9) === "fair", "94.9 is below the Good threshold and must band Fair");
}

export function dataQualityBandFairAtThreshold(): void {
  assert(dataQualityBand(80) === "fair", "80 is the Fair threshold and must band Fair");
}

export function dataQualityBandPoorJustBelowFair(): void {
  assert(dataQualityBand(79.9) === "poor", "79.9 is below the Fair threshold and must band Poor");
}

export function dataQualityBandNullForNull(): void {
  assert(dataQualityBand(null) === null, "null has nothing to band and must stay null");
}

export function dataQualityBandNullForNaN(): void {
  assert(
    dataQualityBand(Number.NaN) === null,
    "a NaN percent must fail closed to null, not fall through to the Poor default",
  );
}

export function summaryLineAllOperational(): void {
  const line = summaryLine(body(["ok", "ok", "ok"]));
  assert(line === "All systems operational", `expected the all-ok summary, got ${JSON.stringify(line)}`);
}

export function summaryLineListsDegradedLabelsInOrder(): void {
  const line = summaryLine(body(["degraded", "ok", "degraded"]));
  assert(
    line === "Degraded: Job queue, Field data",
    `expected the degraded components listed in component order, got ${JSON.stringify(line)}`,
  );
}

export function titleLineJoinsLabelAndStateWithSpacedUnderscore(): void {
  const line = titleLine(body(["ok", "not_configured", "degraded"]));
  assert(
    line === "Job queue: ok · Object storage: not configured · Field data: degraded",
    `expected the middle-dot-joined title with underscore turned to space, got ${JSON.stringify(line)}`,
  );
}
