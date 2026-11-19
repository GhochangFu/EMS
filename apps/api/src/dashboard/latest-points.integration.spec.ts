import type pg from "pg";

import { materializeCompleteBuckets } from "../testing/cagg-materialize";
import { insertSampleBeforeNow, seedAsset, seedSite, type Site } from "./dashboard-freshness.integration.spec";
import { DashboardService } from "./dashboard.service";
import { discoverLatestPairs, planLatestPoints } from "./latest-points";

const NO_TARIFFS = { resolveForAssets: async () => new Map<string, number>() };
const NO_HEALTH = { scoresByLocation: async () => new Map<string, number | null>() };

/**
 * `F4.390` (plan §3 Task 1.2) — the two-step latest read against a real database: discovery from
 * `telemetry.point_values_1d`, then one day-literal-bounded lateral per group, must return exactly
 * the rows of the old unbounded `DISTINCT ON` read, which is kept verbatim below as the oracle.
 *
 * **Committed rows, not a rolled-back transaction.** A sample behind a watermark is invisible to
 * the aggregate until a refresh re-covers its bucket, and `refresh_continuous_aggregate` cannot run
 * inside a transaction. So the fixture is inserted, materialized once, read, then deleted and
 * materialized again (the `0027` standing obligation; the `calc-windows.integration` precedent).
 * `point_values` has no foreign key on `asset_id`, so synthetic ids suffice and no `bms.*` row is
 * written (the `calc-inputs.integration.spec.ts` pattern).
 */

/** In the id list: live, recent, old, NULL-unit, future and eight single-day keys. */
export const A1 = "43900000-4390-4390-8390-439000000a01";
/** In the id list: only old samples. */
export const A2 = "43900000-4390-4390-8390-439000000a02";
/** In the id list: silent, no rows at all. */
export const A3 = "43900000-4390-4390-8390-439000000a03";
/** Not in the id list: newer samples on A1's keys, which must never leak in. */
export const A4 = "43900000-4390-4390-8390-439000000a04";

const ALL = [A1, A2, A3, A4];
const SCOPED = [A1, A2, A3];

const S = 1_000;
const H = 3_600_000;
const D = 86_400_000;

/** 5 A1 keys + 8 single-day A1 keys + 2 A2 keys. */
const EXPECTED_ROWS = 15;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export interface LatestFixture {
  readonly fromMs: number;
  readonly nowMs: number;
}

interface Sample {
  readonly assetId: string;
  readonly pointKey: string;
  readonly offsetMs: number;
  readonly value: number;
  readonly unit: string | null;
}

function samples(): Sample[] {
  const s = (assetId: string, pointKey: string, offsetMs: number, value: number, unit: string | null = "u"): Sample => ({
    assetId,
    pointKey,
    offsetMs,
    value,
    unit,
  });
  const out: Sample[] = [
    s(A1, "f4390_live", -90 * S, 1),
    s(A1, "f4390_live", -30 * S, 2),
    s(A1, "f4390_live", -5 * S, 3),
    s(A1, "f4390_26h", -26 * H, 4),
    s(A1, "f4390_40d", -41 * D, 5),
    s(A1, "f4390_40d", -40 * D, 6),
    s(A1, "f4390_null_unit", -60 * S, 7, null),
    s(A1, "f4390_future", 2 * H, 8),
    s(A2, "f4390_20d", -20 * D, 9),
    s(A2, "f4390_40d", -40 * D, 10),
    s(A4, "f4390_live", -1 * S, 99),
    s(A4, "f4390_40d", -1 * S, 98),
    s(A4, "f4390_26h", -2 * S, 97),
  ];
  // Eight keys last seen on eight different days: more days than arms, so the merged arm runs.
  for (let day = 50; day <= 57; day += 1) {
    out.push(s(A1, `f4390_day_${day}`, -day * D, day));
  }
  return out;
}

export async function cleanup(pool: pg.Pool, fixture?: LatestFixture): Promise<void> {
  await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [ALL]);
  if (fixture) {
    await materializeCompleteBuckets(pool, fixture.fromMs, fixture.nowMs + D, Date.now());
  }
}

/** Inserts every sample, then materializes once over the whole span (complete buckets only). */
export async function seedLatestFixture(pool: pg.Pool): Promise<LatestFixture> {
  const nowMs = Date.now();
  const rows = samples();
  for (const row of rows) {
    await pool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES ($1::timestamptz, $2, $3, $4, $5)`,
      [new Date(nowMs + row.offsetMs).toISOString(), row.assetId, row.pointKey, row.value, row.unit],
    );
  }
  const fromMs = nowMs + Math.min(...rows.map((row) => row.offsetMs)) - D;
  await materializeCompleteBuckets(pool, fromMs, Date.now(), Date.now());
  return { fromMs, nowMs };
}

interface LatestRow {
  readonly asset_id: string;
  readonly point_key: string;
  readonly value: number | null;
  readonly unit: string | null;
  readonly time: string | null;
}

function sorted(rows: readonly LatestRow[]): LatestRow[] {
  const key = (row: LatestRow) => `${row.asset_id}|${row.point_key}`;
  return [...rows].sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
}

/** The pre-`F4.390` read, verbatim in shape: unbounded `DISTINCT ON` over the raw hypertable. */
async function oldRead(pool: pg.Pool, assetIds: readonly string[]): Promise<LatestRow[]> {
  const { rows } = await pool.query<LatestRow>(
    `SELECT DISTINCT ON (pv.asset_id, pv.point_key)
       pv.asset_id::text AS asset_id, pv.point_key, pv.value, pv.unit, pv.time::text AS time
     FROM telemetry.point_values pv
     WHERE pv.asset_id = ANY($1::uuid[])
     ORDER BY pv.asset_id, pv.point_key, pv.time DESC`,
    [assetIds],
  );
  return sorted(rows);
}

async function newRead(pool: pg.Pool, assetIds: readonly string[]): Promise<LatestRow[]> {
  const pairs = await discoverLatestPairs(pool, assetIds);
  const plan = planLatestPoints(pairs, 1);
  const { rows } = await pool.query<LatestRow>(
    `WITH ${plan.cteSql}
     SELECT asset_id::text AS asset_id, point_key, value, unit, time::text AS time
     FROM latest_points
     ORDER BY 1, 2`,
    [...plan.params],
  );
  return sorted(rows);
}

/**
 * The new read equals the old read on committed rows: live, a day old, weeks old, NULL unit,
 * future-stamped, more distinct days than arms, an asset with only old rows, a silent asset, and
 * newer rows on an asset outside the id list. Positive controls first, so an empty-equals-empty
 * pass cannot happen.
 */
export async function assertTheNewReadEqualsTheOldRead(pool: pg.Pool): Promise<void> {
  const oracle = await oldRead(pool, SCOPED);
  const got = await newRead(pool, SCOPED);

  assert(
    oracle.length === EXPECTED_ROWS,
    `the oracle must see the ${EXPECTED_ROWS} fixture pairs, got ${oracle.length} — the fixture did not land`,
  );
  assert(got.length === EXPECTED_ROWS, `the new read must return ${EXPECTED_ROWS} rows, got ${got.length}: ${JSON.stringify(got)}`);
  const a2Keys = got.filter((row) => row.asset_id === A2).map((row) => row.point_key).sort();
  assert(
    JSON.stringify(a2Keys) === JSON.stringify(["f4390_20d", "f4390_40d"]),
    `A2's two old keys must both be present, got ${JSON.stringify(a2Keys)}`,
  );
  assert(!got.some((row) => row.asset_id === A3), "the silent asset A3 must have no row");
  assert(!got.some((row) => row.asset_id === A4), "A4 is not in the id list and must have no row");
  const live = got.find((row) => row.asset_id === A1 && row.point_key === "f4390_live");
  assert(live?.value === 3, `A1/f4390_live must be the newest sample (3), got ${JSON.stringify(live)}`);
  const nullUnit = got.find((row) => row.asset_id === A1 && row.point_key === "f4390_null_unit");
  assert(nullUnit !== undefined && nullUnit.unit === null, `A1/f4390_null_unit must keep its NULL unit, got ${JSON.stringify(nullUnit)}`);

  assert(
    JSON.stringify(got) === JSON.stringify(oracle),
    `the new read must equal the old read row for row.\nold: ${JSON.stringify(oracle)}\nnew: ${JSON.stringify(got)}`,
  );
}

/** `asset_points` catalog row for `pointKey` (source kind defaults to `unmapped`). */
async function catalogPoint(client: pg.PoolClient, site: Site, assetId: string, pointKey: string): Promise<void> {
  await client.query(
    `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key)
     VALUES ($1, $2, $3, $3)`,
    [site.organizationId, assetId, pointKey],
  );
}

/**
 * Task 1.3 — `locationDashboard` end to end, in the caller's rolled-back transaction: asset X has
 * a catalogued `kw` (5 s old), an uncatalogued `zz_uncatalogued` (4 s old) and a catalogued `pf`
 * with no sample; asset Y is silent. X lists exactly the two reported keys, in the `telemetry`
 * CTE's order; Y lists none. It pins "no visible change", so it passes before the edit and after.
 * The samples are under 60 s old and inserted last: an older uncommitted row falls behind the
 * `_1m` watermark and the aggregate would not see it.
 */
export async function assertLocationDashboardListsReportedKeysOnly(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const x = await seedAsset(client, site, "X");
  const y = await seedAsset(client, site, "Y");
  await catalogPoint(client, site, x, "kw");
  await catalogPoint(client, site, x, "pf");
  await insertSampleBeforeNow(client, x, "kw", 12.5, 5);
  await insertSampleBeforeNow(client, x, "zz_uncatalogued", 1, 4);

  const service = new DashboardService(client as unknown as pg.Pool, NO_TARIFFS, NO_HEALTH);
  const dto = await service.locationDashboard(site.locationId, {
    locationIds: [site.locationId],
    assetIds: null,
  });
  const items = dto?.assets.items ?? [];
  const rowX = items.find((item) => item.id === x);
  const rowY = items.find((item) => item.id === y);
  assert(rowX !== undefined && rowY !== undefined, `both fixture assets must be on the page, got ${JSON.stringify(items.map((i) => i.id))}`);

  const keysX = rowX.telemetry.map((sample) => sample.pointKey);
  assert(
    JSON.stringify(keysX) === JSON.stringify(["kw", "zz_uncatalogued"]),
    `X must list exactly kw then zz_uncatalogued, got ${JSON.stringify(keysX)}`,
  );
  assert(rowX.latestKw === 12.5, `X's latestKw must be 12.5, got ${JSON.stringify(rowX.latestKw)}`);
  assert(rowX.freshness === "live", `X must be live, got ${JSON.stringify(rowX.freshness)}`);
  assert(rowY.telemetry.length === 0, `silent Y must list no telemetry, got ${JSON.stringify(rowY.telemetry)}`);
  assert(rowY.freshness === "none", `silent Y's freshness must be "none", got ${JSON.stringify(rowY.freshness)}`);
}

/** An empty id list issues no query and returns no pair. */
export async function assertNoAssetsDiscoverNothingWithoutQuerying(): Promise<void> {
  let queried = false;
  const pool = {
    query: async () => {
      queried = true;
      return { rows: [] };
    },
  } as unknown as pg.Pool;
  const pairs = await discoverLatestPairs(pool, []);
  assert(pairs.length === 0, `no assets must discover no pair, got ${JSON.stringify(pairs)}`);
  assert(!queried, "an empty asset list must not query");
}
