import { randomUUID } from "node:crypto";

import type pg from "pg";

import { assets, createDb } from "@bms/db";
import type { CalcWindowFn, CalcWindowRead } from "@bms/shared";

import type { Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { materializeCompleteBuckets } from "../testing/cagg-materialize";
import { windowEndMs } from "./calc-window-plan";
import { CalcWindowsService, windowRequestKey, type WindowReadRequest, type WindowReadResult } from "./calc-windows.service";

/**
 * `E4.1b` U8 — `CalcWindowsService` against a real database with real
 * continuous aggregates (ADR 0070 decisions 5 and 6). The three guards the
 * backlog row names are W1 (IST across 18:30 UTC), W2 (`sum` is the time
 * integral, not `Σ sum_value`) and W7 (a month-to-date value includes the
 * rows behind the `1d` watermark); each is one `it()` with a run mutation.
 *
 * **The fixture sits in the past on purpose.** `D = floor_1d(now) − 2 d`,
 * so every `D`/`D−1` row is behind all four watermarks and the composition
 * rule is exercised; those rows are invisible in the views until
 * `materializeCompleteBuckets` re-covers their buckets, and are made
 * invisible again after the delete (design decision 16). The two "tail" rows
 * of W7 are minutes old — after `floor_1d(now)` — and the helper's clip keeps
 * them UNmaterialized at `1d`, which is what guard (c) is about.
 *
 * Three assets on the shared fixture's three locations, whose zones this
 * suite sets for its duration and restores:
 *
 * - **K** at `fx.rtuLocationId`, zone `Asia/Kolkata` — the IST guard.
 * - **N** at `fx.otherLocationId`, zone `NULL` — `timezone_unset`.
 * - **U** at `fx.foreignLocationId`, zone `Etc/UTC` — the calendar cases
 *   whose expected values are computed in UTC.
 *
 * The `.test.ts` wrapper pins `TZ` to a half-hour zone that is none of these,
 * so a `Date` component read anywhere in the code under test reddens.
 */

export const TEST_CODE = `E41B-WIN-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
/** Per-run point keys, so two instances of this file never read each other's rows. */
const KWH = `e41b_kwh_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const KW = `e41b_kw_${randomUUID().replace(/-/g, "").slice(0, 8)}`;

export type WindowsFixture = {
  readonly k: string;
  readonly n: string;
  readonly u: string;
  /** `floor_1d(now) − 2 d`, epoch ms. */
  readonly dMs: number;
  /** The two tail rows' instants (today), epoch ms. */
  readonly tailMs: readonly number[];
  /** Every `KW` row on U, `[timeMs, value]`, for expected means. */
  readonly kwRowsU: readonly [number, number][];
  readonly priorZones: ReadonlyMap<string, string | null>;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const DAY_MS = 86_400_000;
const utc = (iso: string): number => Date.parse(iso);
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const at = (dayMs: number, hhmm: string): number => utc(`${isoDay(dayMs)}T${hhmm}:00Z`);

export async function cleanup(pool: pg.Pool, fixture?: WindowsFixture): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM bms.assets WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [ids]);
  }
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  if (fixture) {
    for (const [locationId, zone] of fixture.priorZones) {
      await pool.query(`UPDATE bms.locations SET timezone = $2 WHERE id = $1`, [locationId, zone]);
    }
    // the `0027` standing obligation: the deleted rows' buckets are re-covered
    // so the materialized views forget them too
    await materializeCompleteBuckets(pool, fixture.dMs - DAY_MS, Date.now(), Date.now());
  }
}

export async function seedWindowsFixture(pool: pg.Pool, fx: Fixtures): Promise<WindowsFixture> {
  const db = createDb(pool);
  const nowMs = Date.now();
  const dMs = Math.floor(nowMs / DAY_MS) * DAY_MS - 2 * DAY_MS;

  const { rows: zoneRows } = await pool.query<{ id: string; timezone: string | null }>(
    `SELECT id, timezone FROM bms.locations WHERE id = ANY($1::uuid[])`,
    [[fx.rtuLocationId, fx.otherLocationId, fx.foreignLocationId]],
  );
  const priorZones = new Map(zoneRows.map((row) => [row.id, row.timezone]));
  assert(priorZones.size === 3, "the three fixture locations must exist");
  await pool.query(`UPDATE bms.locations SET timezone = 'Asia/Kolkata' WHERE id = $1`, [fx.rtuLocationId]);
  await pool.query(`UPDATE bms.locations SET timezone = NULL WHERE id = $1`, [fx.otherLocationId]);
  await pool.query(`UPDATE bms.locations SET timezone = 'Etc/UTC' WHERE id = $1`, [fx.foreignLocationId]);

  const { rows: foreign } = await pool.query<{ organization_id: string }>(`SELECT organization_id FROM bms.locations WHERE id = $1`, [
    fx.foreignLocationId,
  ]);
  const asset = (suffix: string, locationId: string, organizationId = fx.organizationId) => ({
    code: `${TEST_CODE}-${suffix}`,
    name: `Calc windows fixture ${suffix}`,
    siteName: "Calc windows fixture site",
    organizationId,
    locationId,
    domain: "electrical",
    templateId: null,
    active: true,
  });
  const created = await db
    .insert(assets)
    .values([asset("K", fx.rtuLocationId), asset("N", fx.otherLocationId), asset("U", fx.foreignLocationId, foreign[0].organization_id)])
    .returning({ id: assets.id, code: assets.code });
  const byCode = new Map(created.map((row) => [row.code, row.id]));
  const k = byCode.get(`${TEST_CODE}-K`) as string;
  const n = byCode.get(`${TEST_CODE}-N`) as string;
  const u = byCode.get(`${TEST_CODE}-U`) as string;

  const dMinus1 = dMs - DAY_MS;
  // W1 — a cumulative counter on K around IST midnight (18:30Z) of day D−1
  const kwhK: [number, number][] = [
    [at(dMinus1, "17:00"), 100],
    [at(dMinus1, "18:00"), 110],
    [at(dMinus1, "18:29"), 120],
    [at(dMinus1, "18:31"), 130],
    [at(dMinus1, "19:00"), 150],
    [at(dMinus1, "20:00"), 200],
    // exactly at W1's window end: OUTSIDE the half-open window (a `<=` on the
    // delta probes' end bound would read 999 − 130 instead of 200 − 130)
    [at(dMinus1, "20:30"), 999],
  ];
  // W2/W3 — ten samples of 100 early on day D and one of 200 late, on U
  const kwU: [number, number][] = [
    ...Array.from({ length: 10 }, (_, i): [number, number] => [at(dMs, `00:${String(i + 1).padStart(2, "0")}`), 100]),
    [at(dMs, "23:00"), 200],
  ];
  // W5 — one lone sample on N (a one-sample delta)
  const kwhN: [number, number][] = [[at(dMs, "12:00"), 5]];
  // W7 — two rows today, after floor_1d(now): never materialized at 1d
  const endNow = windowEndMs(nowMs, 60);
  const tail0 = Math.max(Math.floor(nowMs / DAY_MS) * DAY_MS, endNow - 120_000);
  const tailMs = [tail0, tail0 + 30_000];
  const kwTail: [number, number][] = tailMs.map((t) => [t, 300]);

  const values: { assetId: string; key: string; timeMs: number; value: number }[] = [
    ...kwhK.map(([timeMs, value]) => ({ assetId: k, key: KWH, timeMs, value })),
    ...kwU.map(([timeMs, value]) => ({ assetId: u, key: KW, timeMs, value })),
    ...kwhN.map(([timeMs, value]) => ({ assetId: n, key: KWH, timeMs, value })),
    ...kwTail.map(([timeMs, value]) => ({ assetId: u, key: KW, timeMs, value })),
  ];
  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT * FROM unnest($1::timestamptz[], $2::uuid[], $3::varchar[], $4::double precision[], $5::varchar[])`,
    [
      values.map((v) => new Date(v.timeMs).toISOString()),
      values.map((v) => v.assetId),
      values.map((v) => v.key),
      values.map((v) => v.value),
      values.map(() => "x"),
    ],
  );
  await materializeCompleteBuckets(pool, dMinus1, nowMs, nowMs);

  return { k, n, u, dMs, tailMs, kwRowsU: [...kwU, ...kwTail], priorZones };
}

// ---- helpers ----------------------------------------------------------------------

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
const calendar = (period: "today" | "this_week" | "this_month" | "this_year"): CalcWindowRead["window"] => ({ kind: "calendar", period });

async function resolveOne(pool: pg.Pool, ownerAssetId: string, node: CalcWindowRead, endMs: number): Promise<WindowReadResult | undefined> {
  const request: WindowReadRequest = { ownerAssetId, readAssetId: ownerAssetId, node, endMs };
  const map = await new CalcWindowsService(pool, createDb(pool)).resolveReads([request]);
  return map.get(windowRequestKey(ownerAssetId, node, endMs));
}

const near = (actual: number, expected: number): boolean => Math.abs(actual - expected) < 1e-6;
const mean = (rows: readonly [number, number][]): number => rows.reduce((s, [, v]) => s + v, 0) / rows.length;

// ---- W1 — guard (a): IST across 18:30 UTC -----------------------------------------------

export async function assertDeltaTodayAcrossIstMidnight(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  const tick = at(fixture.dMs - DAY_MS, "20:30");
  const result = await resolveOne(pool, fixture.k, windowFn("delta", KWH, calendar("today")), tick);
  // window [D−1 18:30Z, 20:30Z): first 18:31Z = 130, last 20:00Z = 200.
  // Wrong boundaries give distinct neighbours: a UTC-day start → 100 (from
  // 17:00Z), a start floored to the hour → 90 (from 18:00Z), ceiled → 50.
  assert(result !== undefined && result.ok === true && result.value === 70, `W1: delta({kwh}, today) at an IST site is 70, got ${JSON.stringify(result)}`);
}

export async function assertHoursTodayAtIstSite(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  const tick = at(fixture.dMs - DAY_MS, "20:30");
  const hours: CalcWindowRead = { kind: "hours", window: calendar("today"), position: 0 };
  const result = await resolveOne(pool, fixture.k, hours, tick);
  assert(result !== undefined && result.ok === true && result.value === 2, `W1b: hours(today) at 02:00 IST is 2, got ${JSON.stringify(result)}`);
}

export async function assertAvgTodayAtIstSiteIsAlignedToTheIstDay(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  const tick = at(fixture.dMs - DAY_MS, "20:30");
  const result = await resolveOne(pool, fixture.k, windowFn("avg", KWH, calendar("today")), tick);
  // the three rows inside [18:30Z, 20:30Z): 130, 150, 200 → 160. A read that
  // took whole UTC days (a 1d bucket alone) has no bucket inside an IST day
  // and answers window_empty; one that took the UTC day would average all six.
  assert(result !== undefined && result.ok === true && near(result.value, 160), `W1c: avg({kwh}, today) at an IST site is the mean of the three rows after 18:30Z (160), got ${JSON.stringify(result)}`);
}

// ---- W2 — guard (b): sum is the time integral ---------------------------------------------

export async function assertSumIsTheTimeIntegral(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  const tick = fixture.dMs + DAY_MS;
  const result = await resolveOne(pool, fixture.u, windowFn("sum", KW, rolling(1440)), tick);
  // Σ sum_value = 1200 over 11 samples → avg 109.09…, × 24 h = 2618.18…
  assert(result !== undefined && result.ok === true && near(result.value, 2618.181818), `W2: sum({kw}, 24h) is avg × 24 = 2618.18…, got ${JSON.stringify(result)}`);
}

export async function assertAvgIsSumOverCount(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  const tick = fixture.dMs + DAY_MS;
  const result = await resolveOne(pool, fixture.u, windowFn("avg", KW, rolling(1440)), tick);
  assert(result !== undefined && result.ok === true && near(result.value, 109.090909), `W2b: avg({kw}, 24h) is 109.09…, got ${JSON.stringify(result)}`);
}

export async function assertSumIsNotTheSampleSum(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  // positive control: the 1d view does hold Σ sum_value = 1200 for day D
  const { rows } = await pool.query<{ sum_value: number; sample_count: string }>(
    `SELECT sum_value, sample_count FROM telemetry.point_values_1d WHERE asset_id = $1 AND point_key = $2 AND bucket = $3::timestamptz`,
    [fixture.u, KW, new Date(fixture.dMs).toISOString()],
  );
  assert(rows.length === 1 && Number(rows[0].sum_value) === 1200 && Number(rows[0].sample_count) === 11, `W2c control: the 1d row for day D holds Σ 1200 over 11, got ${JSON.stringify(rows)}`);
  const result = await resolveOne(pool, fixture.u, windowFn("sum", KW, rolling(1440)), fixture.dMs + DAY_MS);
  assert(result !== undefined && result.ok === true && result.value !== 1200, `W2c: sum({kw}, 24h) is not Σ sum_value, got ${JSON.stringify(result)}`);
}

// ---- W3 — min and max -------------------------------------------------------------------------

export async function assertMinAndMaxOverTheDay(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  const tick = fixture.dMs + DAY_MS;
  const min = await resolveOne(pool, fixture.u, windowFn("min", KW, rolling(1440)), tick);
  const max = await resolveOne(pool, fixture.u, windowFn("max", KW, rolling(1440)), tick);
  assert(min !== undefined && min.ok === true && min.value === 100, `W3: min is 100, got ${JSON.stringify(min)}`);
  assert(max !== undefined && max.ok === true && max.value === 200, `W3: max is 200, got ${JSON.stringify(max)}`);
}

// ---- W4 / W5 — window_empty ------------------------------------------------------------------------

export async function assertNoSampleInsideTheWindowIsEmpty(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  // a 24h window ending at D 00:00 holds none of U's rows (they start at D 00:01)
  const empty = await resolveOne(pool, fixture.u, windowFn("avg", KW, rolling(1440)), fixture.dMs);
  assert(empty !== undefined && empty.ok === false && empty.reason === "window_empty", `W4: a window with no sample is window_empty, got ${JSON.stringify(empty)}`);
  // positive control: the window widened by a day holds them
  const wide = await resolveOne(pool, fixture.u, windowFn("avg", KW, rolling(2880)), fixture.dMs + DAY_MS);
  assert(wide !== undefined && wide.ok === true, `W4 control: the widened window has a value, got ${JSON.stringify(wide)}`);
}

export async function assertADeltaOverOneSampleIsEmpty(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  const one = await resolveOne(pool, fixture.n, windowFn("delta", KWH, rolling(1440)), fixture.dMs + DAY_MS);
  assert(one !== undefined && one.ok === false && one.reason === "window_empty", `W5: delta over one sample is window_empty, got ${JSON.stringify(one)}`);
  // positive control: the same shape over K's six samples has a value
  const seven = await resolveOne(pool, fixture.k, windowFn("delta", KWH, rolling(1440)), fixture.dMs);
  assert(seven !== undefined && seven.ok === true && seven.value === 899, `W5 control: delta over K's seven samples is 999 − 100, got ${JSON.stringify(seven)}`);
}

// ---- W6 — timezone_unset ------------------------------------------------------------------------------

export async function assertACalendarWindowWithNoZoneRefuses(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  const tick = fixture.dMs + DAY_MS;
  const nNode = windowFn("delta", KWH, calendar("today"));
  const kNode = windowFn("delta", KWH, calendar("today"));
  const kTick = at(fixture.dMs - DAY_MS, "20:30");
  const map = await new CalcWindowsService(pool, createDb(pool)).resolveReads([
    { ownerAssetId: fixture.n, readAssetId: fixture.n, node: nNode, endMs: tick },
    { ownerAssetId: fixture.k, readAssetId: fixture.k, node: kNode, endMs: kTick },
  ]);
  const n = map.get(windowRequestKey(fixture.n, nNode, tick));
  assert(n !== undefined && n.ok === false && n.reason === "timezone_unset", `W6: a calendar window at a NULL-zone location is timezone_unset, got ${JSON.stringify(n)}`);
  const k = map.get(windowRequestKey(fixture.k, kNode, kTick));
  assert(k !== undefined && k.ok === true && k.value === 70, `W6b: the Kolkata read in the same call is unaffected, got ${JSON.stringify(k)}`);
  // a rolling window at the same location needs no zone
  const rollingN = await resolveOne(pool, fixture.n, windowFn("max", KWH, rolling(1440)), tick);
  assert(rollingN !== undefined && rollingN.ok === true && rollingN.value === 5, `W6c: a rolling window at a NULL-zone location has a value, got ${JSON.stringify(rollingN)}`);
}

export async function assertAnUnknownStoredZoneRefusesNotThrows(pool: pg.Pool, fixture: WindowsFixture, fx: Fixtures): Promise<void> {
  // written directly, bypassing the admin validator (a zone the server's tzdata
  // no longer knows would look exactly like this)
  await pool.query(`UPDATE bms.locations SET timezone = 'Not/AZone' WHERE id = $1`, [fx.otherLocationId]);
  try {
    const result = await resolveOne(pool, fixture.n, windowFn("delta", KWH, calendar("today")), fixture.dMs + DAY_MS);
    assert(result !== undefined && result.ok === false && result.reason === "timezone_unset", `W6d: an unknown stored zone is timezone_unset, not a thrown batch, got ${JSON.stringify(result)}`);
  } finally {
    await pool.query(`UPDATE bms.locations SET timezone = NULL WHERE id = $1`, [fx.otherLocationId]);
  }
}

// ---- W7 — guard (c): the tail behind the 1d watermark ----------------------------------------------------

export async function assertThisMonthIncludesTheTailBehindThe1dWatermark(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  const nowMs = Date.now();
  const tick = windowEndMs(nowMs, 60);
  // positive controls: the tail rows exist in raw and are NOT in the 1d view's
  // materialized hypertable (only the live branch can serve them)
  const { rows: raw } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM telemetry.point_values WHERE asset_id = $1 AND point_key = $2 AND time >= $3::timestamptz`, [
    fixture.u,
    KW,
    new Date(fixture.tailMs[0]).toISOString(),
  ]);
  assert(Number(raw[0].n) === 2, `W7a control: the two tail rows are in raw, got ${raw[0].n}`);
  // the 1d view's materialization hypertable, resolved by name — its id is
  // assigned in creation order and differs between databases
  const { rows: hyper } = await pool.query<{ name: string }>(
    `SELECT materialization_hypertable_name AS name FROM timescaledb_information.continuous_aggregates WHERE view_name = 'point_values_1d'`,
  );
  assert(hyper.length === 1 && /^_materialized_hypertable_\d+$/.test(hyper[0].name), `W7a control: the 1d view has a materialization hypertable, got ${JSON.stringify(hyper)}`);
  const { rows: mat } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM _timescaledb_internal.${hyper[0].name} WHERE asset_id = $1 AND point_key = $2 AND bucket >= $3::timestamptz`,
    [fixture.u, KW, new Date(Math.floor(nowMs / DAY_MS) * DAY_MS).toISOString()],
  );
  assert(Number(mat[0].n) === 0, `W7a control: today's bucket is not materialized at 1d, got ${mat[0].n}`);

  const monthStart = utc(`${new Date(tick).toISOString().slice(0, 7)}-01T00:00:00Z`);
  const inWindow = fixture.kwRowsU.filter(([t]) => t >= monthStart && t < tick);
  assert(inWindow.some(([t]) => t >= fixture.tailMs[0]), "W7a precondition: the tail rows fall inside this_month at the tick");
  const result = await resolveOne(pool, fixture.u, windowFn("avg", KW, calendar("this_month")), tick);
  assert(
    result !== undefined && result.ok === true && near(result.value, mean(inWindow)),
    `W7a: avg({kw}, this_month) is the mean over every row in the month INCLUDING the two tail rows (${mean(inWindow)}), got ${JSON.stringify(result)}`,
  );
  // and the mean without the tail is a different number, so the assertion above discriminates
  const withoutTail = inWindow.filter(([t]) => t < fixture.tailMs[0]);
  assert(withoutTail.length === 0 || !near(mean(withoutTail), mean(inWindow)), "W7a: the tail rows change the mean");
}

export async function assertARollingWeekReadsThe1dViewAndTodayDoesNot(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  const nowMs = Date.now();
  const tick = windowEndMs(nowMs, 60);
  const week = countedService(pool);
  const weekNode = windowFn("avg", KW, rolling(7 * 1440));
  const weekMap = await week.service.resolveReads([{ ownerAssetId: fixture.u, readAssetId: fixture.u, node: weekNode, endMs: tick }]);
  const weekResult = weekMap.get(windowRequestKey(fixture.u, weekNode, tick));
  const inWeek = fixture.kwRowsU.filter(([t]) => t >= tick - 7 * DAY_MS && t < tick);
  assert(
    weekResult !== undefined && weekResult.ok === true && near(weekResult.value, mean(inWeek)),
    `W7b: avg({kw}, 7d) is the mean over day D and the tail (${mean(inWeek)}), got ${JSON.stringify(weekResult)}`,
  );
  assert(week.relations().includes("telemetry.point_values_1d"), `W7b: a 7d window reads the 1d view for its whole days, read ${week.relations().join(",")}`);
  assert(!week.relations().includes("telemetry.point_values"), "W7b: an aggregate window never reads raw rows");

  const today = countedService(pool);
  const todayNode = windowFn("avg", KW, calendar("today"));
  const todayMap = await today.service.resolveReads([{ ownerAssetId: fixture.u, readAssetId: fixture.u, node: todayNode, endMs: tick }]);
  // positive control first (post-merge sweep): a refused read runs no level
  // statement, so the absence claim below would pass having observed nothing
  const todayResult = todayMap.get(windowRequestKey(fixture.u, todayNode, tick));
  assert(todayResult?.ok === true && near(todayResult.value, 300), `W7c control: the today read is served (the two tail rows, mean 300), got ${JSON.stringify(todayResult)}`);
  assert(today.relations().some((r) => r === "telemetry.point_values_1m" || r === "telemetry.point_values_5m" || r === "telemetry.point_values_1h"), `W7c control: a level statement ran, read ${today.relations().join(",")}`);
  assert(!today.relations().includes("telemetry.point_values_1d"), `W7c: a today window never reads the 1d view, read ${today.relations().join(",")}`);
}

// ---- W8 / W9 / W10 — batching, watermarks, empty ------------------------------------------------------------

export async function assertOneCallServesEveryReadInAtMostSevenStatements(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  const counted = countedService(pool);
  const tickK = at(fixture.dMs - DAY_MS, "20:30");
  const tickU = fixture.dMs + DAY_MS;
  const a = windowFn("delta", KWH, calendar("today"));
  const b = windowFn("sum", KW, rolling(1440));
  const c: CalcWindowRead = { kind: "hours", window: rolling(90), position: 0 };
  const map = await counted.service.resolveReads([
    { ownerAssetId: fixture.k, readAssetId: fixture.k, node: a, endMs: tickK },
    { ownerAssetId: fixture.u, readAssetId: fixture.u, node: b, endMs: tickU },
    { ownerAssetId: fixture.u, readAssetId: fixture.u, node: c, endMs: tickU },
    // a duplicate request is one read
    { ownerAssetId: fixture.u, readAssetId: fixture.u, node: b, endMs: tickU },
  ]);
  assert(map.size === 3, `W8: three distinct reads → three results, got ${map.size}`);
  const ra = map.get(windowRequestKey(fixture.k, a, tickK));
  const rb = map.get(windowRequestKey(fixture.u, b, tickU));
  const rc = map.get(windowRequestKey(fixture.u, c, tickU));
  assert(ra?.ok === true && ra.value === 70, `W8: the delta read, got ${JSON.stringify(ra)}`);
  assert(rb?.ok === true && near(rb.value, 2618.181818), `W8: the sum read, got ${JSON.stringify(rb)}`);
  assert(rc?.ok === true && rc.value === 1.5, `W8: hours(90m) is 1.5 with no row read, got ${JSON.stringify(rc)}`);
  assert(counted.statements() <= 7, `W8: at most seven statements per sweep, got ${counted.statements()}`);
}

export async function assertHoursAloneReadsNoRow(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  // the PR 2 security review's L1: an hours read once planned segments whose
  // dead rows entered the level statements; W8 could not see it because the
  // hours read shared its batch with a sum read
  const counted = countedService(pool);
  const node: CalcWindowRead = { kind: "hours", window: rolling(90), position: 0 };
  const tick = fixture.dMs + DAY_MS;
  const map = await counted.service.resolveReads([{ ownerAssetId: fixture.u, readAssetId: fixture.u, node, endMs: tick }]);
  const result = map.get(windowRequestKey(fixture.u, node, tick));
  assert(result?.ok === true && result.value === 1.5, `W8b: hours(90m) is 1.5, got ${JSON.stringify(result)}`);
  assert(counted.relations().length === 0, `W8b: an hours-only batch reads no relation at all, read ${counted.relations().join(",")}`);
  assert(counted.statements() === 1, `W8b: only the watermark statement runs for an hours-only batch, got ${counted.statements()}`);
}

/** W11 — the budget (security review M1, ruled fail closed): with the 1d and
 * 1h watermarks a week behind, a 366d read is refused as windows_unresolved
 * naming the watermarks, and a 24h read in the same batch is still served. */
export async function assertAStalledPolicyRefusesALongReadNotTheDatabase(pool: pg.Pool, fixture: WindowsFixture): Promise<void> {
  const tick = fixture.dMs + DAY_MS;
  // the watermark statement is answered with stalled instants (the 1d view
  // never refreshed, the 1h view a year behind); every other statement
  // reaches the database
  const stalledPool = {
    query: (text: string, params?: unknown[]) => {
      if (/cagg_watermark/.test(text)) {
        return Promise.resolve({
          rows: [
            { view_name: "point_values_1d", watermark: new Date(tick - 400 * DAY_MS) },
            { view_name: "point_values_1h", watermark: new Date(tick - 400 * DAY_MS) },
            { view_name: "point_values_5m", watermark: new Date(tick) },
            { view_name: "point_values_1m", watermark: new Date(tick) },
          ],
        });
      }
      return pool.query(text, params);
    },
  } as unknown as pg.Pool;
  const service = new CalcWindowsService(stalledPool, createDb(pool));
  const year = windowFn("avg", KW, rolling(366 * 1440));
  const day = windowFn("avg", KW, rolling(1440));
  const map = await service.resolveReads([
    { ownerAssetId: fixture.u, readAssetId: fixture.u, node: year, endMs: tick },
    { ownerAssetId: fixture.u, readAssetId: fixture.u, node: day, endMs: tick },
  ]);
  const refused = map.get(windowRequestKey(fixture.u, year, tick));
  assert(refused !== undefined && refused.ok === false && refused.reason === "windows_unresolved", `W11: the 366d read is refused, got ${JSON.stringify(refused)}`);
  if (refused && !refused.ok) {
    assert(/budget/.test(refused.detail ?? "") && /1d \d{4}-/.test(refused.detail ?? ""), `W11: the detail names the budget and the watermarks, got ${refused.detail}`);
  }
  const served = map.get(windowRequestKey(fixture.u, day, tick));
  assert(served !== undefined && served.ok === true && near(served.value, 109.090909), `W11: the 24h read in the same batch is served, got ${JSON.stringify(served)}`);
}

export async function assertTheWatermarksAreReadLive(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ view_name: string; watermark: Date }>(
    `SELECT c.view_name, _timescaledb_functions.to_timestamp(_timescaledb_functions.cagg_watermark(h.id)) AS watermark
       FROM timescaledb_information.continuous_aggregates c
       JOIN _timescaledb_catalog.hypertable h ON h.table_name = c.materialization_hypertable_name
      WHERE c.view_name LIKE 'point_values_%'`,
  );
  assert(rows.length === 4, `W9: four watermarks, got ${rows.length} — the internal function this Timescale (2.29) exposes is what the service reads; its fallback is now() - end_offset - schedule_interval from timescaledb_information.jobs`);
  const nowMs = Date.now();
  for (const row of rows) {
    const ms = new Date(row.watermark).getTime();
    assert(ms <= nowMs && ms > nowMs - 4 * DAY_MS, `W9: ${row.view_name}'s watermark is a recent instant, got ${row.watermark}`);
  }
}

export async function assertNoRequestsQueriesNothing(): Promise<void> {
  const throwing = {
    query: () => {
      throw new Error("must not query");
    },
  } as unknown as pg.Pool;
  const throwingDb = {
    execute: () => {
      throw new Error("must not execute");
    },
  } as unknown as ReturnType<typeof createDb>;
  const map = await new CalcWindowsService(throwing, throwingDb).resolveReads([]);
  assert(map.size === 0, "W10: no requests → no statement, an empty map");
}
