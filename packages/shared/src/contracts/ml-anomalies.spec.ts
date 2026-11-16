import { expect } from "vitest";

import {
  ANOMALY_DETECTORS,
  ANOMALY_LIST_MAX_DAYS,
  ANOMALY_LIST_MAX_ROWS,
  ANOMALY_MAX_SPAN_DAYS,
  ANOMALY_MODEL_NAME,
  ANOMALY_UNUSUAL_SCORE,
  anomalyListResponseSchema,
  anomalyListRowSchema,
  anomalyScoreSchema,
  assetAnomaliesResponseSchema,
} from "./ml-anomalies";

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-e — the anomaly read contracts. Assertions
 * live here; `ml-anomalies.test.ts` is the vitest entry point (ADR 0014). Plan
 * `docs/plans/e1.2-anomaly-detection.md` §7, T2.5. Fixtures are synthetic.
 */
const ASSET = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const HOUR = "2026-11-16T10:00:00.000Z";

const score = { t: HOUR, detector: "baseline_mad", score: 0.995, contributingPoints: ["kw", "pf"] };

const row = {
  assetId: ASSET,
  assetCode: "DEMO-M1",
  assetName: "Demo meter 1",
  assetRtuName: null,
  locationId: LOCATION,
  assetLocationName: "Demo site",
  timeZone: "Asia/Kolkata",
  ...score,
};

export function runConstantsTest(): void {
  expect(ANOMALY_UNUSUAL_SCORE).toBe(0.99);
  expect(ANOMALY_MAX_SPAN_DAYS).toBe(31);
  expect(ANOMALY_LIST_MAX_DAYS).toBe(7);
  expect(ANOMALY_LIST_MAX_ROWS).toBe(500);
  expect(ANOMALY_MODEL_NAME).toBe("bms-anomaly");
  expect([...ANOMALY_DETECTORS]).toEqual(["baseline_mad", "isolation_forest"]);
}

export function runScoreBoundsTest(): void {
  expect(anomalyScoreSchema.safeParse(score).success).toBe(true);
  for (const value of [0, 1, ANOMALY_UNUSUAL_SCORE]) {
    expect(anomalyScoreSchema.safeParse({ ...score, score: value }).success, String(value)).toBe(true);
  }
  for (const value of [1.01, -0.01, Number.NaN]) {
    expect(anomalyScoreSchema.safeParse({ ...score, score: value }).success, String(value)).toBe(false);
  }
}

export function runUnknownDetectorTest(): void {
  // A bounded string, not an enum: an older bundle still parses a later detector.
  expect(anomalyScoreSchema.parse({ ...score, detector: "seasonal_esd" }).detector).toBe("seasonal_esd");
  expect(anomalyScoreSchema.safeParse({ ...score, detector: "d".repeat(65) }).success).toBe(false);
}

export function runPointKeyBoundTest(): void {
  expect(anomalyScoreSchema.safeParse({ ...score, contributingPoints: ["k".repeat(128)] }).success).toBe(true);
  expect(anomalyScoreSchema.safeParse({ ...score, contributingPoints: ["k".repeat(129)] }).success).toBe(false);
  expect(anomalyScoreSchema.safeParse({ ...score, contributingPoints: [] }).success).toBe(true);
}

export function runNotStrictTest(): void {
  // Responses: an unknown extra key parses (an API newer than its web).
  expect(anomalyScoreSchema.safeParse({ ...score, extra: 1 }).success).toBe(true);
  expect(assetAnomaliesResponseSchema.safeParse({ asOf: HOUR, scores: [score], extra: 1 }).success).toBe(true);
  expect(anomalyListRowSchema.safeParse({ ...row, extra: 1 }).success).toBe(true);
  expect(
    anomalyListResponseSchema.safeParse({ asOf: HOUR, since: HOUR, truncated: false, items: [row], extra: 1 }).success,
  ).toBe(true);
}

export function runNoRunFieldsTest(): void {
  // S3 / R11: no model name, version or run bookkeeping has a field on the wire.
  const forbidden = ["modelName", "modelVersion", "errorText", "configHash", "rowsWritten", "issuedAt"];
  for (const shape of [anomalyScoreSchema.shape, anomalyListRowSchema.shape, anomalyListResponseSchema.shape]) {
    for (const key of forbidden) {
      expect(Object.keys(shape), key).not.toContain(key);
    }
  }
  expect(Object.keys(anomalyListRowSchema.shape).sort()).toEqual(
    [
      "assetId",
      "assetCode",
      "assetName",
      "assetRtuName",
      "locationId",
      "assetLocationName",
      "timeZone",
      "t",
      "detector",
      "score",
      "contributingPoints",
    ].sort(),
  );
  // Every row field is required: a row without its RTU name (even null) is refused.
  const { assetRtuName: _rtu, ...withoutRtu } = row;
  expect(anomalyListRowSchema.safeParse(withoutRtu).success).toBe(false);
}
