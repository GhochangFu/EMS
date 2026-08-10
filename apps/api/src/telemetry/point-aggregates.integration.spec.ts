import type pg from "pg";

import {
  aggregateRelation,
  avgExpr,
  bucketHours,
  type AggregateLevel,
} from "./point-aggregates";

/**
 * `F4.1` — ADR 0023's continuous aggregates against a real TimescaleDB.
 *
 * Nothing here can be asserted without a database: continuous aggregates, the
 * real-time branch, the `sum`/`count` composition up the hierarchy and the
 * refresh-policy offsets are all engine behaviour.
 *
 * **The fixture is the point, in the same sense as `F4.10`'s and `F4.14`'s.**
 * `db:seed` inserts **zero** `telemetry.point_values` rows — only `apps/sim` and
 * `apps/ingest` ever write that table — so a suite that read whatever the seed
 * left would compare 0 buckets against 0 buckets and pass having asserted
 * nothing. Every assertion below therefore runs against rows this file inserts,
 * and `assertBucketsExist` fails loudly rather than silently succeeding on an
 * empty window.
 *
 * **Sample counts per minute are deliberately uneven** (1, 2, 7, 20, 40 …).
 * That is not decoration. On an even fixture the *wrong* implementation —
 * `avg(avg_value)` instead of `sum(sum_value) / sum(sample_count)` — produces
 * the identical answer, so an even fixture would let the defect ADR 0023 exists
 * to prevent pass this suite. It was measured at 151 wrong buckets out of 169 on
 * real pilot data, where counts range 1–60.
 *
 * These tests write, so every row carries `TEST_POINT_KEY` and rows are deleted
 * before and after the run — a crashed run must not poison the next one.
 */

/** Only rows with this `point_key` are inserted or deleted by this suite. */
export const TEST_POINT_KEY = "f41_aggregate_fixture_kw";

/** Fixture length. Four hours gives 240 minute buckets and 4 hour buckets. */
const WINDOW_HOURS = 4;

/**
 * Where the fixture window starts — **computed at run time, from the aggregates'
 * watermarks**, and the reason is worth reading before changing it.
 *
 * A continuous aggregate serves any bucket **behind** its watermark from stored
 * rows only. The real-time branch covers the region *ahead* of it. So a fixed
 * historical window cannot test the live branch at all: rows inserted behind the
 * watermark are invisible until a refresh covers that range, no matter what
 * `materialized_only` says. A first version of this suite used a fixed
 * `2026-07-01` window and failed with `0 aggregate buckets vs 240 raw` for
 * exactly that reason.
 *
 * Measured 2026-08-10: the watermark can also sit **ahead of `now()`** — `_1m`
 * at 07:54 with `now()` at 07:20, `_1d` at the following midnight — so "recent"
 * is not good enough either. The window therefore starts past the newest
 * watermark of all four levels, rounded up to a day boundary so no level begins
 * mid-bucket.
 */
async function fixtureWindow(pool: pg.Pool): Promise<{ start: Date; end: Date }> {
  const { rows } = await pool.query<{ start: Date }>(
    `SELECT (date_trunc('day', GREATEST(max(w.watermark), now())) + interval '1 day') AS start
     FROM (
       SELECT _timescaledb_functions.to_timestamp(
                _timescaledb_functions.cagg_watermark(h.id)) AS watermark
       FROM timescaledb_information.continuous_aggregates c
       JOIN _timescaledb_catalog.hypertable h
         ON h.schema_name = c.materialization_hypertable_schema
        AND h.table_name  = c.materialization_hypertable_name
       WHERE c.view_schema = 'telemetry'
     ) w`,
  );
  const start = rows[0]?.start;
  assert(start instanceof Date, "could not resolve the aggregate watermarks");
  return { start, end: new Date(start.getTime() + WINDOW_HOURS * 3_600_000) };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export type Fixtures = {
  assetId: string;
  sampleCounts: number[];
  start: Date;
  end: Date;
};

/**
 * Removes only this suite's rows, then re-materialises the window so stale
 * fixture buckets cannot survive into the next run. Safe to call before and
 * after, and safe after a crash.
 */
export async function cleanup(pool: pg.Pool, window?: { start: Date; end: Date }): Promise<void> {
  await pool.query(`DELETE FROM telemetry.point_values WHERE point_key = $1`, [
    TEST_POINT_KEY,
  ]);
  if (window) {
    await refreshWindow(pool, window);
  }
}

/**
 * `refresh_continuous_aggregate` cannot run inside a transaction block — ADR
 * 0023 measured fact 1. Each call below is one autocommit statement, which is
 * fine; wrapping them in `BEGIN` is what is not.
 *
 * The range is **explicit**, not `NULL, NULL`. A full refresh materialises only
 * up to the present, and this fixture deliberately sits past the watermark — see
 * `fixtureWindow` — so a full refresh would leave it unmaterialized and the
 * materialized-path assertion would test the live branch twice.
 *
 * Coarsest last: a level refreshed before its source materialises nothing.
 *
 * The range is **padded to `PAD_DAYS` past the window end**. A refresh range
 * narrower than one bucket is rejected outright — `error: refresh window too
 * small` — and the fixture is four hours long, which is less than `_1d`'s single
 * bucket. Padding into empty future time is harmless: there are no other rows
 * there to re-materialise.
 */
const PAD_DAYS = 2;

export async function refreshWindow(
  pool: pg.Pool,
  window: { start: Date; end: Date },
): Promise<void> {
  const paddedEnd = new Date(window.end.getTime() + PAD_DAYS * 86_400_000);
  for (const level of ["1m", "5m", "1h", "1d"] as const) {
    await pool.query(
      `CALL refresh_continuous_aggregate('${aggregateRelation(level)}', $1::timestamptz, $2::timestamptz)`,
      [window.start.toISOString(), paddedEnd.toISOString()],
    );
  }
}

/**
 * Inserts four hours of readings for one asset with uneven per-minute counts.
 *
 * Values vary with the minute so that `min`, `max` and the mean are all
 * distinguishable — a constant value would make every aggregation agree
 * trivially and hide a column swapped for another.
 */
export async function seedReadings(pool: pg.Pool): Promise<Fixtures> {
  const window = await fixtureWindow(pool);
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.assets ORDER BY code LIMIT 1`,
  );
  const assetId = rows[0]?.id;
  assert(
    typeof assetId === "string",
    "F4.1 fixture needs at least one row in bms.assets; run `pnpm db:seed` first",
  );

  // Uneven on purpose, and cycled so different minutes inside the same hour get
  // different weights — that is what makes an average of averages diverge.
  const pattern = [1, 2, 7, 20, 40, 3, 12, 60];
  const sampleCounts: number[] = [];

  const times: string[] = [];
  const values: number[] = [];
  const start = window.start.getTime();
  const minutes = (window.end.getTime() - start) / 60_000;

  for (let minute = 0; minute < minutes; minute += 1) {
    const n = pattern[minute % pattern.length] ?? 1;
    sampleCounts.push(n);
    const minuteStart = start + minute * 60_000;
    for (let s = 0; s < n; s += 1) {
      // Spread samples inside the minute; `n <= 60` so each lands on its own
      // second and the composite primary key never collides.
      times.push(new Date(minuteStart + s * 1_000).toISOString());
      values.push(100 + minute * 0.5 + s * 0.25);
    }
  }

  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT t, $2::uuid, $3, v, 'kW'
     FROM unnest($1::timestamptz[], $4::float8[]) AS x(t, v)`,
    [times, assetId, TEST_POINT_KEY, values],
  );

  return { assetId, sampleCounts, start: window.start, end: window.end };
}

type Bucket = { bucket: string; kw: number; mn: number; mx: number; n: number };

/** The truth: the raw `date_trunc` rollup these aggregates replace. */
async function rawBuckets(
  pool: pg.Pool,
  assetId: string,
  unit: "minute" | "hour" | "day",
): Promise<Bucket[]> {
  const { rows } = await pool.query<{
    bucket: Date;
    kw: string;
    mn: string;
    mx: string;
    n: string;
  }>(
    `SELECT date_trunc($3, time) AS bucket, avg(value)::float8 AS kw,
            min(value)::float8 AS mn, max(value)::float8 AS mx, count(*)::text AS n
     FROM telemetry.point_values
     WHERE point_key = $1 AND asset_id = $2::uuid
     GROUP BY 1 ORDER BY 1`,
    [TEST_POINT_KEY, assetId, unit],
  );
  return rows.map((r) => ({
    bucket: r.bucket.toISOString(),
    kw: Number(r.kw),
    mn: Number(r.mn),
    mx: Number(r.mx),
    n: Number(r.n),
  }));
}

/** The same rollup read through an aggregate level, via the shared helper. */
async function aggregateBuckets(
  pool: pg.Pool,
  assetId: string,
  level: AggregateLevel,
): Promise<Bucket[]> {
  const { rows } = await pool.query<{
    bucket: Date;
    kw: string;
    mn: string;
    mx: string;
    n: string;
  }>(
    `SELECT bucket, ${avgExpr()}::float8 AS kw,
            min(min_value)::float8 AS mn, max(max_value)::float8 AS mx,
            sum(sample_count)::text AS n
     FROM ${aggregateRelation(level)}
     WHERE point_key = $1 AND asset_id = $2::uuid
     GROUP BY 1 ORDER BY 1`,
    [TEST_POINT_KEY, assetId],
  );
  return rows.map((r) => ({
    bucket: r.bucket.toISOString(),
    kw: Number(r.kw),
    mn: Number(r.mn),
    mx: Number(r.mx),
    n: Number(r.n),
  }));
}

/**
 * Guards every equality assertion below. An empty window makes
 * `[] deep-equals []` true, which is the vacuous pass ADR 0023 decision 6 exists
 * to refuse.
 */
export async function assertBucketsExist(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const raw = await rawBuckets(pool, fx.assetId, "minute");
  const expected = WINDOW_HOURS * 60;
  assert(
    raw.length === expected,
    `expected ${expected} minute buckets of fixture data, found ${raw.length} — the fixture did ` +
      "not land, so every equality assertion in this suite would pass vacuously",
  );
  const total = fx.sampleCounts.reduce((a, b) => a + b, 0);
  const counted = raw.reduce((a, b) => a + b.n, 0);
  assert(
    counted === total,
    `expected ${total} fixture samples, found ${counted} — sample counts differ, so the weighted ` +
      "mean is not being tested against the weights it was built with",
  );
  const distinct = new Set(fx.sampleCounts).size;
  assert(
    distinct > 1,
    "fixture sample counts are uniform, on which avg-of-avg is also correct — this suite would " +
      "not detect the defect it exists for",
  );
}

/**
 * The discriminating assertion: **per bucket**, not on a total.
 *
 * ADR 0023 measured fact 4 — over five days of pilot data the naive
 * `avg(avg_value)` form was wrong in 151 of 169 buckets yet agreed with raw on
 * the window sum, because the per-bucket errors cancel. A test on the total
 * passes for the wrong implementation.
 */
export async function assertLevelMatchesRaw(
  pool: pg.Pool,
  fx: Fixtures,
  level: AggregateLevel,
  unit: "minute" | "hour",
  label: string,
): Promise<void> {
  const raw = await rawBuckets(pool, fx.assetId, unit);
  const agg = await aggregateBuckets(pool, fx.assetId, level);

  assert(raw.length > 0, `${label}: no raw buckets — vacuous`);
  assert(
    agg.length === raw.length,
    `${label}: ${agg.length} aggregate buckets vs ${raw.length} raw`,
  );

  for (const [i, r] of raw.entries()) {
    const a = agg[i];
    assert(a !== undefined, `${label}: missing aggregate bucket at ${r.bucket}`);
    assert(
      a.bucket === r.bucket,
      `${label}: bucket ${i} is ${a.bucket} in the aggregate and ${r.bucket} in raw`,
    );
    assert(
      Math.abs(a.kw - r.kw) < 1e-9,
      `${label}: mean at ${r.bucket} is ${a.kw} via the aggregate and ${r.kw} raw ` +
        `(difference ${Math.abs(a.kw - r.kw)}) — this is what avg-of-avg breaks`,
    );
    assert(a.mn === r.mn, `${label}: min at ${r.bucket} is ${a.mn}, raw ${r.mn}`);
    assert(a.mx === r.mx, `${label}: max at ${r.bucket} is ${a.mx}, raw ${r.mx}`);
    assert(
      a.n === r.n,
      `${label}: sample_count at ${r.bucket} is ${a.n}, raw ${r.n} — a count that drifts means ` +
        "the mean's denominator is wrong even where the mean happens to match",
    );
  }
}

/**
 * **The assertion that actually guards `avgExpr`.**
 *
 * Rolls the `_1m` level up to **hourly** buckets through the shared helper and
 * compares per bucket against the raw hourly truth. Many source rows (60 minute
 * buckets) fold into each output bucket, which is the only shape where a weighted
 * mean and an average of averages differ.
 *
 * Verified by mutation on 2026-08-10, and this is why it exists:
 * `assertLevelMatchesRaw` **passed** with `avgExpr` replaced by
 * `avg(sum_value / sample_count)`. It reads `_1m` grouped by minute and `_1h`
 * grouped by hour, so each output bucket draws exactly one source row — and over
 * one row the two forms are algebraically identical. The per-bucket equality
 * check was real but blind to this defect; only this one fails under that
 * mutation.
 *
 * It matters for `F4.28`, not for the single site `F4.1` converts:
 * `energyKpis` reads the level whose bucket already matches its display bucket,
 * so it is 1:1 too. The moment any site reads a finer level than it renders, this
 * becomes the load-bearing property.
 */
export async function assertCoarseRollupFromFinerLevel(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const raw = await rawBuckets(pool, fx.assetId, "hour");
  const { rows } = await pool.query<{ bucket: Date; kw: string; n: string }>(
    `SELECT time_bucket(interval '1 hour', bucket) AS bucket,
            ${avgExpr()}::float8 AS kw,
            sum(sample_count)::text AS n
     FROM ${aggregateRelation("1m")}
     WHERE point_key = $1 AND asset_id = $2::uuid
     GROUP BY 1 ORDER BY 1`,
    [TEST_POINT_KEY, fx.assetId],
  );

  assert(raw.length > 0, "coarse rollup: no raw hourly buckets — vacuous");
  assert(
    rows.length === raw.length,
    `coarse rollup: ${rows.length} buckets from _1m vs ${raw.length} raw hourly`,
  );

  for (const [i, r] of raw.entries()) {
    const a = rows[i];
    assert(a !== undefined, `coarse rollup: missing bucket at ${r.bucket}`);
    const kw = Number(a.kw);
    assert(
      Math.abs(kw - r.kw) < 1e-9,
      `coarse rollup: hourly mean at ${r.bucket} is ${kw} folding _1m up, ${r.kw} from raw ` +
        `(difference ${Math.abs(kw - r.kw)}). This is the avg-of-avg defect: many minute buckets ` +
        "fold into one hour, and only a sum/count-weighted division survives it.",
    );
    assert(
      Number(a.n) === r.n,
      `coarse rollup: sample_count at ${r.bucket} is ${a.n}, raw ${r.n}`,
    );
  }
}

/**
 * Proves the fixture would actually catch the mistake, rather than trusting that
 * it would. Computes the naive average-of-averages over `_1m` and requires it to
 * **disagree** with raw on a substantial share of buckets.
 *
 * Without this, a future change that made all sample counts equal would leave
 * `assertLevelMatchesRaw` passing while testing nothing — the defect would be
 * undetectable and the suite would still be green.
 */
export async function assertNaiveFormWouldFail(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const { rows } = await pool.query<{ wrong: string; total: string; sum_ok: boolean }>(
    `WITH truth AS (
       SELECT date_trunc('hour', time) AS b, asset_id, avg(value)::float8 AS kw
       FROM telemetry.point_values
       WHERE point_key = $1 AND asset_id = $2::uuid GROUP BY 1, 2
     ),
     naive AS (
       SELECT time_bucket(interval '1 hour', bucket) AS b, asset_id,
              avg(sum_value / sample_count)::float8 AS kw
       FROM telemetry.point_values_1m
       WHERE point_key = $1 AND asset_id = $2::uuid GROUP BY 1, 2
     )
     SELECT count(*) FILTER (WHERE abs(t.kw - n.kw) > 1e-9)::text AS wrong,
            count(*)::text AS total,
            abs(sum(t.kw) - sum(n.kw)) < 1e-6 AS sum_ok
     FROM truth t JOIN naive n USING (b, asset_id)`,
    [TEST_POINT_KEY, fx.assetId],
  );

  const wrong = Number(rows[0]?.wrong ?? 0);
  const total = Number(rows[0]?.total ?? 0);
  assert(total > 0, "naive-form check found no buckets to compare");
  assert(
    wrong > 0,
    `the naive avg-of-avg form matched raw on all ${total} buckets, so this fixture cannot detect ` +
      "the ADR 0023 defect — the per-minute sample counts must be uneven",
  );
}

/**
 * ADR 0023 decision 4: `materialized_only = false` on all four, or the newest
 * bucket silently disappears from every live view. On TimescaleDB 2.29.1 the
 * default is `true`, so this is not a check against a harmless redundancy — it
 * is a check that migration `0027`'s setting survived.
 */
export async function assertRealtimeEnabled(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ view_name: string; materialized_only: boolean }>(
    `SELECT view_name, materialized_only
     FROM timescaledb_information.continuous_aggregates
     WHERE view_schema = 'telemetry' ORDER BY view_name`,
  );
  assert(
    rows.length === 4,
    `expected 4 continuous aggregates in telemetry, found ${rows.length} — migration 0027 did not land`,
  );
  for (const r of rows) {
    assert(
      r.materialized_only === false,
      `${r.view_name} has materialized_only = true, so its newest bucket is invisible to live reads. ` +
        "TimescaleDB 2.29.1 defaults to true; migration 0027 must set it false.",
    );
  }
}

/**
 * ADR 0023 decision 3's invariant, asserted against the live job catalog:
 *
 *     end_offset(level) >= end_offset(source) + bucket_width(level)
 *
 * A level that materialises a bucket its source has not finished stores an
 * **understated** figure, and the real-time branch cannot repair it — for an
 * already-materialized bucket the stored value wins. Nothing errors; the number
 * is simply wrong until a later run happens to re-cover it.
 *
 * Checked here rather than in review because the first draft of ADR 0023 stated
 * the rule in the wrong direction and shipped an offset table that violated it
 * at three of four levels.
 */
export async function assertRefreshOffsetsAreSafe(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ view: string; end_offset: string | null }>(
    `SELECT j.hypertable_name AS view, j.config->>'end_offset' AS end_offset
     FROM timescaledb_information.jobs j
     WHERE j.proc_name = 'policy_refresh_continuous_aggregate'
       AND j.hypertable_schema = 'telemetry'`,
  );

  const seconds = async (interval: string): Promise<number> => {
    const r = await pool.query<{ s: string }>(
      `SELECT extract(epoch FROM $1::interval)::text AS s`,
      [interval],
    );
    return Number(r.rows[0]?.s ?? NaN);
  };

  const chain: { level: AggregateLevel; source: AggregateLevel | null }[] = [
    { level: "1m", source: null },
    { level: "5m", source: "1m" },
    { level: "1h", source: "5m" },
    { level: "1d", source: "1h" },
  ];

  const byView = new Map(rows.map((r) => [r.view, r.end_offset]));
  assert(
    byView.size === 4,
    `expected a refresh policy on all 4 aggregates, found ${byView.size}`,
  );

  for (const { level, source } of chain) {
    const name = `point_values_${level}`;
    const raw = byView.get(name);
    // Narrowed with an explicit throw rather than `assert`: `assert` is a plain
    // function, so TypeScript does not treat it as a type guard, and the `?? "0"`
    // shortcut used for the source below would silently turn a *missing* policy
    // into a floor of zero — which every level passes.
    if (typeof raw !== "string") {
      throw new Error(`${name} has a refresh policy with no end_offset`);
    }
    const own = await seconds(raw);
    // Raw is never lagged, so the floor for `_1m` is just its own bucket width.
    // For every other level the source's own end_offset must be known; treating a
    // missing one as zero would give a floor that every level trivially clears.
    let sourceLag = 0;
    if (source) {
      const sourceOffset = byView.get(`point_values_${source}`);
      if (typeof sourceOffset !== "string") {
        throw new Error(
          `${name}'s source point_values_${source} has no refresh policy, so ${name}'s ` +
            "end_offset floor cannot be computed",
        );
      }
      sourceLag = await seconds(sourceOffset);
    }
    const floor = sourceLag + bucketHours(level) * 3_600;
    assert(
      own >= floor,
      `${name} has end_offset ${raw} (${own}s) but needs at least ${floor}s ` +
        `(source lag ${sourceLag}s + its own ${bucketHours(level) * 3_600}s bucket). Below that it ` +
        "materialises buckets its source has not completed, storing understated values that no " +
        "error surfaces and the real-time branch cannot repair.",
    );
  }
}
