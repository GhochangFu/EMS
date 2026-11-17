import {
  HEALTH_INPUTS,
  advisoryHealthScore,
  anomalyFindingHref,
  assetHealthInputsResponseSchema,
  healthAnomalyPenalty,
  healthBadActorsResponseSchema,
} from "@bms/shared";
import { expect } from "vitest";

import { BASELINE_ONLY_SENTENCE, MIXED_SENTENCE } from "../ml/ml-findings.anomaly-facts";
import { CR, FX_BAND, FX_CURRENT_HOUR_MS, FX_HOUR_MS, FX_NOW, MTR, fx, hoursRow, labelRow, scopeScore } from "./health-inputs.fixture";
import {
  anomalyHistoryOf,
  lowestIdsOf,
  lowestScoresOf,
  maintenanceOf,
  rankBadActors,
  toBadActorsAnomaly,
  toInputsResponse,
  topPointsOf,
} from "./health-inputs.pure";

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan §4.1–§4.7, T1.2) — the pure step of the
 * health inputs: the five-input answer, the bad-actor order, the count of
 * assets that lose points, and the lowest rule scores. No database, no clock:
 * `FX_NOW` is passed in. Entry point: `health-inputs.pure.test.ts` (ADR 0014).
 */
const m = (i: number) => fx(MTR, i - 1);
const c = (i: number) => fx(CR, i - 1);
const ids = (rows: readonly { assetId: string }[]): string[] => rows.map((r) => r.assetId);
const noScores = new Map<string, number | null>();

/** Order: strong first; equal strong → more Baseline-only; equal both → lower code; no unusual hour → not listed. */
export function theOrderIsStrongThenBaselineOnlyThenCode(): void {
  const rows = [
    hoursRow(m(1), { strong: 3 }),
    hoursRow(m(2), { strong: 9 }),
    hoursRow(m(3), { strong: 3, baselineOnly: 2 }),
    hoursRow(m(5), { strong: 3, baselineOnly: 2 }),
    hoursRow(m(4), { strong: 3, baselineOnly: 2 }),
    hoursRow(c(1), { scored: 100 }),
  ];
  expect(rankBadActors(rows).map((r) => r.asset_code)).toEqual(["MTR-02", "MTR-03", "MTR-04", "MTR-05", "MTR-01"]);
  const anomaly = toBadActorsAnomaly(rows, noScores, FX_NOW);
  expect(anomaly.items.map((i) => i.assetCode)).toEqual(["MTR-02", "MTR-03", "MTR-04", "MTR-05", "MTR-01"]);
  expect(anomaly.unusualAssetCount).toBe(5);
}

/** Seven unusual assets → five items, `unusualAssetCount: 7`. */
export function sevenUnusualAssetsAreCutToFive(): void {
  const rows = [1, 2, 3, 4, 5, 6].map((i) => hoursRow(m(i), { strong: i })).concat([hoursRow(c(1), { baselineOnly: 1 })]);
  const anomaly = toBadActorsAnomaly(rows, noScores, FX_NOW);
  expect(anomaly.items).toHaveLength(5);
  expect(anomaly.items.map((i) => i.assetCode)).toEqual(["MTR-06", "MTR-05", "MTR-04", "MTR-03", "MTR-02"]);
  expect(anomaly.unusualAssetCount).toBe(7);
}

/** A forest-only asset (strong 0, Baseline-only 0, unusual 2) sorts after every Baseline-only asset; it is not weak. */
export function aForestOnlyAssetIsListedLastAndIsNotWeak(): void {
  const rows = [hoursRow(c(1), { unusual: 2 }), hoursRow(c(3), { baselineOnly: 1 }), hoursRow(c(2), { baselineOnly: 4 })];
  const items = toBadActorsAnomaly(rows, noScores, FX_NOW).items;
  expect(items.map((i) => i.assetCode)).toEqual(["CR-02", "CR-03", "CR-01"]);
  const forest = items[2];
  expect(forest).toMatchObject({ unusualHours: 2, strongHours: 0, baselineOnlyHours: 0, weak: false });
}

/** `weak` is true only when every unusual hour is Baseline-only. */
export function weakIsTrueOnlyWhenEveryUnusualHourIsBaselineOnly(): void {
  const rows = [
    hoursRow(c(1), { baselineOnly: 4 }),
    hoursRow(c(2), { baselineOnly: 4, unusual: 5 }),
    hoursRow(m(1), { strong: 1, baselineOnly: 4 }),
  ];
  const weak = new Map(toBadActorsAnomaly(rows, noScores, FX_NOW).items.map((i) => [i.assetCode, i.weak]));
  expect(Object.fromEntries(weak)).toEqual({ "CR-01": true, "CR-02": false, "MTR-01": false });
}

/** The caveat: all Baseline-only → that sentence; any other unusual hour anywhere in scope → the mixed one; none → null. */
export function theCaveatReadsTheWholeScope(): void {
  const sixBaselineOnly = [1, 2, 3, 4, 5, 6].map((i) => hoursRow(m(i), { baselineOnly: 20 + i }));
  expect(toBadActorsAnomaly(sixBaselineOnly, noScores, FX_NOW).caveat).toBe(BASELINE_ONLY_SENTENCE);
  // A forest-only hour on a seventh asset, outside the top 5, still makes the scope mixed.
  const withForest = toBadActorsAnomaly([...sixBaselineOnly, hoursRow(c(4), { unusual: 1 })], noScores, FX_NOW);
  expect(ids(withForest.items)).not.toContain(c(4).id);
  expect(withForest.caveat).toBe(MIXED_SENTENCE);
  expect(toBadActorsAnomaly([...sixBaselineOnly, hoursRow(c(4), { strong: 1 })], noScores, FX_NOW).caveat).toBe(MIXED_SENTENCE);
  // A scored asset with no unusual hour changes nothing.
  expect(toBadActorsAnomaly([...sixBaselineOnly, hoursRow(c(1))], noScores, FX_NOW).caveat).toBe(BASELINE_ONLY_SENTENCE);
  expect(toBadActorsAnomaly([hoursRow(c(1))], noScores, FX_NOW).caveat).toBeNull();
  expect(toBadActorsAnomaly([], noScores, FX_NOW).caveat).toBeNull();
}

/** Top points: detector order, no repeats, at most 3 on the row; the link carries every point and is the E1.9 link. */
export function theTopPointsAndTheLinkFollowTheLastUnusualHour(): void {
  expect(topPointsOf([["kw", "pf"], ["pf", "kva", "v_l1"]])).toEqual(["kw", "pf", "kva", "v_l1"]);
  expect(topPointsOf(null)).toEqual([]);
  expect(topPointsOf([[], ["kw"]])).toEqual(["kw"]);
  const row = hoursRow(m(1), { strong: 2, lastHoursAgo: 3, points: [["kw", "pf"], ["pf", "kva", "v_l1"]] });
  const item = toBadActorsAnomaly([row], noScores, FX_NOW).items[0];
  const lastMs = FX_CURRENT_HOUR_MS - 3 * FX_HOUR_MS;
  expect(item?.topPoints).toEqual(["kw", "pf", "kva"]);
  expect(item?.lastUnusualAt).toBe(new Date(lastMs).toISOString());
  expect(item?.href).toBe(anomalyFindingHref(m(1).id, lastMs, FX_NOW.getTime(), ["kw", "pf", "kva", "v_l1"]));
  expect(item?.href.startsWith("/asset-history/")).toBe(true);
}

/** An asset with a rule score carries it and its advisory figure; with no rule score both are null. */
export function theRowCarriesTheRuleScoreAndTheAdvisoryFigure(): void {
  const rows = [hoursRow(m(1), { scored: 100, strong: 3 }), hoursRow(m(2), { strong: 2 })];
  const scores = new Map<string, number | null>([[m(1).id, 0.93], [m(2).id, null]]);
  const items = toBadActorsAnomaly(rows, scores, FX_NOW).items;
  expect(items[0]).toMatchObject({ assetCode: "MTR-01", ruleScore: 0.93 });
  expect(items[0]?.advisoryScore).toBe(advisoryHealthScore(0.93, healthAnomalyPenalty({ scoredHours: 100, strongHours: 3, baselineOnlyHours: 0 })));
  expect(items[0]?.advisoryScore).toBeCloseTo(0.9, 12);
  expect(items[1]).toMatchObject({ assetCode: "MTR-02", ruleScore: null, advisoryScore: null });
}

/** Losing points: counts an asset outside the top 5; not one with no rule score, a rule score of 0, or Baseline-only hours. */
export function losingAssetsAreCountedOverTheWholeScope(): void {
  const rows = [
    ...[1, 2, 3, 4, 5].map((i) => hoursRow(m(i), { strong: 10 + i })),
    hoursRow(m(6), { strong: 1 }), // outside the top 5, rule score 0.8: loses points
    hoursRow(c(1), { strong: 4 }), // no rule score
    hoursRow(c(2), { strong: 4 }), // rule score 0
    hoursRow(c(3), { baselineOnly: 9 }), // Baseline-only, rule score 0.9
    hoursRow(c(4), { scored: 50 }), // no unusual hour, rule score 1
  ];
  const scores = new Map<string, number | null>([
    [m(6).id, 0.8],
    [c(1).id, null],
    [c(2).id, 0],
    [c(3).id, 0.9],
    [c(4).id, 1],
  ]);
  const anomaly = toBadActorsAnomaly(rows, scores, FX_NOW);
  expect(ids(anomaly.items)).not.toContain(m(6).id);
  expect(anomaly.losingAssetCount).toBe(1);
  scores.set(m(1).id, 0.5);
  expect(toBadActorsAnomaly(rows, scores, FX_NOW).losingAssetCount).toBe(2);
}

/** Lowest: the 5 lowest non-null scores ascending, ties by asset id; unscored never listed; band and tag count kept. */
export function theLowestScoresAreTheFiveLowestRuleScores(): void {
  const scored = [
    scopeScore(m(1), 0.9),
    scopeScore(m(2), 0.2, FX_BAND, 3),
    scopeScore(m(3), null),
    scopeScore(m(4), 0.5),
    scopeScore(c(2), 0.5),
    scopeScore(c(1), 0.5),
    scopeScore(m(5), 0.7),
    scopeScore(m(6), 0.1),
    scopeScore(c(3), null),
  ];
  const lowest = lowestIdsOf(scored);
  const byId = [m(6).id, m(2).id, ...[m(4).id, c(1).id, c(2).id].sort()];
  expect(lowest).toEqual(byId);
  const labels = new Map([m(1), m(2), m(3), m(4), m(5), m(6), c(1), c(2), c(3)].map((a) => [a.id, labelRow(a)]));
  const rows = lowestScoresOf(scored, labels);
  expect(ids(rows)).toEqual(byId);
  expect(rows.map((r) => r.score)).toEqual([0.1, 0.2, 0.5, 0.5, 0.5]);
  expect(rows[0]).toMatchObject({ assetCode: "MTR-06", band: null, scoredTagCount: 1, assetRtuName: "RTU-H1", assetLocationName: "Hill Plant" });
  expect(rows[1]).toMatchObject({ band: FX_BAND, scoredTagCount: 3 });
  expect(lowestIdsOf([scopeScore(m(3), null)])).toEqual([]);
  // A picked asset whose label was not read is left out rather than invented.
  expect(ids(lowestScoresOf(scored, new Map([[m(6).id, labelRow(m(6))]])))).toEqual([m(6).id]);
}

/** `anomalyHistoryOf` and `maintenanceOf`: no data is `null`, never a zero. */
export function theFactsAreNullWithoutData(): void {
  expect(anomalyHistoryOf(undefined)).toBeNull();
  expect(anomalyHistoryOf(hoursRow(m(1), { scored: 0 }))).toBeNull();
  expect(anomalyHistoryOf(hoursRow(m(1), { scored: 168 }))).toEqual({
    windowDays: 7,
    scoredHours: 168,
    unusualHours: 0,
    strongHours: 0,
    baselineOnlyHours: 0,
    penalty: 0,
  });
  expect(anomalyHistoryOf(hoursRow(m(1), { scored: 168, strong: 3, baselineOnly: 5 }))?.penalty).toBe(3 / 168);
  expect(maintenanceOf(undefined)).toBeNull();
  expect(maintenanceOf({ open_corrective: 0, past_sla: 0 })).toBeNull();
  expect(maintenanceOf({ open_corrective: 3, past_sla: 1 })).toEqual({ openCorrective: 3, pastSla: 1 });
}

/** The five inputs in order; the answer parses; every bad-actors answer parses. */
export function theAnswersParse(): void {
  const full = toInputsResponse(m(1).id, hoursRow(m(1), { strong: 2 }), { open_corrective: 2, past_sla: 1 }, FX_NOW);
  expect(full.inputs).toEqual(HEALTH_INPUTS);
  expect(full.asOf).toBe(FX_NOW.toISOString());
  expect(assetHealthInputsResponseSchema.parse(full)).toEqual(full);
  const empty = toInputsResponse(m(1).id, undefined, undefined, FX_NOW);
  expect(empty).toMatchObject({ anomalyHistory: null, maintenance: null });
  expect(assetHealthInputsResponseSchema.safeParse(empty).success).toBe(true);
  const rows = [1, 2, 3, 4, 5, 6].map((i) => hoursRow(m(i), { strong: i, points: [["a", "b", "c", "d"]] }));
  const anomaly = toBadActorsAnomaly(rows, new Map([[m(1).id, 0.5]]), FX_NOW);
  const labels = new Map([[m(1).id, labelRow(m(1))]]);
  const body = { asOf: FX_NOW.toISOString(), scoredAssetCount: 1, lowestScores: lowestScoresOf([scopeScore(m(1), 0.5)], labels), anomaly };
  expect(healthBadActorsResponseSchema.safeParse(body).success).toBe(true);
}
