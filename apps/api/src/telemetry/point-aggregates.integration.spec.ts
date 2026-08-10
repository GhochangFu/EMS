import type pg from "pg";

import { avgExpr, bucketHours, type AggregateLevel } from "./point-aggregates";

/**
 * `F4.1` — ADR 0023's continuous aggregates against a real TimescaleDB.
 *
 * Nothing here can be asserted without a database: continuous aggregates, the
 * real-time branch, the `sum`/`count` composition up the hierarchy and the
 * refresh-policy offsets are all engine behaviour.
 *
 * **The equality assertions run against throwaway aggregates, not the production
 * four, and that is the whole design.** The first version refreshed
 * `telemetry.point_values_1m/_5m/_1h/_1d` directly, and the compliance review
 * measured the damage: TimescaleDB has no API to lower a watermark, the fixture
 * window was derived from the aggregates' *own* previous watermark, and
 * `refreshWindow` padded two days past it — so every run pushed all four
 * watermarks ~3 days further into the future, permanently. On the pilot that left
 * `_1m` holding 3 of the 14 newest raw rows and the converted `energySummary`
 * returning 958 minute buckets where raw returned 968.
 *
 * The trap was that the *same* mechanism made the live-branch assertion valid:
 * a bucket is served live only if it sits ahead of the watermark. A freshly
 * created aggregate has no watermark at all, so a throwaway one lets a fixed
 * historical fixture exercise the live branch without touching shared state.
 * `assertProductionShapeMatchesProbe` is what keeps the throwaway honest.
 *
 * **The fixture is the point, in the same sense as `F4.10`'s and `F4.14`'s.**
 * `db:seed` inserts **zero** `telemetry.point_values` rows — only `apps/sim` and
 * `apps/ingest` ever write that table — so a suite that read whatever the seed
 * left would compare 0 buckets against 0 buckets and pass having asserted
 * nothing. `assertBucketsExist` fails loudly rather than succeeding on an empty
 * window.
 *
 * **Sample counts per minute are deliberately uneven** (1, 2, 7, 20, 40 …). On an
 * even fixture the *wrong* implementation — `avg(avg_value)` instead of
 * `sum(sum_value) / sum(sample_count)` — produces the identical answer, so an even
 * fixture would let the defect ADR 0023 exists to prevent pass this suite.
 *
 * These tests write, so every row carries `TEST_POINT_KEY` and rows are deleted
 * before and after the run — a crashed run must not poison the next one.
 */

/** Only rows with this `point_key` are inserted or deleted by this suite. */
export const TEST_POINT_KEY = "f41_aggregate_fixture_kw";

/** Throwaway aggregates. Created per run, dropped in `afterAll`. */
const PROBE_1M = "telemetry.f41_probe_1m";
const PROBE_1H = "telemetry.f41_probe_1h";

/** Fixture length. Four hours gives 240 minute buckets and 4 hour buckets. */
const WINDOW_HOURS = 4;

/**
 * Fixed and historical, which is only possible because the probes are fresh.
 *
 * A moving window would make the bucket count depend on when the suite runs, and
 * a boundary landing mid-bucket would make an equality failure look like a
 * rounding problem. It is far enough back that no policy window on the production
 * aggregates reaches it (`_1d`'s `start_offset` is the widest, at 30 days), so
 * inserting and deleting here leaves their materialization untouched.
 */
const WINDOW_START = new Date("2026-06-01T00:00:00.000Z");
const WINDOW_END = new Date(WINDOW_START.getTime() + WINDOW_HOURS * 3_600_000);

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export type Fixtures = { assetId: string; sampleCounts: number[] };

/**
 * Creates the throwaway 1-minute aggregate and a 1-hour aggregate on top of it,
 * mirroring migration `0027`'s column list and its
 * `materialized_only = false`.
 *
 * `WITH NO DATA` is mandatory: `refresh_continuous_aggregate` cannot run inside a
 * transaction (ADR 0023 measured fact 1) and creation `WITH DATA` would need one.
 */
export async function createProbeAggregates(pool: pg.Pool): Promise<void> {
  await dropProbeAggregates(pool);
  await pool.query(`
    CREATE MATERIALIZED VIEW ${PROBE_1M}
    WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
    SELECT time_bucket(INTERVAL '1 minute', "time") AS bucket, asset_id, point_key,
           sum(value) AS sum_value, count(*) AS sample_count,
           min(value) AS min_value, max(value) AS max_value, max(unit) AS unit
    FROM telemetry.point_values
    GROUP BY 1, 2, 3
    WITH NO DATA`);
  await pool.query(`
    CREATE MATERIALIZED VIEW ${PROBE_1H}
    WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
    SELECT time_bucket(INTERVAL '1 hour', bucket) AS bucket, asset_id, point_key,
           sum(sum_value) AS sum_value, sum(sample_count) AS sample_count,
           min(min_value) AS min_value, max(max_value) AS max_value, max(unit) AS unit
    FROM ${PROBE_1M}
    GROUP BY 1, 2, 3
    WITH NO DATA`);
}

/** `CASCADE` because `f41_probe_1h` depends on `f41_probe_1m`. */
export async function dropProbeAggregates(pool: pg.Pool): Promise<void> {
  await pool.query(`DROP MATERIALIZED VIEW IF EXISTS ${PROBE_1H} CASCADE`);
  await pool.query(`DROP MATERIALIZED VIEW IF EXISTS ${PROBE_1M} CASCADE`);
}

/**
 * Materialises the probes over the fixture window, coarsest last — a level
 * refreshed before its source materialises nothing.
 *
 * The range is padded past the window end because a refresh narrower than one
 * bucket is rejected (`refresh window too small`). Padding is safe here: it only
 * moves a watermark on a view that is about to be dropped.
 */
export async function refreshProbes(pool: pg.Pool): Promise<void> {
  const paddedEnd = new Date(WINDOW_END.getTime() + 2 * 3_600_000).toISOString();
  for (const view of [PROBE_1M, PROBE_1H]) {
    await pool.query(
      `CALL refresh_continuous_aggregate('${view}', $1::timestamptz, $2::timestamptz)`,
      [WINDOW_START.toISOString(), paddedEnd],
    );
  }
}

/** Removes only this suite's rows. Safe to call before and after, and after a crash. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM telemetry.point_values WHERE point_key = $1`, [
    TEST_POINT_KEY,
  ]);
}

/**
 * Inserts four hours of readings for one asset with uneven per-minute counts.
 *
 * Values vary with the minute so `min`, `max` and the mean are all
 * distinguishable — a constant value would make every aggregation agree
 * trivially and hide a column swapped for another.
 */
export async function seedReadings(pool: pg.Pool): Promise<Fixtures> {
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
  const start = WINDOW_START.getTime();
  const minutes = WINDOW_HOURS * 60;

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

  return { assetId, sampleCounts };
}

type Bucket = { bucket: string; kw: number; mn: number; mx: number; n: number };

/** The truth: the raw `date_trunc` rollup these aggregates replace. */
async function rawBuckets(
  pool: pg.Pool,
  assetId: string,
  unit: "minute" | "hour",
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

/** The same rollup read through a probe aggregate, via the shared helper's expression. */
async function probeBuckets(pool: pg.Pool, assetId: string, view: string): Promise<Bucket[]> {
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
     FROM ${view}
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
  assert(
    new Set(fx.sampleCounts).size > 1,
    "fixture sample counts are uniform, on which avg-of-avg is also correct — this suite would " +
      "not detect the defect it exists for",
  );
}

/**
 * **What licenses the throwaway aggregates to stand in for the production four.**
 *
 * Compares `telemetry.point_values_1m` against `f41_probe_1m` column-for-column
 * and requires the production definition to contain no `avg(`. If someone adds an
 * `avg_value` column, swaps `sum` for `avg`, or renames a column in migration
 * `0027`, the probes stop being representative and every equality assertion below
 * would be measuring the wrong object while still passing.
 */
export async function assertProductionShapeMatchesProbe(pool: pg.Pool): Promise<void> {
  const columnsOf = async (table: string): Promise<string> => {
    const { rows } = await pool.query<{ sig: string }>(
      `SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position) AS sig
       FROM information_schema.columns
       WHERE table_schema = 'telemetry' AND table_name = $1`,
      [table],
    );
    return rows[0]?.sig ?? "";
  };

  const production = await columnsOf("point_values_1m");
  const probe = await columnsOf("f41_probe_1m");
  assert(production !== "", "telemetry.point_values_1m does not exist — migration 0027 did not land");
  assert(
    production === probe,
    "the probe aggregate no longer matches production, so this suite would assert against the " +
      `wrong shape.\n  production: ${production}\n  probe:      ${probe}`,
  );

  const { rows } = await pool.query<{ view_definition: string }>(
    `SELECT view_definition FROM timescaledb_information.continuous_aggregates
     WHERE view_schema = 'telemetry' AND view_name = 'point_values_1m'`,
  );
  const definition = (rows[0]?.view_definition ?? "").toLowerCase();
  assert(definition !== "", "could not read point_values_1m's definition");
  assert(
    !/\bavg\s*\(/.test(definition),
    "telemetry.point_values_1m stores an avg(). ADR 0023 decision 2 forbids it at every level: " +
      "avg does not compose, and a stored one was wrong in 151 of 169 buckets on real data.",
  );
}

/**
 * The discriminating assertion: **per bucket**, not on a total.
 *
 * ADR 0023 measured fact 4 — over five days of pilot data the naive
 * `avg(avg_value)` form was wrong in 151 of 169 buckets yet agreed with raw on
 * the window sum, because the per-bucket errors cancel.
 */
export async function assertProbeMatchesRaw(
  pool: pg.Pool,
  fx: Fixtures,
  which: "1m" | "1h",
  label: string,
): Promise<void> {
  const unit = which === "1m" ? "minute" : "hour";
  const raw = await rawBuckets(pool, fx.assetId, unit);
  const agg = await probeBuckets(pool, fx.assetId, which === "1m" ? PROBE_1M : PROBE_1H);

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
        `(difference ${Math.abs(a.kw - r.kw)})`,
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
 * Rolls the 1-minute level up to **hourly** through the shared helper. Many source
 * rows (up to 60 minute buckets) fold into each output bucket, which is the only
 * shape where a weighted mean and an average of averages differ.
 *
 * Verified by mutation on 2026-08-10, and this is why it exists:
 * `assertProbeMatchesRaw` **passed** with `avgExpr` replaced by
 * `avg(sum_value / sample_count)`. It reads 1m grouped by minute and 1h grouped by
 * hour, so each output bucket draws exactly one source row — and over one row the
 * two forms are algebraically identical. That check was real but blind to this
 * defect; only this one fails under that mutation, by 2.97 kW.
 *
 * It matters for `F4.28`, not for the single site `F4.1` converts: `energySummary`
 * reads the level whose bucket already matches its display bucket, so it is 1:1
 * too. The moment any site reads a finer level than it renders, this becomes the
 * load-bearing property.
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
     FROM ${PROBE_1M}
     WHERE point_key = $1 AND asset_id = $2::uuid
     GROUP BY 1 ORDER BY 1`,
    [TEST_POINT_KEY, fx.assetId],
  );

  assert(raw.length > 0, "coarse rollup: no raw hourly buckets — vacuous");
  assert(
    rows.length === raw.length,
    `coarse rollup: ${rows.length} buckets folding 1m up vs ${raw.length} raw hourly`,
  );

  for (const [i, r] of raw.entries()) {
    const a = rows[i];
    assert(a !== undefined, `coarse rollup: missing bucket at ${r.bucket}`);
    const kw = Number(a.kw);
    assert(
      Math.abs(kw - r.kw) < 1e-9,
      `coarse rollup: hourly mean at ${r.bucket} is ${kw} folding 1m up, ${r.kw} from raw ` +
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
 * Proves the fixture would actually catch the mistake rather than trusting that it
 * would: computes the naive average-of-averages and requires it to **disagree**
 * with raw. Without this, a change that made all sample counts equal would leave
 * every assertion above passing while testing nothing.
 */
export async function assertNaiveFormWouldFail(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const { rows } = await pool.query<{ wrong: string; total: string }>(
    `WITH truth AS (
       SELECT date_trunc('hour', time) AS b, asset_id, avg(value)::float8 AS kw
       FROM telemetry.point_values
       WHERE point_key = $1 AND asset_id = $2::uuid GROUP BY 1, 2
     ),
     naive AS (
       SELECT time_bucket(interval '1 hour', bucket) AS b, asset_id,
              avg(sum_value / sample_count)::float8 AS kw
       FROM ${PROBE_1M}
       WHERE point_key = $1 AND asset_id = $2::uuid GROUP BY 1, 2
     )
     SELECT count(*) FILTER (WHERE abs(t.kw - n.kw) > 1e-9)::text AS wrong,
            count(*)::text AS total
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
 * default is `true`, so this checks that migration `0027`'s setting survived — not
 * a harmless redundancy.
 *
 * Reads the production catalog and writes nothing.
 */
export async function assertRealtimeEnabled(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ view_name: string; materialized_only: boolean }>(
    `SELECT view_name, materialized_only
     FROM timescaledb_information.continuous_aggregates
     WHERE view_schema = 'telemetry' AND view_name LIKE 'point\\_values\\_%'
     ORDER BY view_name`,
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
 * already-materialized bucket the stored value wins. Nothing errors; the number is
 * simply wrong until a later run happens to re-cover it.
 *
 * Checked here rather than in review because the first draft of ADR 0023 stated
 * the rule in the wrong direction and shipped an offset table that violated it at
 * three of four levels. Reads the catalog and writes nothing.
 */
export async function assertRefreshOffsetsAreSafe(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ view: string; end_offset: string | null }>(
    `SELECT j.hypertable_name AS view, j.config->>'end_offset' AS end_offset
     FROM timescaledb_information.jobs j
     WHERE j.proc_name = 'policy_refresh_continuous_aggregate'
       AND j.hypertable_schema = 'telemetry'
       AND j.hypertable_name LIKE 'point\\_values\\_%'`,
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
    // function, so TypeScript does not treat it as a type guard.
    if (typeof raw !== "string") {
      throw new Error(`${name} has a refresh policy with no end_offset`);
    }
    const own = await seconds(raw);
    // Raw is never lagged, so the floor for `_1m` is just its own bucket width.
    // For every other level the source's own end_offset must be known; treating a
    // missing one as zero would give a floor every level trivially clears.
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

/**
 * ADR 0023's Consequences bullet, turned into an assertion: a refresh policy that
 * exists and never fires is indistinguishable from a working one until the data is
 * visibly stale.
 *
 * Tolerates a policy that has not run yet (a database migrated seconds ago) but
 * refuses one that has run and **failed**.
 */
export async function assertRefreshPoliciesHaveNotFailed(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{
    view: string;
    last_run_status: string | null;
    total_failures: string;
  }>(
    `SELECT j.hypertable_name AS view, s.last_run_status, coalesce(s.total_failures, 0)::text AS total_failures
     FROM timescaledb_information.jobs j
     LEFT JOIN timescaledb_information.job_stats s ON s.job_id = j.job_id
     WHERE j.proc_name = 'policy_refresh_continuous_aggregate'
       AND j.hypertable_schema = 'telemetry'
       AND j.hypertable_name LIKE 'point\\_values\\_%'`,
  );
  assert(rows.length === 4, `expected 4 refresh policies, found ${rows.length}`);
  for (const r of rows) {
    assert(
      Number(r.total_failures) === 0,
      `${r.view}'s refresh policy has ${r.total_failures} failures — its aggregate is stale and ` +
        "nothing else reports that",
    );
    assert(
      r.last_run_status === null || r.last_run_status === "Success",
      `${r.view}'s refresh policy last ran with status ${r.last_run_status}`,
    );
  }
}

/**
 * **The only assertion that executes the converted read site.**
 *
 * `assertProbeMatchesRaw` proves the aggregates are right; it does not prove
 * `DashboardService.energySummary` reads them correctly. Two regressions the
 * compliance review named slip past everything else: reverting `bucket >` to
 * `time >` in the `WHERE` clause, and pairing a `level` with the wrong
 * `kwhFactor` — `assertBucketWidthsAreConsistent` covers the factor *table*,
 * nothing covered the *pairing*, and a mismatch scales `totalKwh` by 60.
 *
 * Compares the method's own output against the raw `date_trunc` query it
 * replaced, on both of its branches, using a **recent** fixture so the method's
 * `now() - interval` window actually contains it.
 */
export async function assertEnergySummaryMatchesRaw(
  pool: pg.Pool,
  energySummary: (
    window: string,
    assetIds: string[] | null,
  ) => Promise<{ totalKwh: number; peakKw: number }>,
): Promise<void> {
  const { rows: assets } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.assets ORDER BY code LIMIT 1`,
  );
  const assetId = assets[0]?.id;
  if (typeof assetId !== "string") {
    throw new Error("energySummary check needs at least one row in bms.assets");
  }

  // Recent, uneven, and inside a 24 h window. `kw` is the point key the method
  // hard-codes.
  const times: string[] = [];
  const values: number[] = [];
  const base = Date.now() - 3 * 3_600_000;
  for (let minute = 0; minute < 120; minute += 1) {
    const n = [1, 5, 17, 40][minute % 4] ?? 1;
    for (let s = 0; s < n; s += 1) {
      times.push(new Date(base + minute * 60_000 + s * 1_000).toISOString());
      values.push(50 + minute * 0.25 + s * 0.1);
    }
  }
  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT t, $2::uuid, 'kw', v, 'kW'
     FROM unnest($1::timestamptz[], $3::float8[]) AS x(t, v)
     ON CONFLICT DO NOTHING`,
    [times, assetId, values],
  );

  // Make the fixture visible to the aggregates, exactly as the scheduled policy
  // would within a minute. Freshly inserted rows sit BEHIND `_1m`'s watermark, so
  // without this the method correctly returns 0 and the comparison fails on the
  // documented watermark behaviour rather than on anything about `energySummary`.
  //
  // **This is safe where the original suite design was not:** the range ends at
  // `now()`, so no watermark moves past the present — which is the whole failure
  // the throwaway probes exist to avoid. `_1m`'s own policy refreshes
  // `[now - 3h, now - 1min]` every minute, so this is the same operation.
  // Finest first, and `_5m` is NOT optional even though nothing reads it here:
  // `_1h` is built on `_5m`, which is built on `_1m`, so skipping the middle level
  // leaves `_1h` with no source and the 7d branch returning 0. The suite found that
  // by failing.
  for (const view of [
    "telemetry.point_values_1m",
    "telemetry.point_values_5m",
    "telemetry.point_values_1h",
  ]) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await pool.query(
          `CALL refresh_continuous_aggregate('${view}', $1::timestamptz, now())`,
          [new Date(base - 3_600_000).toISOString()],
        );
        break;
      } catch (err: unknown) {
        // 55P03: a scheduled policy holds the same window. Transient by
        // construction — policy runs are short and bounded by `start_offset`.
        if ((err as { code?: string } | null)?.code !== "55P03" || attempt === 3) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }

  try {
    for (const [window, interval, trunc, factor] of [
      ["24h", "24 hours", "minute", 1 / 60],
      ["7d", "7 days", "hour", 1],
    ] as const) {
      // The raw reference is the EXACT equivalent of what the converted code
      // does, not the query it replaced. `bucket > now() - interval` keeps only
      // buckets whose start is strictly after the cutoff, so the matching raw
      // predicate starts at the first bucket boundary after it — see the
      // window-semantics note in ADR 0023. Comparing against the *old* predicate
      // instead would fail on the documented alignment difference and mask a real
      // regression behind it.
      const { rows } = await pool.query<{
        total_kwh: string;
        peak_kw: string;
        old_kwh: string;
      }>(
        `WITH bounds AS (
           SELECT date_trunc($2, now() - $1::interval) + ('1 ' || $2)::interval AS aligned_from,
                  now() - $1::interval AS raw_from
         ),
         per AS (
           SELECT date_trunc($2, v.time) AS bucket, v.asset_id, avg(v.value) AS kw
           FROM telemetry.point_values v, bounds b
           WHERE v.point_key = 'kw' AND v.time >= b.aligned_from
             AND v.asset_id = ANY($4::uuid[])
           GROUP BY 1, 2
         ),
         agg AS (SELECT bucket, SUM(kw)::float8 AS total_kw FROM per GROUP BY bucket),
         old_per AS (
           SELECT date_trunc($2, v.time) AS bucket, v.asset_id, avg(v.value) AS kw
           FROM telemetry.point_values v, bounds b
           WHERE v.point_key = 'kw' AND v.time > b.raw_from
             AND v.asset_id = ANY($4::uuid[])
           GROUP BY 1, 2
         ),
         old_agg AS (SELECT bucket, SUM(kw)::float8 AS total_kw FROM old_per GROUP BY bucket)
         SELECT COALESCE((SELECT SUM(total_kw) FROM agg) * $3::float8, 0)::text AS total_kwh,
                COALESCE((SELECT MAX(total_kw) FROM agg), 0)::text AS peak_kw,
                COALESCE((SELECT SUM(total_kw) FROM old_agg) * $3::float8, 0)::text AS old_kwh`,
        [interval, trunc, factor, [assetId]],
      );
      const expectedKwh = Math.round(Number(rows[0]?.total_kwh ?? 0) * 100) / 100;
      const expectedPeak = Math.round(Number(rows[0]?.peak_kw ?? 0) * 100) / 100;
      const oldFormKwh = Number(rows[0]?.old_kwh ?? 0);

      const actual = await energySummary(window, [assetId]);

      assert(
        expectedKwh > 0,
        `energySummary check at ${window}: the raw query returned 0 kWh, so this comparison is vacuous`,
      );
      assert(
        Math.abs(actual.totalKwh - expectedKwh) < 0.02,
        `energySummary("${window}").totalKwh is ${actual.totalKwh}, the equivalent raw query says ` +
          `${expectedKwh}. A ~60x gap means the level/kwhFactor pairing is wrong; a one-bucket gap ` +
          "means the WHERE column reverted from `bucket` to `time`.",
      );
      assert(
        Math.abs(actual.peakKw - expectedPeak) < 0.02,
        `energySummary("${window}").peakKw is ${actual.peakKw}, raw says ${expectedPeak}`,
      );

      // Pins the documented semantic change: the aggregate window is right-open
      // at bucket granularity, so it can differ from the pre-F4.1 raw form by at
      // most ONE bucket's contribution. Measured 0.0000% at 24h/48h/7d on the
      // pilot, but that is data-dependent — the cutoff is always mid-bucket
      // (windows are whole hours, `now()` is not), so any data in the partial
      // leading bucket makes them diverge. Asserting a *bound* rather than
      // equality is what makes this honest.
      const buckets = Math.max(1, Math.round(Number(rows[0]?.total_kwh ?? 0) / Math.max(factor, 1e-9)));
      const oneBucketCeiling = (Math.abs(oldFormKwh) / buckets) * 4 + 0.02;
      assert(
        Math.abs(actual.totalKwh - oldFormKwh) <= oneBucketCeiling,
        `energySummary("${window}") differs from the pre-F4.1 raw form by ` +
          `${Math.abs(actual.totalKwh - oldFormKwh)} kWh, more than the one-bucket ceiling ` +
          `${oneBucketCeiling}. The conversion is only allowed to move this number by the partial ` +
          "leading bucket; a larger gap is a real regression, not the documented alignment change.",
      );
    }
  } finally {
    await pool.query(
      `DELETE FROM telemetry.point_values
       WHERE point_key = 'kw' AND asset_id = $1::uuid AND time >= $2::timestamptz`,
      [assetId, new Date(base).toISOString()],
    );

    // ADR 0023's STANDING OBLIGATION, which this function was violating — and it
    // is the one place in the repo that most had to honour it, because it is the
    // only suite that deliberately materialises `point_key = 'kw'` rows into the
    // PRODUCTION aggregates before deleting them.
    //
    // Diagnosed 2026-08-10 while building `F4.2`: this suite was leaving orphaned
    // aggregate rows behind on every run — buckets readable in
    // `telemetry.point_values_1m` with no raw rows under them. Two were found on
    // the dev database (value exactly 50.0, sample_count 1: the fixture's minute
    // 0, where `[1,5,17,40][0]` is a single sample of `50 + 0 + 0`).
    //
    // It was self-poisoning rather than merely untidy. The orphans inflate the
    // aggregate side of this very comparison, so a later run fails by exactly one
    // bucket's contribution — 50 kW / 60 = 0.833 kWh — and blames the
    // `bucket`-vs-`time` predicate the message names. That is how `main` came to
    // be red on this test with no code change: measured on `main` at 9b86a0f,
    // 134.66 against 133.83.
    //
    // Partly self-cleaning, which is why it took this long to surface: the next
    // run's own refresh over `[base - 1h, now()]` recomputes those buckets from a
    // raw table that is now empty there and deletes them (ADR 0024 fact 7, doing
    // the right thing by accident). Only orphans that fall OUTSIDE the next run's
    // window survive — so the failure depends on the gap between runs, which is
    // exactly the kind of intermittency that gets rerun rather than diagnosed.
    //
    // Finest first, and the same three levels the fixture materialised. `_1d` is
    // not in that list because nothing above refreshed it.
    for (const view of [
      "telemetry.point_values_1m",
      "telemetry.point_values_5m",
      "telemetry.point_values_1h",
    ]) {
      try {
        await pool.query(
          `CALL refresh_continuous_aggregate('${view}', $1::timestamptz, now())`,
          [new Date(base - 3_600_000).toISOString()],
        );
      } catch (err: unknown) {
        // Never rethrow from `finally` — it would replace a real assertion failure
        // with a cleanup error and hide what actually broke. But do not swallow it
        // silently either: a cleanup that failed leaves the orphans this block
        // exists to prevent, and the next run fails somewhere else entirely.
        // A concurrent scheduled policy (55P03) is the expected transient cause.
        process.stderr.write(
          `\n[F4.1] WARNING: could not refresh ${view} after deleting the energySummary ` +
            `fixture: ${err instanceof Error ? err.message : String(err)}\n` +
            "        Orphaned aggregate rows may remain. Repair with:\n" +
            `        pnpm db:refresh-aggregates\n\n`,
        );
      }
    }
  }
}
