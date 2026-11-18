import {
  DEGRADATION_MAX_ASSETS,
  degradationResponseSchema,
  type DegradationResponse,
  type TemplateHealth,
} from "@bms/shared";
import type { BmsDb } from "@bms/db";
import type { Pool } from "pg";
import { expect } from "vitest";

import type { AssetHealthService, HealthScopeScore } from "../asset-health/asset-health.service";
import type { ThresholdRuleDbRow } from "../ml/ml-findings.forecast-facts";
import type { CounterDay, MeanDay, ScheduleInput } from "./degradation-engine.types";
import type { DegradationCandidateDbRow } from "./degradation.reads";
import {
  DegradationService,
  computeDegradation,
  degradationReadsOf,
  type DegradationReads,
} from "./degradation.service";
import {
  countersOf,
  FX_COLD_STORE,
  FX_HEALTH,
  FX_NORTH_YARD,
  FX_NOW_MS,
  FX_ORGANIZATION,
  FX_WINDOW,
  FX_ZONE,
  fxRule,
  fxUuid,
  meansOf,
} from "./degradation.fixture";
import { V2, V7, type TrendVector } from "./trend-math.fixture";

/**
 * `E1.5a` / ADR 0138 (plan T1.7, T1.8, §4.1, R-n, R-o) — the service's one flow
 * with a fake for every read: candidates and their covered rules through the
 * read scope, the 200 cap (only above it), every fleet read with the considered
 * ids only (never `null`), the counter read only for assets with a usable
 * `fair` band, the mean read only for drift points with a covered rule, the
 * engine and the order, then the schedule read only for assets with a crossing,
 * which a failure leaves out with one `warn`. Assertions live here;
 * `degradation.service.test.ts` is the vitest entry point (ADR 0014).
 */
const NOW = new Date(FX_NOW_MS);
const DAY_MS = 86_400_000;
const POINT = "cold_room_temp_c";

const idOf = (n: number): string => fxUuid("aaaaaaaa", n);

const row = (n: number, over: Partial<DegradationCandidateDbRow> = {}): DegradationCandidateDbRow => ({
  asset_id: idOf(n),
  organization_id: FX_ORGANIZATION.id,
  location_id: FX_NORTH_YARD.id,
  asset_code: `FX-H${n}`,
  asset_name: `Fixture asset ${n}`,
  asset_rtu_name: null,
  location_name: FX_NORTH_YARD.name,
  location_zone: FX_ZONE,
  organization_zone: "UTC",
  drift_points: [],
  ...over,
});

/** A drift asset `FX-H<n>` at "Cold Store" with `cold_room_temp_c`. */
const driftRow = (n: number): DegradationCandidateDbRow =>
  row(n, { location_id: FX_COLD_STORE.id, location_name: FX_COLD_STORE.name, drift_points: [{ point_key: POINT, unit: "degC" }] });

type Profile = { health?: TemplateHealth | undefined; counters?: TrendVector | null; means?: TrendVector | null };

interface Harness {
  reads: DegradationReads;
  warnings: string[];
  calls: {
    candidates: (string[] | null)[];
    scores: (readonly string[])[];
    health: (readonly string[])[];
    counterDays: { assetId: string; zone: string }[][];
    meanDays: { assetId: string; pointKey: string; zone: string }[][];
    schedules: (readonly string[])[];
    order: string[];
  };
}

function harness(
  rows: DegradationCandidateDbRow[],
  profileOf: (assetId: string) => Profile = () => ({ health: FX_HEALTH, counters: V2 }),
  options: {
    rules?: ThresholdRuleDbRow[];
    scores?: (ids: readonly string[]) => HealthScopeScore[];
    schedules?: ScheduleInput[] | Error;
  } = {},
): Harness {
  const calls: Harness["calls"] = { candidates: [], scores: [], health: [], counterDays: [], meanDays: [], schedules: [], order: [] };
  const warnings: string[] = [];
  const reads: DegradationReads = {
    candidates: async (ids) => {
      calls.order.push("candidates");
      calls.candidates.push(ids);
      return { candidates: rows, rules: options.rules ?? [] };
    },
    scores: async (ids) => {
      calls.order.push("scores");
      calls.scores.push([...ids]);
      return options.scores ? options.scores(ids) : ids.map((assetId) => ({ assetId, score: 0.9, band: null, scoredTagCount: 1 }));
    },
    health: async (ids) => {
      calls.order.push("health");
      calls.health.push([...ids]);
      return new Map(ids.map((id) => [id, "health" in profileOf(id) ? profileOf(id).health : FX_HEALTH]));
    },
    counterDays: async (assets) => {
      calls.order.push("counterDays");
      calls.counterDays.push(assets.map((a) => ({ ...a })));
      return assets.flatMap((a) => {
        const vector = profileOf(a.assetId).counters;
        return vector ? countersOf(vector).map((day: CounterDay) => ({ assetId: a.assetId, ...day })) : [];
      });
    },
    meanDays: async (points) => {
      calls.order.push("meanDays");
      calls.meanDays.push(points.map((p) => ({ ...p })));
      return points.flatMap((p) => {
        const vector = profileOf(p.assetId).means;
        return vector ? meansOf(vector).map((day: MeanDay) => ({ assetId: p.assetId, pointKey: p.pointKey, ...day })) : [];
      });
    },
    schedules: async (ids) => {
      calls.order.push("schedules");
      calls.schedules.push([...ids]);
      if (options.schedules instanceof Error) throw options.schedules;
      return (options.schedules ?? []).filter((s) => ids.includes(s.assetId));
    },
  };
  return { reads, warnings, calls };
}

const log = (h: Harness) => ({ warn: (message: string) => h.warnings.push(message) });

/** The ids every read after the cap received (the score read is the cap itself). */
const fleetIdsOf = (h: Harness): string[] => [
  ...h.calls.health.flat(),
  ...h.calls.counterDays.flat().map((a) => a.assetId),
  ...h.calls.meanDays.flat().map((p) => p.assetId),
  ...h.calls.schedules.flat(),
];

export async function anEmptyScopeMakesNoRead(): Promise<void> {
  const h = harness([row(1)]);
  expect(await computeDegradation(h.reads, [], NOW, log(h))).toEqual({
    asOf: NOW.toISOString(),
    candidates: 0,
    considered: 0,
    assets: [],
  });
  expect(h.calls.order).toEqual([]);
  // No candidate: nothing after the candidate read.
  const none = harness([]);
  expect(await computeDegradation(none.reads, null, NOW, log(none))).toEqual({
    asOf: NOW.toISOString(),
    candidates: 0,
    considered: 0,
    assets: [],
  });
  expect(none.calls.order).toEqual(["candidates"]);
}

/** Above 200 candidates the current score ranks them: lowest first, no score last, then id; 200 go on. */
export async function theCapRunsTheScoreReadOnlyAbove200(): Promise<void> {
  const total = DEGRADATION_MAX_ASSETS + 1;
  const rows = Array.from({ length: total }, (_, i) => row(i + 1));
  // Asset 1 has no score, asset 2 is missing from the answer: both rank last. Everyone else
  // scores 0.5, except asset 3 at 0.99 (the highest) and asset 201 at 0.1 (the lowest).
  const scores = (ids: readonly string[]): HealthScopeScore[] =>
    ids
      .filter((id) => id !== idOf(2))
      .map((assetId) => ({
        assetId,
        score: assetId === idOf(1) ? null : assetId === idOf(3) ? 0.99 : assetId === idOf(total) ? 0.1 : 0.5,
        band: null,
        scoredTagCount: 1,
      }));
  const h = harness(rows, () => ({ health: FX_HEALTH, counters: null }), { scores });
  const body = await computeDegradation(h.reads, null, NOW, log(h));
  expect(h.calls.scores).toEqual([rows.map((r) => r.asset_id)]);
  expect(body.candidates).toBe(total);
  expect(body.considered).toBe(DEGRADATION_MAX_ASSETS);
  const considered = h.calls.health[0]!;
  expect(considered).toHaveLength(DEGRADATION_MAX_ASSETS);
  expect(considered[0]).toBe(idOf(total));
  expect(considered).toContain(idOf(3));
  // The two with no score rank last: the null-score asset 1 (lower id) is the 200th; asset 2 is cut.
  expect(considered[DEGRADATION_MAX_ASSETS - 1]).toBe(idOf(1));
  expect(considered).not.toContain(idOf(2));
  expect(fleetIdsOf(h).filter((id) => !considered.includes(id))).toEqual([]);
  expect(h.calls.counterDays.flat().map((a) => a.assetId)).toEqual(considered);

  // With 200 it does not run, and every candidate is considered.
  const exact = harness(rows.slice(0, DEGRADATION_MAX_ASSETS), () => ({ health: FX_HEALTH, counters: null }), { scores });
  const exactBody = await computeDegradation(exact.reads, null, NOW, log(exact));
  expect(exact.calls.scores).toEqual([]);
  expect(exactBody.candidates).toBe(DEGRADATION_MAX_ASSETS);
  expect(exactBody.considered).toBe(DEGRADATION_MAX_ASSETS);
}

/** `narrow`'s value reaches the candidate read unchanged; every later read gets considered ids, never `null`. */
export async function everyFleetReadGetsTheConsideredIdsOnly(): Promise<void> {
  for (const ids of [null, [idOf(1), idOf(2)]]) {
    const h = harness([row(1), driftRow(2)], (id) => (id === idOf(1) ? { health: FX_HEALTH, counters: V2 } : { means: V7 }), {
      rules: [fxRule(idOf(2), "gt", 8, { point_key: POINT })],
      schedules: [],
    });
    await computeDegradation(h.reads, ids, NOW, log(h));
    expect(h.calls.candidates).toEqual([ids]);
    expect(h.calls.health).toEqual([[idOf(1), idOf(2)]]);
    expect(h.calls.counterDays).toEqual([[{ assetId: idOf(1), zone: FX_ZONE }, { assetId: idOf(2), zone: FX_ZONE }]]);
    expect(h.calls.meanDays).toEqual([[{ assetId: idOf(2), pointKey: POINT, zone: FX_ZONE }]]);
    for (const list of [...h.calls.health, ...h.calls.schedules]) {
      expect(list).not.toBeNull();
      expect(Array.isArray(list)).toBe(true);
    }
    expect(fleetIdsOf(h).every((id) => id === idOf(1) || id === idOf(2))).toBe(true);
    // The health read runs before the two day reads.
    expect(h.calls.order.indexOf("health")).toBeLessThan(h.calls.order.indexOf("counterDays"));
    expect(h.calls.order.indexOf("health")).toBeLessThan(h.calls.order.indexOf("meanDays"));
  }
}

/** No `health` block, no `fair` band, or `fair` last: the asset reaches no counter read. */
export async function anAssetWithNoUsableFairBandReachesNoCounterRead(): Promise<void> {
  const noFair: TemplateHealth = { bands: FX_HEALTH.bands.filter((b) => b.code !== "fair") };
  const fairLast: TemplateHealth = { bands: FX_HEALTH.bands.slice(0, 3) };
  const profiles: Record<string, Profile> = {
    [idOf(1)]: { health: FX_HEALTH, counters: V2 },
    [idOf(2)]: { health: undefined, counters: V2 },
    [idOf(3)]: { health: noFair, counters: V2 },
    [idOf(4)]: { health: fairLast, counters: V2 },
  };
  const h = harness([row(1), row(2), row(3), row(4)], (id) => profiles[id]!);
  const body = await computeDegradation(h.reads, null, NOW, log(h));
  expect(h.calls.counterDays).toEqual([[{ assetId: idOf(1), zone: FX_ZONE }]]);
  expect(body.assets.map((a) => a.assetId)).toEqual([idOf(1)]);
  // Nobody with a usable band: no counter read at all.
  const none = harness([row(2)], (id) => profiles[id]!);
  await computeDegradation(none.reads, null, NOW, log(none));
  expect(none.calls.counterDays).toEqual([]);
}

/** A drift point with no covered rule reaches no mean read; a rule in another unit is not covered. */
export async function aDriftPointWithNoCoveredRuleReachesNoMeanRead(): Promise<void> {
  const h = harness([driftRow(1), driftRow(2)], () => ({ health: undefined, means: V7 }), {
    rules: [
      fxRule(idOf(1), "gt", 8, { point_key: POINT }),
      fxRule(idOf(2), "gt", 8, { point_key: POINT, rule_unit: "degF" }),
    ],
  });
  const body = await computeDegradation(h.reads, null, NOW, log(h));
  expect(h.calls.meanDays).toEqual([[{ assetId: idOf(1), pointKey: POINT, zone: FX_ZONE }]]);
  expect(body.assets.map((a) => a.assetId)).toEqual([idOf(1)]);
  const none = harness([driftRow(2)], () => ({ health: undefined, means: V7 }), { rules: [] });
  await computeDegradation(none.reads, null, NOW, log(none));
  expect(none.calls.meanDays).toEqual([]);
}

/** The engine's answer: P1 on the health asset, P2 on the drift asset, in 4.8's order; the response parses. */
export async function theResponseIsTheEnginesAnswerInOrder(): Promise<void> {
  const h = harness([driftRow(2), row(1)], (id) => (id === idOf(1) ? { health: FX_HEALTH, counters: V2 } : { health: undefined, means: V7 }), {
    rules: [fxRule(idOf(2), "gt", 8, { point_key: POINT })],
  });
  const body = await computeDegradation(h.reads, null, NOW, log(h));
  expect(degradationResponseSchema.safeParse(body).success).toBe(true);
  expect(body.asOf).toBe(NOW.toISOString());
  expect(body.candidates).toBe(2);
  expect(body.considered).toBe(2);
  // D (10–12) before H (13–17).
  expect(body.assets.map((a) => a.assetId)).toEqual([idOf(2), idOf(1)]);
  expect(body.assets[0]!.indicators[0]).toMatchObject({ kind: "point_drift", daysToLimit: { min: 10, max: 12 } });
  expect(body.assets[1]!.indicators[0]).toMatchObject({ kind: "health", daysToLimit: { min: 13, max: 17 } });
  expect(body.assets[1]).toMatchObject({ timeZone: FX_ZONE, windowFrom: FX_WINDOW.days[0], windowTo: FX_WINDOW.days[27] });
}

/** The schedule read runs only when an asset has a crossing, with those ids; the note is the engine's. */
export async function theScheduleReadRunsOnlyForAssetsWithACrossing(): Promise<void> {
  const schedules: ScheduleInput[] = [
    { scheduleId: fxUuid("eeeeeeee", 1), assetId: idOf(1), nextDueMs: FX_NOW_MS + 60 * DAY_MS },
    { scheduleId: fxUuid("eeeeeeee", 2), assetId: idOf(1), nextDueMs: FX_NOW_MS + 5 * DAY_MS },
  ];
  const profiles: Record<string, Profile> = {
    [idOf(1)]: { health: FX_HEALTH, counters: V2 },
    [idOf(2)]: { health: FX_HEALTH, counters: null },
  };
  const h = harness([row(1), row(2)], (id) => profiles[id]!, { schedules });
  const body = await computeDegradation(h.reads, null, NOW, log(h));
  expect(h.calls.schedules).toEqual([[idOf(1)]]);
  expect(h.calls.order.at(-1)).toBe("schedules");
  expect(body.assets[0]!.scheduleNotes).toEqual([
    {
      scheduleId: fxUuid("eeeeeeee", 1),
      nextDueAt: new Date(FX_NOW_MS + 60 * DAY_MS).toISOString(),
      sentence: "Trend reaches its limit in about 13–17 days; next service due in 60 days.",
    },
  ]);
  // No crossing: no schedule read.
  const none = harness([row(2)], (id) => profiles[id]!, { schedules });
  await computeDegradation(none.reads, null, NOW, log(none));
  expect(none.calls.schedules).toEqual([]);
}

/** A throwing schedule read: the same response without notes, and one `warn` naming the error's class only. */
export async function aThrowingScheduleReadLeavesTheNotesOut(): Promise<void> {
  const schedules: ScheduleInput[] = [{ scheduleId: fxUuid("eeeeeeee", 1), assetId: idOf(1), nextDueMs: FX_NOW_MS + 60 * DAY_MS }];
  const ok = harness([row(1)], undefined, { schedules });
  const withNotes = await computeDegradation(ok.reads, null, NOW, log(ok));
  expect(withNotes.assets[0]!.scheduleNotes).toHaveLength(1);
  expect(ok.warnings).toEqual([]);

  class FixtureReadError extends Error {}
  const failing = harness([row(1)], undefined, { schedules: new FixtureReadError("secret detail from the database") });
  const body: DegradationResponse = await computeDegradation(failing.reads, null, NOW, log(failing));
  expect(body).toEqual({ ...withNotes, assets: withNotes.assets.map((a) => ({ ...a, scheduleNotes: [] })) });
  expect(failing.warnings).toHaveLength(1);
  expect(failing.warnings[0]).toContain("FixtureReadError");
  expect(failing.warnings[0]).not.toContain("secret detail");
}

/** The service: an empty scope makes no query; the real reads run on the pool and through the health service. */
export async function theServiceWiresTheReads(): Promise<void> {
  const queries: { text: string; values: unknown[] }[] = [];
  const pool = {
    query: async (text: string, values: unknown[]) => {
      queries.push({ text, values });
      return { rows: [] };
    },
  } as unknown as Pick<Pool, "query">;
  const healthCalls: unknown[][] = [];
  const health = {
    healthForAssets: async (ids: readonly string[]) => {
      healthCalls.push(["healthForAssets", [...ids]]);
      return new Map();
    },
    scoresInScope: async (ids: readonly string[] | null, location: unknown, windowMinutes: number, now: Date) => {
      healthCalls.push(["scoresInScope", ids, location, windowMinutes, now]);
      return [];
    },
  } as unknown as AssetHealthService;
  const noDb = {} as BmsDb;
  const service = new DegradationService(noDb, noDb, pool as never, health);
  const empty = { asOf: NOW.toISOString(), candidates: 0, considered: 0, assets: [] };
  expect(await service.list([], NOW)).toEqual(empty);
  expect(queries).toEqual([]);

  const reads = degradationReadsOf({ tenantDb: noDb, fleetDb: noDb, pool, health });
  expect(await reads.candidates([])).toEqual({ candidates: [], rules: [] });
  expect(await reads.schedules([])).toEqual([]);
  expect(await reads.counterDays([{ assetId: idOf(1), zone: FX_ZONE }], FX_WINDOW.fromMs, FX_WINDOW.toMs)).toEqual([]);
  expect(await reads.meanDays([{ assetId: idOf(1), pointKey: POINT, zone: FX_ZONE }], FX_WINDOW.fromMs, FX_WINDOW.toMs)).toEqual([]);
  expect(queries).toHaveLength(2);
  expect(queries[0]!.text).toContain("telemetry.point_in_range_1h");
  expect(queries[1]!.text).toContain("telemetry.point_values_1h");
  await reads.health([idOf(1)]);
  await reads.scores([idOf(1)], NOW);
  expect(healthCalls).toEqual([
    ["healthForAssets", [idOf(1)]],
    ["scoresInScope", [idOf(1)], undefined, 1_440, NOW],
  ]);
}

/**
 * A site stored as `UTC` answers `timeZone: "UTC"`, as the site chain shows it,
 * while its days are grouped in the arithmetic zone `Etc/UTC` (code review).
 */
export async function aStoredUtcZoneIsSentAsStored(): Promise<void> {
  const h = harness([row(1, { location_zone: null, organization_zone: "UTC" })]);
  const body = await computeDegradation(h.reads, null, NOW, log(h));
  expect(h.calls.counterDays).toEqual([[{ assetId: idOf(1), zone: "Etc/UTC" }]]);
  expect(body.assets[0]).toMatchObject({ timeZone: "UTC" });
  const window = body.assets[0]!.indicators[0]!.assumptions[0]!;
  expect(window.endsWith(", UTC.")).toBe(true);
}
