import {
  ADVISORY_ANOMALY_CONTEXT_MAX,
  ADVISORY_MAX_ASSETS,
  ADVISORY_MIN_COVERAGE,
  ANOMALY_UNUSUAL_SCORE,
  advisoriesResponseSchema,
  type Advisory,
  type AdvisoriesResponse,
} from "@bms/shared";
import type { Pool } from "pg";
import { expect } from "vitest";

import { inputKey } from "../calc/calc-batch";
import type { BmsDb } from "@bms/db";
import type { MlAnomaliesService } from "../ml/ml-anomalies.service";
import type { EnergyRateResolver } from "../tariffs/energy-rate-resolver";
import type { MappingRow } from "../tariffs/location-tariff-read";
import { pairKey, type TariffVersion } from "../tariffs/tariff-versions";
import type { HourlyEnergy } from "../telemetry/energy-cost-by-day";
import {
  FIXTURE_ASSET_ID,
  FIXTURE_LOCATION_ID,
  FIXTURE_NOW_MS,
  FIXTURE_ORGANIZATION_ID,
  FIXTURE_WINDOWS,
  fixtureInput,
} from "./advisories.fixture";
import type { AdvisoryCandidateDbRow } from "./advisories.reads";
import {
  AdvisoriesService,
  advisoryReadsOf,
  computeAdvisories,
  mergeAdvisoryHours,
  type AdvisoryReads,
} from "./advisories.service";
import { ADVISORY_PARAMETER_KEYS, type AdvisoryPairHour } from "./advisory-engine.types";
import { advisoriesForAsset, rankAdvisories } from "./advisory-rank";
import { advisoryWindows } from "./advisory-window";

/**
 * `E1.6a` / ADR 0137 (plan T1.6, T1.7, Q3, R-c, R-d, R-e) — the service's one
 * flow with a fake for every read: candidates through the read scope, then the
 * no-zone and energy-off drops, the 200 cap, and every later read with the
 * candidate ids only (never `null`); the engine; the order; the anomaly context
 * for at most 25 excess advisories, which a failed read leaves out. Assertions
 * live here; `advisories.service.test.ts` is the vitest entry point (ADR 0014).
 */
const NOW = new Date(FIXTURE_NOW_MS);
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const RATE_KEY = ADVISORY_PARAMETER_KEYS.rate;

const idOf = (n: number): string => `0f0a0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const candidateRow = (assetId: string, overrides: Partial<AdvisoryCandidateDbRow> = {}): AdvisoryCandidateDbRow => ({
  asset_id: assetId,
  organization_id: FIXTURE_ORGANIZATION_ID,
  location_id: FIXTURE_LOCATION_ID,
  asset_code: assetId === FIXTURE_ASSET_ID ? "EM-01" : `EM-${assetId.slice(-3)}`,
  asset_name: "Fixture incomer meter",
  asset_rtu_name: null,
  location_name: "North Yard",
  domain: "electrical",
  location_zone: "Asia/Kolkata",
  currency: "INR",
  energy_features: "auto",
  has_pf: true,
  has_kva: true,
  has_kwh_total: true,
  has_kvah_total: true,
  ...overrides,
});

/** Hours of `assetId`: the window at `kw`, the four baseline windows at `history`. */
function hoursOf(assetId: string, kw: number, history: number | null): HourlyEnergy[] {
  const out: HourlyEnergy[] = [];
  for (let t = FIXTURE_WINDOWS.fromMs; t < FIXTURE_WINDOWS.toMs; t += HOUR_MS) out.push({ assetId, bucketMs: t, kwh: kw });
  if (history !== null) {
    for (let t = FIXTURE_WINDOWS.readFromMs; t < FIXTURE_WINDOWS.fromMs; t += HOUR_MS) out.push({ assetId, bucketMs: t, kwh: history });
  }
  return out;
}

type Profile = {
  kw: number;
  history: number | null;
  registers?: { kwh: number; kvah: number } | null;
  /** How long the register probes span, first to last; the window less an hour by default. */
  registerSpanMs?: number;
};

interface Harness {
  reads: AdvisoryReads;
  calls: {
    candidates: (string[] | null)[];
    topEnergy: { ids: string[]; sinceMs: number; limit: number }[];
    hours: { ids: string[]; from: Date; to: Date }[];
    baselineHours: { ids: string[]; fromMs: number; toMs: number }[];
    series: { pairs: { assetId: string; key: string }[]; from: Date; to: Date }[];
    registers: { assetId: string; pointKey: string; from: Date; to: Date }[][];
    pairHours: { ids: string[]; fromMs: number; toMs: number }[];
    mappings: string[][];
    versions: { organizationId: string; key: string }[][];
    anomalies: { assetId: string; from: Date; to: Date }[];
  };
}

function harness(
  rows: AdvisoryCandidateDbRow[],
  profiles: (assetId: string) => Profile = () => ({ kw: 50, history: null, registers: { kwh: 8700, kvah: 10000 } }),
  overrides: Partial<AdvisoryReads> = {},
): Harness {
  const calls: Harness["calls"] = {
    candidates: [], topEnergy: [], hours: [], baselineHours: [], series: [], registers: [], pairHours: [], mappings: [], versions: [], anomalies: [],
  };
  const reads: AdvisoryReads = {
    candidates: async (ids) => {
      calls.candidates.push(ids);
      return rows;
    },
    topEnergy: async (ids, sinceMs, limit) => {
      calls.topEnergy.push({ ids: [...ids], sinceMs, limit });
      return ids.slice(0, limit);
    },
    // F4.384: each fake answers only the range it is asked for, as the SQL does.
    hours: async (assets, from, to) => {
      calls.hours.push({ ids: assets.map((a) => a.assetId), from, to });
      return assets
        .flatMap((a) => hoursOf(a.assetId, profiles(a.assetId).kw, profiles(a.assetId).history))
        .filter((h) => h.bucketMs >= from.getTime() && h.bucketMs <= to.getTime());
    },
    baselineHours: async (ids, fromMs, toMs) => {
      calls.baselineHours.push({ ids: [...ids], fromMs, toMs });
      return ids
        .flatMap((id) => hoursOf(id, profiles(id).kw, profiles(id).history))
        .filter((h) => h.bucketMs >= fromMs && h.bucketMs < toMs);
    },
    series: async (pairs, from, to) => {
      calls.series.push({ pairs: pairs.map((p) => ({ ...p })), from, to });
      return new Map(pairs.filter((p) => p.key === RATE_KEY).map((p) => [inputKey(p.assetId, p.key), [{ fromMs: 0, toMs: null, value: 10, rank: -1 }]]));
    },
    registers: async (requests) => {
      calls.registers.push(requests.map((r) => ({ ...r })));
      return requests.map((r) => {
        const registers = profiles(r.assetId).registers ?? null;
        if (registers === null) return { first: null, last: null };
        const value = r.pointKey === "kwh_total" ? registers.kwh : registers.kvah;
        const spanMs = profiles(r.assetId).registerSpanMs ?? r.to.getTime() - r.from.getTime() - HOUR_MS;
        return { first: { timeMs: r.from.getTime(), value: 1000 }, last: { timeMs: r.from.getTime() + spanMs, value: 1000 + value } };
      });
    },
    pairHours: async (ids, fromMs, toMs) => {
      calls.pairHours.push({ ids: [...ids], fromMs, toMs });
      return new Map<string, AdvisoryPairHour[]>();
    },
    mappings: async (ids) => {
      calls.mappings.push([...ids]);
      return new Map(ids.map((assetId) => [assetId, [mapping(assetId)]]));
    },
    versions: async (pairs) => {
      calls.versions.push(pairs.map((p) => ({ ...p })));
      return new Map(pairs.map((p) => [pairKey(p.organizationId, p.key), [version()]]));
    },
    anomalies: async (assetId, window, now) => {
      calls.anomalies.push({ assetId, ...window });
      return { asOf: now.toISOString(), scores: [] };
    },
    ...overrides,
  };
  return { reads, calls };
}

const mapping = (assetId: string): MappingRow => ({
  id: "0f0a0000-0000-4000-8000-0000000000aa",
  organizationId: FIXTURE_ORGANIZATION_ID,
  locationId: FIXTURE_LOCATION_ID,
  tariffKey: "Fixture HT kVAh",
  billingMeterAssetId: assetId,
  billingMeterAssetIds: [assetId],
  sanctionedLoad: 100,
  sanctionedLoadUnit: "kw",
  effectiveFrom: "2026-04-01",
  effectiveTo: null,
  zone: "Asia/Kolkata",
  timeZone: "Asia/Kolkata",
  currency: "INR",
});

const version = (): TariffVersion => ({
  id: "0f0a0000-0000-4000-8000-0000000000bb",
  key: "Fixture HT kVAh",
  source: "organization",
  organizationId: FIXTURE_ORGANIZATION_ID,
  name: "Fixture HT kVAh",
  state: "Fixture",
  energyUnit: "kvah",
  fixedBasis: "none",
  dataStatus: "official",
  effectiveFrom: "2026-04-01",
  tariffOrder: null,
  sourceUrl: null,
  slabs: [],
});

const parsed = (body: AdvisoriesResponse): AdvisoriesResponse => advisoriesResponseSchema.parse(body);
const laterIds = (h: Harness): string[] => [
  ...h.calls.hours.flatMap((c) => c.ids),
  ...h.calls.baselineHours.flatMap((c) => c.ids),
  ...h.calls.series.flatMap((c) => c.pairs.map((p) => p.assetId)),
  ...h.calls.registers.flatMap((c) => c.map((r) => r.assetId)),
  ...h.calls.pairHours.flatMap((c) => c.ids),
  ...h.calls.mappings.flat(),
];

/** An empty scope reads nothing at all and answers zero counts. */
export async function anEmptyScopeMakesNoRead(): Promise<void> {
  const h = harness([candidateRow(FIXTURE_ASSET_ID)]);
  const body = parsed(await computeAdvisories(h.reads, [], NOW));
  expect(body).toEqual({ asOf: NOW.toISOString(), candidates: 0, considered: 0, advisories: [] });
  expect(Object.values(h.calls).every((list) => list.length === 0)).toBe(true);
}

/** A meter with no zone of its own, or with energy features off, never reaches a telemetry, rate or tariff read. */
export async function noZoneAndEnergyOffReachNoLaterRead(): Promise<void> {
  const noZone = idOf(201);
  const off = idOf(202);
  const h = harness([candidateRow(noZone, { location_zone: null }), candidateRow(off, { energy_features: "off" })]);
  const body = parsed(await computeAdvisories(h.reads, [noZone, off], NOW));
  expect(body).toMatchObject({ candidates: 0, considered: 0, advisories: [] });
  expect(h.calls.candidates).toEqual([[noZone, off]]);
  expect(laterIds(h)).toEqual([]);
  expect(h.calls.topEnergy).toEqual([]);

  const mixed = harness([candidateRow(FIXTURE_ASSET_ID), candidateRow(noZone, { location_zone: null })]);
  const answer = parsed(await computeAdvisories(mixed.reads, null, NOW));
  expect(answer).toMatchObject({ candidates: 1, considered: 1 });
  expect(new Set(laterIds(mixed))).toEqual(new Set([FIXTURE_ASSET_ID]));
}

/** 201 candidates: the ranking read runs and 200 ids go on; 200: it does not run. */
export async function theCapRunsTheRankingReadOnlyAbove200(): Promise<void> {
  const rows = Array.from({ length: ADVISORY_MAX_ASSETS + 1 }, (_, i) => candidateRow(idOf(1000 + i)));
  const flat = () => ({ kw: 50, history: null, registers: null });
  const over = harness(rows, flat);
  const body = parsed(await computeAdvisories(over.reads, rows.map((r) => r.asset_id), NOW));
  expect(body.candidates).toBe(ADVISORY_MAX_ASSETS + 1);
  expect(body.considered).toBe(ADVISORY_MAX_ASSETS);
  expect(over.calls.topEnergy).toHaveLength(1);
  expect(over.calls.topEnergy[0]?.ids).toHaveLength(ADVISORY_MAX_ASSETS + 1);
  expect(over.calls.topEnergy[0]?.limit).toBe(ADVISORY_MAX_ASSETS);
  expect(over.calls.topEnergy[0]?.sinceMs).toBe(FIXTURE_NOW_MS - 7 * DAY_MS);
  expect(over.calls.hours[0]?.ids).toHaveLength(ADVISORY_MAX_ASSETS);
  expect(over.calls.hours[0]?.ids).not.toContain(idOf(1000 + ADVISORY_MAX_ASSETS));

  const exactly = harness(rows.slice(0, ADVISORY_MAX_ASSETS), flat);
  const all = parsed(await computeAdvisories(exactly.reads, null, NOW));
  expect(all).toMatchObject({ candidates: ADVISORY_MAX_ASSETS, considered: ADVISORY_MAX_ASSETS });
  expect(exactly.calls.topEnergy).toEqual([]);
}

/** The admin's `null` reaches the candidate read only; every later read gets the candidate ids, never `null`. */
export async function everyLaterReadGetsTheCandidateIdsOnly(): Promise<void> {
  const other = idOf(301);
  const h = harness([candidateRow(FIXTURE_ASSET_ID), candidateRow(other, { has_kwh_total: false })]);
  await computeAdvisories(h.reads, null, NOW);
  expect(h.calls.candidates).toEqual([null]);
  for (const c of h.calls.hours) expect(c.ids.sort()).toEqual([FIXTURE_ASSET_ID, other].sort());
  for (const c of h.calls.baselineHours) expect(c.ids.sort()).toEqual([FIXTURE_ASSET_ID, other].sort());
  for (const c of h.calls.series) expect([...new Set(c.pairs.map((p) => p.assetId))].sort()).toEqual([FIXTURE_ASSET_ID, other].sort());
  for (const c of h.calls.mappings) expect(c.sort()).toEqual([FIXTURE_ASSET_ID, other].sort());
  // Registers only where both register points are active; the pair read only where no usable register pair is.
  expect(h.calls.registers.flat().map((r) => r.assetId)).toEqual([FIXTURE_ASSET_ID, FIXTURE_ASSET_ID]);
  expect(h.calls.pairHours.map((c) => c.ids)).toEqual([[other]]);
  for (const id of laterIds(h)) expect(typeof id).toBe("string");
  // The read ranges (F4.384): the window's local hours, the 28 baseline days' UTC hours, the window for rates and registers.
  expect(h.calls.hours[0]?.from.getTime()).toBe(FIXTURE_WINDOWS.fromMs);
  expect(h.calls.hours[0]?.to.getTime()).toBe(FIXTURE_WINDOWS.readToMs - 1);
  expect(h.calls.baselineHours).toEqual([
    { ids: expect.any(Array), fromMs: FIXTURE_WINDOWS.readFromMs, toMs: FIXTURE_WINDOWS.fromMs },
  ]);
  expect(h.calls.series[0]?.from.getTime()).toBe(FIXTURE_WINDOWS.fromMs);
  expect(h.calls.series[0]?.to.getTime()).toBeLessThan(FIXTURE_WINDOWS.toMs);
  expect(new Set(h.calls.series[0]?.pairs.map((p) => p.key))).toEqual(new Set(Object.values(ADVISORY_PARAMETER_KEYS)));
  expect(h.calls.registers[0]?.map((r) => [r.pointKey, r.from.getTime(), r.to.getTime()])).toEqual([
    ["kwh_total", FIXTURE_WINDOWS.fromMs, FIXTURE_WINDOWS.toMs],
    ["kvah_total", FIXTURE_WINDOWS.fromMs, FIXTURE_WINDOWS.toMs],
  ]);
  expect(h.calls.pairHours[0]).toMatchObject({ fromMs: FIXTURE_WINDOWS.fromMs, toMs: FIXTURE_WINDOWS.toMs });
  expect(h.calls.versions).toEqual([[{ organizationId: FIXTURE_ORGANIZATION_ID, key: "Fixture HT kVAh" }]]);
}

/**
 * Registers spanning less than ADVISORY_MIN_COVERAGE of the window are not usable (owner ruling
 * 2026-11-17, E1.6a code review): the service reads the pair hours, as the engine would fall through.
 */
export async function aShortRegisterSpanSendsTheMeterToThePairRead(): Promise<void> {
  const minSpanMs = ADVISORY_MIN_COVERAGE * (FIXTURE_WINDOWS.toMs - FIXTURE_WINDOWS.fromMs);
  const short = harness([candidateRow(FIXTURE_ASSET_ID)], () => ({
    kw: 50, history: null, registers: { kwh: 8700, kvah: 10000 }, registerSpanMs: minSpanMs - 1,
  }));
  const body = parsed(await computeAdvisories(short.reads, [FIXTURE_ASSET_ID], NOW));
  expect(short.calls.pairHours.map((c) => c.ids)).toEqual([[FIXTURE_ASSET_ID]]);
  // The harness's pair read is empty, so no path qualifies: no PF advisory.
  expect(body.advisories.filter((a) => a.kind === "low_power_factor")).toEqual([]);

  const atThreshold = harness([candidateRow(FIXTURE_ASSET_ID)], () => ({
    kw: 50, history: null, registers: { kwh: 8700, kvah: 10000 }, registerSpanMs: minSpanMs,
  }));
  const fired = parsed(await computeAdvisories(atThreshold.reads, [FIXTURE_ASSET_ID], NOW));
  expect(atThreshold.calls.pairHours).toEqual([]);
  expect(fired.advisories.map((a) => a.kind)).toContain("low_power_factor");
}

/** The service fills the engine's input exactly as the engine's own fixture does: the same advisories. */
export async function theInputIsFilledAsTheEngineExpects(): Promise<void> {
  const h = harness([candidateRow(FIXTURE_ASSET_ID)]);
  const body = parsed(await computeAdvisories(h.reads, [FIXTURE_ASSET_ID], NOW));
  const expected = rankAdvisories(advisoriesForAsset(fixtureInput(), FIXTURE_WINDOWS));
  expect(expected.map((a) => a.kind)).toEqual(["low_power_factor"]);
  expect(body).toEqual({ asOf: NOW.toISOString(), candidates: 1, considered: 1, advisories: expected });
  // No tariff mapped: the engine is told so (R-j), not handed the version of another site.
  const unmapped = harness([candidateRow(FIXTURE_ASSET_ID)], undefined, { mappings: async () => new Map() });
  const plain = parsed(await computeAdvisories(unmapped.reads, [FIXTURE_ASSET_ID], NOW));
  expect(plain.advisories).toEqual(rankAdvisories(advisoriesForAsset(fixtureInput({ tariff: null }), FIXTURE_WINDOWS)));
  expect(unmapped.calls.versions).toEqual([]);
}

const excessProfile = (): Profile => ({ kw: 80, history: 50, registers: null });

/** A throwing anomaly read gives the advisories without a context line, never a failed response. */
export async function aThrowingAnomalyReadLeavesTheContextOut(): Promise<void> {
  const h = harness([candidateRow(FIXTURE_ASSET_ID, { has_kwh_total: false })], excessProfile, {
    anomalies: async () => {
      throw new Error("anomaly read failed");
    },
  });
  const body = parsed(await computeAdvisories(h.reads, [FIXTURE_ASSET_ID], NOW));
  const excess = body.advisories.find((a) => a.kind === "excess_consumption");
  expect(excess).toBeDefined();
  expect(excess?.context).toEqual([]);
}

/** One unusual hour in the window: the context lines, and no number moves (R-d). */
export async function aContextIsAddedAndChangesNoNumber(): Promise<void> {
  const inWindow = new Date(FIXTURE_WINDOWS.fromMs + 30 * HOUR_MS).toISOString();
  const outside = new Date(FIXTURE_WINDOWS.fromMs - 30 * HOUR_MS).toISOString();
  const scores = [
    { t: inWindow, detector: "baseline_mad", score: ANOMALY_UNUSUAL_SCORE, contributingPoints: ["kw"] },
    { t: outside, detector: "baseline_mad", score: 1, contributingPoints: ["kw"] },
  ];
  const plain = harness([candidateRow(FIXTURE_ASSET_ID, { has_kwh_total: false })], excessProfile);
  const withContext = harness([candidateRow(FIXTURE_ASSET_ID, { has_kwh_total: false })], excessProfile, {
    anomalies: async (_id, _window, now) => ({ asOf: now.toISOString(), scores }),
  });
  const a = parsed(await computeAdvisories(plain.reads, [FIXTURE_ASSET_ID], NOW)).advisories;
  const b = parsed(await computeAdvisories(withContext.reads, [FIXTURE_ASSET_ID], NOW)).advisories;
  const excessB = b.find((x) => x.kind === "excess_consumption")!;
  expect(excessB.context[0]).toBe("1 unusual hour in this window on the Anomalies page (advisory); 0 marked by both methods.");
  const strip = (list: Advisory[]) => list.map(({ context: _context, ...rest }) => rest);
  expect(strip(b)).toEqual(strip(a));
  expect(plain.calls.anomalies).toEqual([
    { assetId: FIXTURE_ASSET_ID, from: new Date(FIXTURE_WINDOWS.fromMs), to: new Date(FIXTURE_WINDOWS.toMs) },
  ]);
}

/** At most 25 anomaly reads, for the first 25 excess advisories in the response's order. */
export async function atMost25AnomalyReadsInTheResponseOrder(): Promise<void> {
  const count = ADVISORY_ANOMALY_CONTEXT_MAX + 5;
  const rows = Array.from({ length: count }, (_, i) => candidateRow(idOf(500 + i), { has_kwh_total: false }));
  // A larger meter has a larger excess, so it sorts first.
  const h = harness(rows, (assetId) => ({ kw: 60 + Number(assetId.slice(-3)) - 500, history: 40, registers: null }));
  const body = parsed(await computeAdvisories(h.reads, rows.map((r) => r.asset_id), NOW));
  const excess = body.advisories.filter((a) => a.kind === "excess_consumption");
  expect(excess).toHaveLength(count);
  expect(h.calls.anomalies).toHaveLength(ADVISORY_ANOMALY_CONTEXT_MAX);
  expect(h.calls.anomalies.map((c) => c.assetId)).toEqual(excess.slice(0, ADVISORY_ANOMALY_CONTEXT_MAX).map((a) => a.assetId));
}

/** The class: an empty scope never touches a pool; the adapters pass each read through unchanged. */
export async function theServiceWiresTheReads(): Promise<void> {
  const queries: string[] = [];
  const pool = {
    query: async (text: string) => {
      queries.push(text);
      return { rows: [] };
    },
  } as unknown as Pick<Pool, "query">;
  const seriesCalls: unknown[] = [];
  const rates = {
    resolveSeriesForAssets: async (...args: unknown[]) => {
      seriesCalls.push(args);
      return new Map();
    },
  } as unknown as EnergyRateResolver;
  const anomalyCalls: unknown[] = [];
  const anomalies = {
    forAsset: async (assetId: string, window: { from: Date; to: Date }, now: Date) => {
      anomalyCalls.push([assetId, window, now]);
      return { asOf: now.toISOString(), scores: [] };
    },
  } as unknown as MlAnomaliesService;
  const noDb = {} as BmsDb;
  const service = new AdvisoriesService(noDb, noDb, pool as never, rates, anomalies);
  expect(await service.list([], NOW)).toEqual({ asOf: NOW.toISOString(), candidates: 0, considered: 0, advisories: [] });
  expect(queries).toEqual([]);

  const reads = advisoryReadsOf({ tenantDb: noDb, fleetDb: noDb, pool, rates, anomalies });
  const from = new Date(FIXTURE_WINDOWS.fromMs);
  const to = new Date(FIXTURE_WINDOWS.toMs);
  expect(await reads.candidates([])).toEqual([]);
  expect(await reads.hours([{ assetId: FIXTURE_ASSET_ID, zone: "Asia/Kolkata" }], from, to)).toEqual([]);
  expect(await reads.baselineHours([FIXTURE_ASSET_ID], from.getTime(), to.getTime())).toEqual([]);
  expect(await reads.topEnergy([FIXTURE_ASSET_ID], 0, 200)).toEqual([]);
  expect((await reads.pairHours([FIXTURE_ASSET_ID], 0, 1)).size).toBe(0);
  expect(await reads.registers([{ assetId: FIXTURE_ASSET_ID, pointKey: "kwh_total", from, to }])).toEqual([{ first: null, last: null }]);
  expect((await reads.mappings([FIXTURE_ASSET_ID])).size).toBe(0);
  expect((await reads.versions([{ organizationId: FIXTURE_ORGANIZATION_ID, key: "k" }])).size).toBe(0);
  expect(queries).toHaveLength(7);
  expect(queries.some((q) => q.includes("telemetry.point_values_1h") && q.includes("p.point_key = 'kw'"))).toBe(true);
  await reads.series([{ assetId: FIXTURE_ASSET_ID, key: RATE_KEY }], from, to);
  expect(seriesCalls).toEqual([[[{ assetId: FIXTURE_ASSET_ID, key: RATE_KEY }], from, to]]);
  await reads.anomalies(FIXTURE_ASSET_ID, { from, to }, NOW);
  expect(anomalyCalls).toEqual([[FIXTURE_ASSET_ID, { from, to }, NOW]]);
}

// --- F4.384: the window from `_5m` local hours, the baselines from `_1h` UTC hours ---------

const TOKYO = "Asia/Tokyo";
const TOKYO_ID = idOf(701);
const POISON = 100_000;

/** Every hour from `fromMs` (on its own grid) up to `toMs`, at `value(t)`. */
function grid(assetId: string, fromMs: number, toMs: number, value: (t: number) => number): HourlyEnergy[] {
  const out: HourlyEnergy[] = [];
  for (let t = fromMs; t < toMs; t += HOUR_MS) out.push({ assetId, bucketMs: t, kwh: value(t) });
  return out;
}

/**
 * Two meters in two zones (Kolkata +05:30, Tokyo +09:00): the window read runs from the earlier
 * zone's window start to the later read end less 1 ms; the baseline read from the earlier read
 * start to the later window start. Each is one read for both meters.
 */
export async function theWindowAndBaselineReadsSplitAtTheZoneWindowStarts(): Promise<void> {
  const kolkata = FIXTURE_WINDOWS;
  const tokyo = advisoryWindows(FIXTURE_NOW_MS, TOKYO);
  expect(tokyo.fromMs).toBeLessThan(kolkata.fromMs);
  const h = harness([candidateRow(FIXTURE_ASSET_ID), candidateRow(TOKYO_ID, { location_zone: TOKYO })]);
  await computeAdvisories(h.reads, null, NOW);
  expect(h.calls.hours).toHaveLength(1);
  expect(h.calls.hours[0]!.from.getTime()).toBe(Math.min(kolkata.fromMs, tokyo.fromMs));
  expect(h.calls.hours[0]!.to.getTime()).toBe(Math.max(kolkata.readToMs, tokyo.readToMs) - 1);
  expect(h.calls.baselineHours).toHaveLength(1);
  expect(h.calls.baselineHours[0]!.fromMs).toBe(Math.min(kolkata.readFromMs, tokyo.readFromMs));
  expect(h.calls.baselineHours[0]!.toMs).toBe(Math.max(kolkata.fromMs, tokyo.fromMs));
  expect(h.calls.baselineHours[0]!.ids.sort()).toEqual([FIXTURE_ASSET_ID, TOKYO_ID].sort());
}

/**
 * The merge, pure: per asset, `_5m` hours from that asset's own window start, `_1h` hours before
 * it — never one hour from both. Each read here returns its whole range for both meters, and
 * every hour on the wrong side of a meter's own start carries a poison value.
 */
export function theMergeKeepsNoHourTwice(): void {
  const kolkata = FIXTURE_WINDOWS;
  const tokyo = advisoryWindows(FIXTURE_NOW_MS, TOKYO);
  const fromMsOf = new Map([
    [FIXTURE_ASSET_ID, kolkata.fromMs],
    [TOKYO_ID, tokyo.fromMs],
  ]);
  const minFrom = Math.min(kolkata.fromMs, tokyo.fromMs);
  const maxFrom = Math.max(kolkata.fromMs, tokyo.fromMs);
  const minRead = Math.min(kolkata.readFromMs, tokyo.readFromMs);
  const readTo = Math.max(kolkata.readToMs, tokyo.readToMs);
  // `_5m` local hours on each zone's own grid; `_1h` on the UTC grid.
  const fiveMinute = [FIXTURE_ASSET_ID, TOKYO_ID].flatMap((id) => {
    const own = fromMsOf.get(id)!;
    const start = own - Math.ceil((own - minFrom) / HOUR_MS) * HOUR_MS;
    return grid(id, start, readTo, (t) => (t >= own ? 80 : POISON));
  });
  const hourly = [FIXTURE_ASSET_ID, TOKYO_ID].flatMap((id) =>
    grid(id, Math.ceil(minRead / HOUR_MS) * HOUR_MS, maxFrom, (t) => (t < fromMsOf.get(id)! ? 50 : POISON)),
  );
  const merged = mergeAdvisoryHours(fiveMinute, hourly, fromMsOf);
  for (const id of [FIXTURE_ASSET_ID, TOKYO_ID]) {
    const list = merged.get(id) ?? [];
    expect(list.some((hour) => hour.kwh === POISON), id).toBe(false);
    expect(new Set(list.map((hour) => hour.bucketMs)).size, id).toBe(list.length);
    expect(list.map((hour) => hour.bucketMs), id).toEqual([...list.map((hour) => hour.bucketMs)].sort((a, b) => a - b));
    // The window: the zone's 168 local hours from `_5m`, none from `_1h`.
    const own = fromMsOf.get(id)!;
    expect(list.filter((hour) => hour.bucketMs >= own).every((hour) => hour.kwh === 80), id).toBe(true);
    expect(list.filter((hour) => hour.bucketMs >= own && hour.bucketMs < own + 7 * DAY_MS), id).toHaveLength(168);
  }
  // Kolkata's window starts at a half hour (18:30Z): the UTC bucket that straddles it (18:00Z,
  // its 18:10 sample before the window) is a baseline hour and is kept — the 30 minutes Q2 (b)
  // accepts. Dropping it would leave the last baseline window one hour short (code review).
  const straddle = Math.floor(kolkata.fromMs / HOUR_MS) * HOUR_MS;
  expect(straddle).toBeLessThan(kolkata.fromMs);
  expect(merged.get(FIXTURE_ASSET_ID)?.find((hour) => hour.bucketMs === straddle)?.kwh).toBe(50);
  // An asset no zone window names is not carried.
  expect(mergeAdvisoryHours([{ assetId: idOf(999), bucketMs: minFrom, kwh: 1 }], [], fromMsOf).has(idOf(999))).toBe(false);
}

/**
 * The service end to end on the same poisoned reads, two zones: each meter's excess is its own
 * 30 kW over 168 hours — a poisoned or a doubled hour would move it.
 */
export async function twoZonesGiveEachMeterItsOwnExcess(): Promise<void> {
  const fromOf = new Map([
    [FIXTURE_ASSET_ID, FIXTURE_WINDOWS.fromMs],
    [TOKYO_ID, advisoryWindows(FIXTURE_NOW_MS, TOKYO).fromMs],
  ]);
  const h = harness(
    [candidateRow(FIXTURE_ASSET_ID, { has_kwh_total: false }), candidateRow(TOKYO_ID, { location_zone: TOKYO, has_kwh_total: false })],
    excessProfile,
    {
      // Each read ignores its range: the whole 35 days, on its own grid, poisoned on the wrong side.
      hours: async (assets, _from, to) =>
        assets.flatMap((a) => {
          const own = fromOf.get(a.assetId)!;
          return grid(a.assetId, own - 35 * DAY_MS, to.getTime() + 1, (t) => (t >= own ? 80 : POISON));
        }),
      baselineHours: async (ids) =>
        ids.flatMap((id) => {
          const own = fromOf.get(id)!;
          const utc = Math.floor(own / HOUR_MS) * HOUR_MS;
          return grid(id, utc - 35 * DAY_MS, utc + 8 * DAY_MS, (t) => (t < own ? 50 : POISON));
        }),
    },
  );
  const body = parsed(await computeAdvisories(h.reads, null, NOW));
  const excess = body.advisories.filter((a) => a.kind === "excess_consumption");
  expect(excess.map((a) => a.assetId).sort()).toEqual([FIXTURE_ASSET_ID, TOKYO_ID].sort());
  for (const advisory of excess) {
    expect(advisory.kwh, advisory.assetId).toEqual({ window: 30 * 168, projected: Math.round((30 * 168 * 30) / 7) });
    expect(advisory.headline, advisory.assetId).toContain("1.6 times its usual");
  }
}

/**
 * Where `_5m` and `_1h` agree hour for hour, the figures are the engine's on the 35 days of one
 * read: both reads here return the same 35 days, ignoring their ranges, and the merge keeps each
 * hour once.
 */
export async function agreeingReadsGiveTheSameFigures(): Promise<void> {
  const profile = (): Profile => ({ kw: 80, history: 50, registers: { kwh: 8700, kvah: 10000 } });
  const all = hoursOf(FIXTURE_ASSET_ID, 80, 50);
  const h = harness([candidateRow(FIXTURE_ASSET_ID)], profile, {
    hours: async () => all,
    baselineHours: async () => all,
  });
  const body = parsed(await computeAdvisories(h.reads, [FIXTURE_ASSET_ID], NOW));
  const expected = rankAdvisories(
    advisoriesForAsset(
      fixtureInput({
        hours: [...all].sort((a, b) => a.bucketMs - b.bucketMs),
        registers: { kwh: 8700, kvah: 10000, spanMs: FIXTURE_WINDOWS.toMs - FIXTURE_WINDOWS.fromMs - HOUR_MS },
      }),
      FIXTURE_WINDOWS,
    ),
  );
  expect(expected.map((a) => a.kind).sort()).toEqual(["excess_consumption", "low_power_factor"]);
  const strip = (list: Advisory[]) => list.map(({ context: _context, ...rest }) => rest);
  expect(strip(body.advisories)).toEqual(strip(expected));
}
