import { expect } from "vitest";

import {
  HEALTH_ANOMALY_BASELINE_ONLY_WEIGHT,
  HEALTH_ANOMALY_CAP,
  HEALTH_ANOMALY_WINDOW_DAYS,
  HEALTH_BAD_ACTORS_LIMIT,
  HEALTH_INPUTS,
  advisoryHealthScore,
  assetHealthInputsResponseSchema,
  healthAnomalyPenalty,
  healthBadActorsResponseSchema,
} from "./asset-health-inputs";
import { ANOMALY_LIST_MAX_DAYS } from "./ml-anomalies";

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan §4.2, §4.9, T1.1) — the health inputs
 * contract, the anomaly penalty and the advisory figure. Assertions live here;
 * `asset-health-inputs.test.ts` is the Vitest entry point (ADR 0014). Fixtures
 * are made up.
 */
const ASSET = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const AS_OF = "2026-11-17T10:30:00.000Z";

const inputs = HEALTH_INPUTS.map((input) => ({ ...input }));

const inputsResponse = {
  assetId: ASSET,
  asOf: AS_OF,
  inputs,
  anomalyHistory: { windowDays: 7, scoredHours: 168, unusualHours: 9, strongHours: 3, baselineOnlyHours: 5, penalty: 3 / 168 },
  maintenance: { openCorrective: 2, pastSla: 1 },
};

const label = {
  assetId: ASSET,
  assetCode: "MTR-01",
  assetName: "Fixture meter 1",
  assetRtuName: "RTU-H1",
  locationId: LOCATION,
  assetLocationName: "Hill Plant",
};

const badActor = {
  ...label,
  scoredHours: 168,
  unusualHours: 9,
  strongHours: 3,
  baselineOnlyHours: 5,
  weak: false,
  lastUnusualAt: AS_OF,
  topPoints: ["kw", "pf"],
  href: `/asset-history/${ASSET}`,
  ruleScore: 0.75,
  advisoryScore: 0.75 - 3 / 168,
};

const lowest = { ...label, score: 0.25, band: { code: "poor", label: "Poor", minScore: 0 }, scoredTagCount: 2 };

const badActorsResponse = {
  asOf: AS_OF,
  scoredAssetCount: 4,
  lowestScores: [lowest],
  anomaly: { windowDays: 7, unusualAssetCount: 1, losingAssetCount: 1, caveat: null, items: [badActor] },
};

const times = <T>(n: number, value: T): T[] => Array.from({ length: n }, () => value);

/** A full inputs response parses; the input list must be exactly five; an unknown status is refused. */
export function runInputsResponseTest(): void {
  expect(assetHealthInputsResponseSchema.safeParse(inputsResponse).success).toBe(true);
  expect(assetHealthInputsResponseSchema.safeParse({ ...inputsResponse, inputs: inputs.slice(0, 4) }).success).toBe(false);
  expect(
    assetHealthInputsResponseSchema.safeParse({ ...inputsResponse, inputs: [...inputs, inputs[0]] }).success,
  ).toBe(false);
  const absent = inputs.map((input, i) => (i === 3 ? { ...input, status: "absent" } : input));
  expect(assetHealthInputsResponseSchema.safeParse({ ...inputsResponse, inputs: absent }).success).toBe(false);
  expect(
    assetHealthInputsResponseSchema.safeParse({ ...inputsResponse, anomalyHistory: null, maintenance: null }).success,
  ).toBe(true);
}

/** Zero scored hours, zero open tickets and a penalty above 1 are refused: those are `null`, never a zero. */
export function runInputsBoundsTest(): void {
  const history = inputsResponse.anomalyHistory;
  expect(
    assetHealthInputsResponseSchema.safeParse({ ...inputsResponse, anomalyHistory: { ...history, scoredHours: 0 } }).success,
  ).toBe(false);
  expect(
    assetHealthInputsResponseSchema.safeParse({ ...inputsResponse, maintenance: { openCorrective: 0, pastSla: 0 } }).success,
  ).toBe(false);
  expect(
    assetHealthInputsResponseSchema.safeParse({ ...inputsResponse, anomalyHistory: { ...history, penalty: 1.2 } }).success,
  ).toBe(false);
}

/** A full bad-actors response parses; more than five rows on either tab, or four top points, are refused. */
export function runBadActorsResponseTest(): void {
  expect(healthBadActorsResponseSchema.safeParse(badActorsResponse).success).toBe(true);
  const anomaly = badActorsResponse.anomaly;
  expect(
    healthBadActorsResponseSchema.safeParse({ ...badActorsResponse, anomaly: { ...anomaly, items: times(6, badActor) } }).success,
  ).toBe(false);
  expect(
    healthBadActorsResponseSchema.safeParse({ ...badActorsResponse, anomaly: { ...anomaly, items: times(5, badActor) } }).success,
  ).toBe(true);
  expect(healthBadActorsResponseSchema.safeParse({ ...badActorsResponse, lowestScores: times(6, lowest) }).success).toBe(false);
  const fourPoints = { ...badActor, topPoints: ["a", "b", "c", "d"] };
  expect(
    healthBadActorsResponseSchema.safeParse({ ...badActorsResponse, anomaly: { ...anomaly, items: [fourPoints] } }).success,
  ).toBe(false);
  expect(healthBadActorsResponseSchema.safeParse({ ...badActorsResponse, anomaly: null }).success).toBe(true);
  const unscored = { ...badActor, ruleScore: null, advisoryScore: null };
  expect(
    healthBadActorsResponseSchema.safeParse({ ...badActorsResponse, anomaly: { ...anomaly, items: [unscored] } }).success,
  ).toBe(true);
}

/** Responses are not strict: an extra key parses at every level (an older bundle must read a newer API). */
export function runNotStrictTest(): void {
  expect(assetHealthInputsResponseSchema.safeParse({ ...inputsResponse, later: 1 }).success).toBe(true);
  expect(
    healthBadActorsResponseSchema.safeParse({
      ...badActorsResponse,
      later: 1,
      anomaly: { ...badActorsResponse.anomaly, later: 1, items: [{ ...badActor, later: 1 }] },
    }).success,
  ).toBe(true);
}

/** The five inputs of §4.3, in order, and the window derived from the anomaly list's, not restated. */
export function runConstantsTest(): void {
  expect(HEALTH_INPUTS).toEqual([
    { key: "operational", status: "scored" },
    { key: "historical", status: "advisory" },
    { key: "maintenance", status: "fact_only" },
    { key: "environmental", status: "no_source" },
    { key: "utilisation", status: "no_reference" },
  ]);
  expect(HEALTH_ANOMALY_WINDOW_DAYS).toBe(ANOMALY_LIST_MAX_DAYS);
  expect(HEALTH_ANOMALY_CAP).toBe(0.05);
  expect(HEALTH_ANOMALY_BASELINE_ONLY_WEIGHT).toBe(0);
  expect(HEALTH_BAD_ACTORS_LIMIT).toBe(5);
}

/** §4.2: the share of strong hours, capped; Baseline-only hours weigh nothing; no scored hour is no penalty. */
export function runPenaltyTest(): void {
  expect(healthAnomalyPenalty({ scoredHours: 168, strongHours: 0, baselineOnlyHours: 0 })).toBe(0);
  expect(healthAnomalyPenalty({ scoredHours: 168, strongHours: 1, baselineOnlyHours: 0 })).toBe(1 / 168);
  expect(healthAnomalyPenalty({ scoredHours: 100, strongHours: 5, baselineOnlyHours: 0 })).toBe(0.05);
  expect(healthAnomalyPenalty({ scoredHours: 100, strongHours: 6, baselineOnlyHours: 0 })).toBe(0.05);
  expect(healthAnomalyPenalty({ scoredHours: 168, strongHours: 0, baselineOnlyHours: 100 })).toBe(0);
  expect(healthAnomalyPenalty({ scoredHours: 0, strongHours: 0, baselineOnlyHours: 0 })).toBeNull();
}

/** §4.2: the rule score minus the penalty, never below 0, and `null` when either is missing. */
export function runAdvisoryScoreTest(): void {
  expect(advisoryHealthScore(0.93, 0.05)).toBeCloseTo(0.88, 12);
  expect(advisoryHealthScore(0.03, 0.05)).toBe(0);
  expect(advisoryHealthScore(null, 0.05)).toBeNull();
  expect(advisoryHealthScore(0.93, null)).toBeNull();
  expect(advisoryHealthScore(0.93, 0)).toBe(0.93);
}
