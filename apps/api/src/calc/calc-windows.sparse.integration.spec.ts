import { randomUUID } from "node:crypto";

import type pg from "pg";

import { assets, createDb } from "@bms/db";
import type { CalcWindowFn, CalcWindowRead } from "@bms/shared";

import type { Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { materializeCompleteBuckets } from "../testing/cagg-materialize";
import { CalcWindowsService, windowRequestKey, type WindowReadRequest, type WindowReadResult } from "./calc-windows.service";

/**
 * `E4.4` — the `window_sparse` guard against a real database with real
 * continuous aggregates (ADR 0070 Amendment 3). The covered-time fold is a
 * pure spec (`calc-window-plan.spec.ts`); what only a database can show is
 * that the three coverage facts come out of the level statement right — the
 * distinct units, the head and tail flags at the one-hour floor — and that
 * they ride in that statement without adding one.
 *
 * **The "month" is ten days, by owner ruling (2026-09-23).** The first cut
 * used thirty, and its two refreshes cost about 150 s of CI; the guard is a
 * fraction, so the window's length proves nothing a shorter one does not.
 * Seven covered days of ten is 70%, as twenty of thirty was 67% — both well
 * under 90%. The `month*` names below are kept from the plan's vocabulary.
 *
 * **The window sits sixty days in the past on purpose.** `S = floor_1d(now) −
 * 60 d`, window `[S, S + 10 d)`, tick `S + 10 d`, a rolling `10d`. That is
 * behind every watermark, so the planner serves the whole window from `1d`
 * and the batch runs exactly two statements (the watermarks and the `1d`
 * level) — the statement-budget claim is then an exact count, not a bound.
 * The rows are invisible in the views until `materializeCompleteBuckets`
 * re-covers their buckets. On the compose stack, measured 2026-09-23, no row
 * of `telemetry.point_values` lies in that range (the oldest is
 * 2026-08-29) and CI's database is fresh, so the refresh recomputes only the
 * fixture's buckets. **It is still the slow part**: over thirty days the `1m`
 * refresh was about 60 s and each `materializeCompleteBuckets` call about
 * 73 s (measured 2026-09-23); the cost scales with the range, and it runs
 * once in the seed and once in `cleanup`. The `1d` view is refreshed from the
 * finer ones, so the `1m` pass cannot be skipped.
 *
 * **The hour-floor cases sit three hours in the past**, at `5m` resolution:
 * `H = floor_1h(now) − 3 h`, window `[H:15, H+1:15)`. `CLIP_HEAD` holds two
 * `5m` buckets in ONE hour (H:20, H:40) — a `count(*)` in place of
 * `count(DISTINCT hour)` counts that hour twice and answers.
 *
 * One asset on `fx.foreignLocationId` (every window here is rolling, so no
 * zone is read or set). The helpers `countedService`, `windowFn`, `rolling`,
 * `resolveOne` and `near` are copied from `calc-windows.integration.spec.ts`
 * rather than exported from it: that suite's only change in `E4.4` is one
 * comment, and a spec importing a sibling spec would load its module-level
 * fixture codes for nothing.
 *
 * `cleanup` deletes the rows by asset id, deletes the asset and re-covers
 * both ranges (the `0027` standing obligation), so no materialized bucket
 * outlives the run. The ranges come from `sparseAnchors`, which the wrapper
 * computes before the seed — a seed that throws after its insert still
 * leaves `cleanup` both ranges to re-cover.
 */

export const TEST_CODE = `E44-SPARSE-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
/** Per-run point keys, so two instances of this file never read each other's rows. */
const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const SPARSE = `e44_sparse_${RUN}`;
const DENSE = `e44_dense_${RUN}`;
const CLIP_HEAD = `e44_clip_head_${RUN}`;
const CLIP_TAIL = `e44_clip_tail_${RUN}`;
const CLIP_BOTH = `e44_clip_both_${RUN}`;
const HOURLY = `e44_hourly_${RUN}`;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** The window's length and how many of its leading days hold samples. */
const WINDOW_DAYS = 10;
const COVERED_DAYS = 7;
const WINDOW_MINUTES = WINDOW_DAYS * 1440;

/** The fixture's instants, computed BEFORE the seed so that `cleanup` can
 * re-cover both ranges even when the seed throws after its asset insert
 * (code review finding 5): the wrapper holds these from the start, not the
 * seed's return value. */
export type SparseAnchors = {
  /** The clock reading every range below is derived from. */
  readonly nowMs: number;
  /** `floor_1d(now) − 60 d`, epoch ms: the month's start. */
  readonly sMs: number;
  /** `floor_1h(now) − 3 h`, epoch ms: the hour-floor cases' anchor. */
  readonly hMs: number;
};

export type SparseFixture = SparseAnchors & {
  readonly assetId: string;
};

export function sparseAnchors(nowMs: number): SparseAnchors {
  return {
    nowMs,
    sMs: Math.floor(nowMs / DAY_MS) * DAY_MS - 60 * DAY_MS,
    hMs: Math.floor(nowMs / HOUR_MS) * HOUR_MS - 3 * HOUR_MS,
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function cleanup(pool: pg.Pool, anchors?: SparseAnchors): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM bms.assets WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [ids]);
  }
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  if (anchors) {
    // the `0027` standing obligation: the deleted rows' buckets are re-covered
    // so the materialized views forget them too
    await materializeCompleteBuckets(pool, anchors.sMs, anchors.sMs + WINDOW_DAYS * DAY_MS, Date.now());
    await materializeCompleteBuckets(pool, anchors.hMs - HOUR_MS, anchors.hMs + 2 * HOUR_MS, Date.now());
  }
}

export async function seedSparseFixture(pool: pg.Pool, fx: Fixtures, anchors: SparseAnchors): Promise<SparseFixture> {
  const db = createDb(pool);
  const { nowMs, sMs, hMs } = anchors;

  const { rows: foreign } = await pool.query<{ organization_id: string }>(`SELECT organization_id FROM bms.locations WHERE id = $1`, [
    fx.foreignLocationId,
  ]);
  assert(foreign.length === 1, "the foreign fixture location must exist");
  const created = await db
    .insert(assets)
    .values({
      code: `${TEST_CODE}-A`,
      name: "Calc window sparse fixture",
      siteName: "Calc window sparse fixture site",
      organizationId: foreign[0].organization_id,
      locationId: fx.foreignLocationId,
      domain: "electrical",
      templateId: null,
      active: true,
    })
    .returning({ id: assets.id });
  const assetId = created[0].id;

  const values: { key: string; timeMs: number }[] = [];
  // SPARSE: one sample per hour on days 0–6, nothing on days 7–9.
  // DENSE: one sample per hour on all ten days.
  for (let hour = 0; hour < WINDOW_DAYS * 24; hour += 1) {
    const timeMs = sMs + hour * HOUR_MS + 30 * MINUTE_MS;
    values.push({ key: DENSE, timeMs });
    if (hour < COVERED_DAYS * 24) {
      values.push({ key: SPARSE, timeMs });
    }
  }
  // the hour-floor cases, at 5m resolution
  const at = (minutes: number): number => hMs + minutes * MINUTE_MS;
  const head = [at(20), at(40)]; // two 5m buckets in ONE hour (H)
  const tail = [at(65), at(85)]; // H+1:05 inside the window, H+1:25 after it
  for (const timeMs of head) values.push({ key: CLIP_HEAD, timeMs });
  for (const timeMs of tail) values.push({ key: CLIP_TAIL, timeMs });
  for (const timeMs of [...head, ...tail]) values.push({ key: CLIP_BOTH, timeMs });
  // S6: one sample in each of hours H−1, H and H+1 — inside the range the
  // second refresh below already re-covers
  for (const timeMs of [at(-30), at(30), at(90)]) values.push({ key: HOURLY, timeMs });

  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT * FROM unnest($1::timestamptz[], $2::uuid[], $3::varchar[], $4::double precision[], $5::varchar[])`,
    [
      values.map((v) => new Date(v.timeMs).toISOString()),
      values.map(() => assetId),
      values.map((v) => v.key),
      values.map(() => 10),
      values.map(() => "x"),
    ],
  );
  await materializeCompleteBuckets(pool, sMs, sMs + WINDOW_DAYS * DAY_MS, nowMs);
  await materializeCompleteBuckets(pool, hMs - HOUR_MS, hMs + 2 * HOUR_MS, nowMs);

  return { ...anchors, assetId };
}

// ---- helpers (copied from calc-windows.integration.spec.ts; see the file docblock) ----

type Counted = { service: CalcWindowsService; statements: () => number; relations: () => string[] };

/** A service over the fixture pool whose statements are counted — both the
 * tenant-pool reads and the fleet Drizzle execute — and whose relations are
 * recorded off the SQL text. */
function countedService(pool: pg.Pool): Counted {
  let statements = 0;
  const relations: string[] = [];
  const note = (text: string): void => {
    statements += 1;
    for (const m of text.matchAll(/telemetry\.point_values(_1m|_5m|_1h|_1d)?/g)) {
      relations.push(m[0]);
    }
  };
  const countingPool = {
    query: (text: string, params?: unknown[]) => {
      note(text);
      return pool.query(text, params);
    },
  } as unknown as pg.Pool;
  const db = createDb(pool);
  const countingDb = {
    execute: (query: unknown) => {
      statements += 1;
      return (db.execute as (q: unknown) => Promise<unknown>)(query);
    },
  } as unknown as ReturnType<typeof createDb>;
  return {
    service: new CalcWindowsService(countingPool, countingDb),
    statements: () => statements,
    relations: () => [...relations],
  };
}

function windowFn(fn: CalcWindowFn["fn"], pointKey: string, window: CalcWindowRead["window"]): CalcWindowFn {
  return { kind: "window", fn, ref: { kind: "ref", pointKey, position: 0 }, window, position: 0 };
}
const rolling = (minutes: number): CalcWindowRead["window"] => ({ kind: "rolling", minutes });

async function resolveOne(pool: pg.Pool, ownerAssetId: string, node: CalcWindowRead, endMs: number): Promise<WindowReadResult | undefined> {
  const request: WindowReadRequest = { ownerAssetId, readAssetId: ownerAssetId, node, endMs };
  const map = await new CalcWindowsService(pool, createDb(pool)).resolveReads([request]);
  return map.get(windowRequestKey(ownerAssetId, node, endMs));
}

const near = (actual: number, expected: number): boolean => Math.abs(actual - expected) < 1e-6;

const monthTick = (fixture: SparseFixture): number => fixture.sMs + WINDOW_DAYS * DAY_MS;
const monthRead = (pool: pg.Pool, fixture: SparseFixture, fn: CalcWindowFn["fn"], key: string): Promise<WindowReadResult | undefined> =>
  resolveOne(pool, fixture.assetId, windowFn(fn, key, rolling(WINDOW_MINUTES)), monthTick(fixture));

/** The hour-floor window `[H:15, H+1:15)`, a rolling 60 minutes ending at H+1:15. */
const clipTick = (fixture: SparseFixture): number => fixture.hMs + 75 * MINUTE_MS;

// ---- S1 / S2 — the sparse month refuses, the dense month answers ----------------------------

export async function assertASparseMonthRefusesWindowSparse(pool: pg.Pool, fixture: SparseFixture): Promise<void> {
  const result = await monthRead(pool, fixture, "sum", SPARSE);
  // 7 covered days of 10: 168 / 240 h = 70% < 90%
  assert(result !== undefined && result.ok === false && result.reason === "window_sparse", `S1: sum over ten days with three dark days refuses window_sparse, got ${JSON.stringify(result)}`);
}

export async function assertADenseMonthAnswers(pool: pg.Pool, fixture: SparseFixture): Promise<void> {
  const result = await monthRead(pool, fixture, "sum", DENSE);
  // avg 10 × 240 h
  assert(result !== undefined && result.ok === true && near(result.value, 2400), `S2: sum over the dense ten days answers 10 × 240 = 2400, got ${JSON.stringify(result)}`);
}

// ---- S3 — avg, min, max and delta are not guarded ---------------------------------------------

export async function assertAvgOverTheSparseMonthAnswers(pool: pg.Pool, fixture: SparseFixture): Promise<void> {
  const result = await monthRead(pool, fixture, "avg", SPARSE);
  assert(result !== undefined && result.ok === true && near(result.value, 10), `S3a: avg over the sparse month answers 10, got ${JSON.stringify(result)}`);
}

export async function assertMinOverTheSparseMonthAnswers(pool: pg.Pool, fixture: SparseFixture): Promise<void> {
  const result = await monthRead(pool, fixture, "min", SPARSE);
  assert(result !== undefined && result.ok === true && result.value === 10, `S3b: min over the sparse month answers 10, got ${JSON.stringify(result)}`);
}

export async function assertMaxOverTheSparseMonthAnswers(pool: pg.Pool, fixture: SparseFixture): Promise<void> {
  const result = await monthRead(pool, fixture, "max", SPARSE);
  assert(result !== undefined && result.ok === true && result.value === 10, `S3c: max over the sparse month answers 10, got ${JSON.stringify(result)}`);
}

export async function assertDeltaOverTheSparseMonthAnswers(pool: pg.Pool, fixture: SparseFixture): Promise<void> {
  const result = await monthRead(pool, fixture, "delta", SPARSE);
  assert(result !== undefined && result.ok === true && result.value === 0, `S3d: delta over the sparse month answers 10 − 10 = 0, got ${JSON.stringify(result)}`);
}

// ---- S4 — no statement is added ---------------------------------------------------------------

export async function assertTheSparseBatchRunsTwoStatements(pool: pg.Pool, fixture: SparseFixture): Promise<void> {
  const counted = countedService(pool);
  const node = windowFn("sum", SPARSE, rolling(WINDOW_MINUTES));
  const tick = monthTick(fixture);
  const map = await counted.service.resolveReads([{ ownerAssetId: fixture.assetId, readAssetId: fixture.assetId, node, endMs: tick }]);
  // positive control first: the read reached the level statement and was refused by coverage
  const result = map.get(windowRequestKey(fixture.assetId, node, tick));
  assert(result?.ok === false && result.reason === "window_sparse", `S4 control: the read is window_sparse, got ${JSON.stringify(result)}`);
  assert(
    counted.statements() === 2 && counted.relations().join(",") === "telemetry.point_values_1d",
    `S4: the watermarks and one 1d level statement, and no other relation — got ${counted.statements()} statements reading ${counted.relations().join(",")}`,
  );
}

// ---- S5 — the one-hour floor, clipped to the segment ---------------------------------------------

export async function assertTheHourFloorClipsTheHead(pool: pg.Pool, fixture: SparseFixture): Promise<void> {
  const result = await resolveOne(pool, fixture.assetId, windowFn("sum", CLIP_HEAD, rolling(60)), clipTick(fixture));
  // hour H covered, clipped to H:15–H+1:00 → 0.75 h of 1 h
  assert(result !== undefined && result.ok === false && result.reason === "window_sparse", `S5a: two buckets in the head hour cover 45 min of the hour → window_sparse, got ${JSON.stringify(result)}`);
}

export async function assertTheHourFloorClipsTheTail(pool: pg.Pool, fixture: SparseFixture): Promise<void> {
  const result = await resolveOne(pool, fixture.assetId, windowFn("sum", CLIP_TAIL, rolling(60)), clipTick(fixture));
  // hour H+1 covered, clipped to H+1:00–H+1:15 → 0.25 h of 1 h
  assert(result !== undefined && result.ok === false && result.reason === "window_sparse", `S5b: a bucket in the tail hour covers 15 min of the hour → window_sparse, got ${JSON.stringify(result)}`);
}

export async function assertBothHoursCoveredAnswers(pool: pg.Pool, fixture: SparseFixture): Promise<void> {
  const result = await resolveOne(pool, fixture.assetId, windowFn("sum", CLIP_BOTH, rolling(60)), clipTick(fixture));
  // 45 min + 15 min = the whole hour; the three in-window samples average 10, × 1 h
  assert(result !== undefined && result.ok === true && near(result.value, 10), `S5c: both hours covered → the window answers 10 × 1 h, got ${JSON.stringify(result)}`);
}

// ---- S6 — the 1h coverage unit (code review finding 2) --------------------------------------------

/**
 * A rolling 180 minutes ending at H+2h — `[H−1h, H+2h)`, three whole clock
 * hours, one sample in each. The seed's second refresh re-covers
 * `[H−1h, H+2h)` and H+2h is a complete hour before `now`, so the `1h`
 * watermark is at H+2h or later and the planner serves the whole window from
 * `1h`: one `1h` level statement. The relation check is exact, as S4's is — a
 * window split between `1h` and `5m` would let the `1h` part hide a wrong
 * coverage unit. Under `'1 day'` for `1h` the three hours collapse into one
 * or two distinct days, 1/3 or 2/3 of the window, and the sum refuses.
 */
export async function assertThreeCoveredHoursOn1hAnswers(pool: pg.Pool, fixture: SparseFixture): Promise<void> {
  const counted = countedService(pool);
  const node = windowFn("sum", HOURLY, rolling(180));
  const tick = fixture.hMs + 2 * HOUR_MS;
  const map = await counted.service.resolveReads([{ ownerAssetId: fixture.assetId, readAssetId: fixture.assetId, node, endMs: tick }]);
  // positive control first: 3 covered hours of 3, avg 10 × 3 h
  const result = map.get(windowRequestKey(fixture.assetId, node, tick));
  assert(result?.ok === true && near(result.value, 30), `S6: three covered hours of three on 1h answer 10 × 3 = 30, got ${JSON.stringify(result)}`);
  assert(
    counted.statements() === 2 && counted.relations().join(",") === "telemetry.point_values_1h",
    `S6: the read is served from 1h alone — got ${counted.statements()} statements reading ${counted.relations().join(",")}`,
  );
}
