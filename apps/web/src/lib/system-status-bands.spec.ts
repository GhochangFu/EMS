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
    devices: { monitored: 0, offline: 0 },
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
  const line = titleLine(body(["ok", "not_configured", "not_monitored"]));
  assert(
    line === "Job queue: ok · Object storage: not configured · Field data: not monitored",
    `expected the middle-dot-joined title with underscore turned to space, got ${JSON.stringify(line)}`,
  );
}

/**
 * `F3.16` / ADR 0127 decision 21 — `field_data` follows the ingest host's
 * heartbeat, so its title line says what a degraded state now means and what
 * an ok one is measured against.
 */
export function titleLineNamesTheIngestHeartbeatForFieldData(): void {
  const degraded = titleLine(body(["ok", "ok", "degraded"]));
  assert(
    degraded === "Job queue: ok · Object storage: ok · Field data: degraded (ingest host not reporting)",
    `expected a degraded field_data to name the silent ingest host, got ${JSON.stringify(degraded)}`,
  );
  const ok = titleLine(body(["ok", "ok", "ok"]));
  assert(
    ok === "Job queue: ok · Object storage: ok · Field data: ok (ingest heartbeat fresh)",
    `expected an ok field_data to name the fresh heartbeat, got ${JSON.stringify(ok)}`,
  );
}
