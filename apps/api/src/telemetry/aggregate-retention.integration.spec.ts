import type pg from "pg";

/**
 * `F4.2` / ADR 0024 — the compression and retention behaviour that decides
 * whether the aggregates survive.
 *
 * Two halves, and they assert opposite things on purpose:
 *
 * - **Mechanism**, on throwaway probe relations: dropping raw chunks leaves the
 *   aggregate intact, a refresh bounded at raw's oldest surviving chunk keeps it
 *   that way, and an **unbounded** refresh destroys it. The last of those asserts
 *   that a hazard still exists — it is what makes the bound in
 *   `packages/db/src/refresh-aggregates.ts` necessary rather than decorative, and
 *   it fails loudly if a future TimescaleDB changes the behaviour the bound was
 *   built for.
 * - **Configuration**, read-only against the four real aggregates: the shipped
 *   policies satisfy migration `0028`'s two stated invariants, and `_1h`/`_1d`
 *   still carry no retention policy at all.
 *
 * **Why probes.** These tests DROP RAW CHUNKS. Doing that to
 * `telemetry.point_values` would delete real pilot history, and the F4.1 suite
 * already had to be rewritten once for permanently ratcheting the production
 * watermarks forward. Every destructive assertion here runs against
 * `telemetry.f42_probe`, created and dropped per run; the catalog assertions
 * touch the real relations and only read.
 *
 * CI note: this suite creates its own data. `db:seed` inserts zero
 * `telemetry.point_values` rows, so nothing here can lean on seeded telemetry.
 */

/** Throwaway hypertable — never `telemetry.point_values`. See the header. */
const PROBE = "telemetry.f42_probe";
const PROBE_1M = "telemetry.f42_probe_1m";
/**
 * A SECOND aggregate level, reading `f42_probe_1m` rather than raw.
 *
 * It exists for one assertion — `assertPerLevelFloorProtectsTheCascade` — and
 * that assertion exists because a single-level probe **cannot** catch the defect
 * it covers. The ADR 0023 chain is hierarchical: only `_1m` reads raw. A bound
 * computed from raw and applied to every level is correct for `_1m` and wrong for
 * the three above it, and with only `_1m` under test the wrongness is invisible.
 * That is exactly what shipped in the first version of
 * `packages/db/src/refresh-aggregates.ts`, and review caught it rather than this
 * suite.
 */
const PROBE_5M = "telemetry.f42_probe_5m";

/**
 * Two days far apart, so the probe gets two separate raw chunks and retention can
 * drop one while leaving the other. Fixed rather than relative to `now()`: a
 * relative window would put the fixture inside the real refresh policies' reach
 * and make the test's own behaviour depend on when it ran.
 *
 * Both are in the past and neither collides with the F4.1 fixture
 * (`2026-06-01`) or with the simulator's live range.
 */
const OLD_DAY = "2026-03-01T00:00:00Z";
const KEPT_DAY = "2026-03-20T00:00:00Z";
/** Anything strictly between the two days: the retention cutoff under test. */
const CUTOFF = "2026-03-10T00:00:00Z";

const ASSETS = [
  "f4200000-0000-0000-0000-000000000001",
  "f4200000-0000-0000-0000-000000000002",
] as const;
const POINT_KEYS = ["kw", "kwh"] as const;

/** Samples per hour per series, uneven so `sample_count` is never uniform. */
const SAMPLES_PER_HOUR = [3, 11, 27, 5] as const;

export interface RetentionFixtures {
  /** Aggregate rows covering `OLD_DAY`, snapshotted while raw still had it. */
  oldDayRows: AggregateRow[];
}

interface AggregateRow {
  bucket: string;
  asset_id: string;
  point_key: string;
  sum_value: number;
  sample_count: number;
}

function fail(message: string): never {
  throw new Error(`[F4.2] ${message}`);
}

/** Drops the probe relations. Safe to call when they do not exist. */
export async function cleanupProbes(pool: pg.Pool): Promise<void> {
  await pool.query(`DROP MATERIALIZED VIEW IF EXISTS ${PROBE_5M} CASCADE`);
  await pool.query(`DROP MATERIALIZED VIEW IF EXISTS ${PROBE_1M} CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS ${PROBE} CASCADE`);
}

/**
 * Builds the probe hypertable, its aggregate, and two days of readings in two
 * separate chunks.
 *
 * The probe mirrors `point_values`' shape exactly — same columns, same primary
 * key, same `chunk_time_interval` — because the behaviours under test are
 * properties of that shape. A simplified probe could pass while production
 * failed.
 */
export async function createProbes(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE ${PROBE} (
      time timestamptz NOT NULL,
      asset_id uuid NOT NULL,
      point_key varchar(128) NOT NULL,
      value double precision NOT NULL,
      unit varchar(32),
      CONSTRAINT f42_probe_pk PRIMARY KEY (time, asset_id, point_key)
    )`);
  await pool.query(
    `SELECT public.create_hypertable($1, 'time', chunk_time_interval => INTERVAL '1 day')`,
    [PROBE],
  );

  for (const day of [OLD_DAY, KEPT_DAY]) {
    for (let hour = 0; hour < SAMPLES_PER_HOUR.length; hour += 1) {
      const perHour = SAMPLES_PER_HOUR[hour] as number;
      for (const assetId of ASSETS) {
        for (const pointKey of POINT_KEYS) {
          await pool.query(
            `INSERT INTO ${PROBE} (time, asset_id, point_key, value, unit)
             SELECT $1::timestamptz + make_interval(hours => $2::int)
                      + make_interval(secs => (3600.0 * g / $3::int)),
                    $4::uuid, $5, 100 + g * 1.5, 'kW'
               FROM generate_series(0, $3::int - 1) g`,
            [day, hour, perHour, assetId, pointKey],
          );
        }
      }
    }
  }

  // `materialized_only = false` and the sum/count columns, matching `0027`.
  // Without the same shape the parity this suite checks would not be the
  // production parity.
  await pool.query(`
    CREATE MATERIALIZED VIEW ${PROBE_1M}
    WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
    SELECT time_bucket(INTERVAL '1 minute', "time") AS bucket, asset_id, point_key,
           sum(value) AS sum_value, count(*) AS sample_count,
           min(value) AS min_value, max(value) AS max_value, max(unit) AS unit
    FROM ${PROBE}
    GROUP BY 1, 2, 3
    WITH NO DATA`);

  // Composes its source's columns, exactly as `0027` does above `_1m`: sum of
  // sums and sum of counts, never count(*) — which here would count minute
  // buckets instead of samples and divide by 5 rather than 60.
  await pool.query(`
    CREATE MATERIALIZED VIEW ${PROBE_5M}
    WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
    SELECT time_bucket(INTERVAL '5 minutes', bucket) AS bucket, asset_id, point_key,
           sum(sum_value) AS sum_value, sum(sample_count) AS sample_count,
           min(min_value) AS min_value, max(max_value) AS max_value, max(unit) AS unit
    FROM ${PROBE_1M}
    GROUP BY 1, 2, 3
    WITH NO DATA`);
}

/**
 * Materialises the probe aggregate over the whole fixture and snapshots the rows
 * for `OLD_DAY`.
 *
 * The snapshot is the baseline every later assertion compares against, and it is
 * taken while raw still holds `OLD_DAY` — after the drop there is nothing left to
 * derive it from, which is the entire point of ADR 0024 fact 14.
 */
export async function materialiseAndSnapshot(pool: pg.Pool): Promise<RetentionFixtures> {
  // Finest first: `_5m` reads `_1m`, so refreshing it before its source
  // materialises nothing (ADR 0023, and the F4.1 suite found it by failing).
  await pool.query(`CALL refresh_continuous_aggregate('${PROBE_1M}', NULL, now())`);
  await pool.query(`CALL refresh_continuous_aggregate('${PROBE_5M}', NULL, now())`);
  const oldDayRows = await oldDayAggregateRows(pool);
  if (oldDayRows.length === 0) {
    fail(
      `the probe aggregate has no rows for ${OLD_DAY} after a full refresh, so every ` +
        "assertion below would pass vacuously — the fixture or the refresh is broken",
    );
  }
  return { oldDayRows };
}

async function oldDayAggregateRows(pool: pg.Pool): Promise<AggregateRow[]> {
  const { rows } = await pool.query<AggregateRow>(
    `SELECT bucket::text AS bucket, asset_id::text AS asset_id, point_key,
            sum_value, sample_count::int AS sample_count
       FROM ${PROBE_1M}
      WHERE bucket >= $1::timestamptz AND bucket < $2::timestamptz
      ORDER BY bucket, asset_id, point_key`,
    [OLD_DAY, CUTOFF],
  );
  return rows;
}

async function rawRowCount(pool: pg.Pool, from: string, to: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${PROBE}
      WHERE time >= $1::timestamptz AND time < $2::timestamptz`,
    [from, to],
  );
  return Number(rows[0]?.n ?? "0");
}

function assertRowsIdentical(actual: AggregateRow[], expected: AggregateRow[], what: string): void {
  if (actual.length !== expected.length) {
    fail(`${what}: expected ${expected.length} aggregate rows, found ${actual.length}`);
  }
  for (let i = 0; i < expected.length; i += 1) {
    const a = actual[i] as AggregateRow;
    const e = expected[i] as AggregateRow;
    if (
      a.bucket !== e.bucket ||
      a.asset_id !== e.asset_id ||
      a.point_key !== e.point_key ||
      a.sample_count !== e.sample_count ||
      Math.abs(a.sum_value - e.sum_value) > 1e-9
    ) {
      fail(
        `${what}: row ${i} differs — expected ${JSON.stringify(e)}, found ${JSON.stringify(a)}`,
      );
    }
  }
}

/**
 * **ADR 0024 fact 6.** Dropping raw chunks does not touch the aggregate.
 *
 * This is the property that makes retention viable at all: it is what lets `_1h`
 * and `_1d` outlive raw as ADR 0023 decision 7 requires. If a TimescaleDB upgrade
 * ever made `drop_chunks` cascade into dependent aggregates, this fails — and it
 * should, loudly, because the long-term record would be silently gone.
 */
export async function assertAggregateSurvivesRawChunkDrop(
  pool: pg.Pool,
  fx: RetentionFixtures,
): Promise<void> {
  const before = await rawRowCount(pool, OLD_DAY, CUTOFF);
  if (before === 0) {
    fail(`no raw rows for ${OLD_DAY} to drop; the fixture is not what this asserts against`);
  }

  await pool.query(`SELECT drop_chunks($1, older_than => $2::timestamptz)`, [PROBE, CUTOFF]);

  const after = await rawRowCount(pool, OLD_DAY, CUTOFF);
  if (after !== 0) {
    fail(`drop_chunks left ${after} of ${before} raw rows for ${OLD_DAY}; nothing was dropped`);
  }

  assertRowsIdentical(
    await oldDayAggregateRows(pool),
    fx.oldDayRows,
    "after dropping the raw chunk the aggregate rows must be untouched",
  );
}

/**
 * **The fix, ADR 0024 decision 6.** A refresh lower-bounded at raw's oldest
 * surviving chunk leaves the orphaned aggregate rows alone.
 *
 * This mirrors what `packages/db/src/refresh-aggregates.ts` computes, rather than
 * importing it: that script is a CLI entry point in another package that opens its
 * own client and calls `process.exit`. What matters is that the *bound* is right,
 * and `assertRefreshBoundIsDerivedFromRawChunks` separately checks the real query
 * against the real hypertable.
 */
export async function assertBoundedRefreshPreservesAggregate(
  pool: pg.Pool,
  fx: RetentionFixtures,
): Promise<void> {
  const { rows } = await pool.query<{ range_start: Date | null }>(
    `SELECT min(range_start) AS range_start FROM timescaledb_information.chunks
      WHERE hypertable_schema = 'telemetry' AND hypertable_name = 'f42_probe'`,
  );
  const from = rows[0]?.range_start ?? null;
  if (from === null) {
    fail("the probe hypertable has no chunks left, so the bound under test is meaningless");
  }
  if (from.toISOString() < new Date(CUTOFF).toISOString()) {
    fail(
      `the oldest surviving probe chunk starts at ${from.toISOString()}, before the ` +
        `cutoff ${CUTOFF} — the dropped chunk is still present and this proves nothing`,
    );
  }

  await pool.query(
    `CALL refresh_continuous_aggregate('${PROBE_1M}', $1::timestamptz, now())`,
    [from],
  );

  assertRowsIdentical(
    await oldDayAggregateRows(pool),
    fx.oldDayRows,
    "a refresh bounded at raw's oldest surviving chunk must not touch older aggregate rows",
  );
}

/**
 * **The hazard, ADR 0024 fact 7 — asserted as still real.**
 *
 * An unbounded refresh over a range raw no longer covers deletes the aggregate
 * rows for it. Measured 34,596 -> 7,068 on the pilot database.
 *
 * A test asserting that something destructive still happens looks strange, so:
 * this is the justification for the bound in `refresh-aggregates.ts`. Without it
 * the bound is unexplained code that a later reader may "simplify" away, and CI
 * cannot catch that — `db:seed` inserts no telemetry, so
 * `pnpm db:refresh-aggregates` is a no-op there and stays green either way.
 *
 * Runs last: it destroys the fixture it asserts on.
 */
export async function assertUnboundedRefreshDestroysAggregate(
  pool: pg.Pool,
  fx: RetentionFixtures,
): Promise<void> {
  if (fx.oldDayRows.length === 0) {
    fail("no baseline rows, so 'they were destroyed' cannot be distinguished from 'never existed'");
  }

  await pool.query(`CALL refresh_continuous_aggregate('${PROBE_1M}', NULL, now())`);

  const surviving = await oldDayAggregateRows(pool);
  if (surviving.length !== 0) {
    fail(
      `an unbounded refresh over a dropped raw range left ${surviving.length} of ` +
        `${fx.oldDayRows.length} aggregate rows. That is GOOD news about TimescaleDB and bad ` +
        "news about this suite: ADR 0024 fact 7 no longer holds, so re-measure it and revisit " +
        "the lower bound in packages/db/src/refresh-aggregates.ts, which exists only because " +
        "of it. Do not delete this assertion to make the run green.",
    );
  }
}

/**
 * **The cascade, and the one assertion a single-level probe could not make.**
 *
 * `refresh-aggregates.ts` bounds each level by its OWN source's oldest surviving
 * chunk. Its first version computed one floor from raw and used it for all four,
 * which is right for `_1m` and wrong above it — and the failure that permits is
 * the one the bound was added to prevent.
 *
 * The precondition is reachable in production: TimescaleDB policy jobs fail and
 * lag **individually**, so raw's retention can run while `_1m`'s does not (one of
 * the six new policies did fail on its first run — ADR 0024 Amendment 1 fact 19).
 * Raw's floor then moves older than `_1m`'s data, and refreshing `_5m` from raw's
 * floor recomputes it over a range `_1m` no longer covers — deleting `_5m`, then
 * `_1h`, then `_1d` as the cascade walks up. The last two are the permanent
 * archive under ADR 0023 decision 7, and fact 14 says no refresh rebuilds them.
 *
 * This simulates it directly: drop the fine level's old chunk while raw still
 * holds the range, then show that raw's floor destroys `_5m` and the source's own
 * floor does not.
 *
 * Destructive — declared after the other mechanism cases.
 */
export async function assertPerLevelFloorProtectsTheCascade(pool: pg.Pool): Promise<void> {
  const floorOf = async (kind: "raw" | "agg", relation: string): Promise<Date | null> => {
    const { rows } =
      kind === "raw"
        ? await pool.query<{ f: Date | null }>(
            `SELECT min(range_start) AS f FROM timescaledb_information.chunks
              WHERE hypertable_schema = 'telemetry' AND hypertable_name = $1`,
            [relation],
          )
        : await pool.query<{ f: Date | null }>(
            `SELECT min(c.range_start) AS f
               FROM timescaledb_information.continuous_aggregates ca
               JOIN timescaledb_information.chunks c
                 ON c.hypertable_schema = ca.materialization_hypertable_schema
                AND c.hypertable_name   = ca.materialization_hypertable_name
              WHERE ca.view_schema = 'telemetry' AND ca.view_name = $1`,
            [relation],
          );
    return rows[0]?.f ?? null;
  };

  const fiveMinRows = async (): Promise<number> => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${PROBE_5M}
        WHERE bucket >= $1::timestamptz AND bucket < $2::timestamptz`,
      [OLD_DAY, CUTOFF],
    );
    return Number(rows[0]?.n ?? "0");
  };

  // Rebuild the fixture: earlier cases in this file dropped raw's old chunk.
  await cleanupProbes(pool);
  await createProbes(pool);
  await pool.query(`CALL refresh_continuous_aggregate('${PROBE_1M}', NULL, now())`);
  await pool.query(`CALL refresh_continuous_aggregate('${PROBE_5M}', NULL, now())`);

  const baseline = await fiveMinRows();
  if (baseline === 0) {
    fail(`${PROBE_5M} has no rows for ${OLD_DAY}; the cascade check would be vacuous`);
  }

  // Simulate the fine level's retention having run while raw's has not.
  await pool.query(`SELECT drop_chunks($1::regclass, older_than => $2::timestamptz)`, [
    PROBE_1M,
    CUTOFF,
  ]);

  const rawFloor = await floorOf("raw", "f42_probe");
  const fineFloor = await floorOf("agg", "f42_probe_1m");
  if (rawFloor === null || fineFloor === null) {
    fail("could not read both floors, so the divergence this asserts on is unverified");
  }
  if (fineFloor.getTime() <= rawFloor.getTime()) {
    fail(
      `the fine level's floor (${fineFloor.toISOString()}) is not later than raw's ` +
        `(${rawFloor.toISOString()}), so dropping its chunk did not create the divergence ` +
        "this case depends on and it proves nothing",
    );
  }

  // The correct bound: `_5m` refreshed from ITS source's floor leaves the older
  // rows alone, because it never recomputes a range `_1m` cannot supply.
  await pool.query(`CALL refresh_continuous_aggregate('${PROBE_5M}', $1::timestamptz, now())`, [
    fineFloor,
  ]);
  const afterCorrect = await fiveMinRows();
  if (afterCorrect !== baseline) {
    fail(
      `refreshing ${PROBE_5M} from its own source's floor changed its older rows: ` +
        `${baseline} became ${afterCorrect}. The per-level bound must be non-destructive.`,
    );
  }

  // The defective bound: raw's floor reaches into a range `_1m` no longer covers.
  await pool.query(`CALL refresh_continuous_aggregate('${PROBE_5M}', $1::timestamptz, now())`, [
    rawFloor,
  ]);
  const afterRawFloor = await fiveMinRows();
  if (afterRawFloor !== 0) {
    fail(
      `refreshing ${PROBE_5M} from RAW's floor left ${afterRawFloor} of ${baseline} rows. ` +
        "That is good news about TimescaleDB and bad news about this suite: the cascade " +
        "described in refresh-aggregates.ts's LEVELS comment no longer holds, so re-measure " +
        "it and revisit whether the per-level floor is still required. Do not delete this " +
        "assertion to make the run green.",
    );
  }
}

// ---------------------------------------------------------------------------
// Configuration assertions — read-only, against the four real aggregates.
// ---------------------------------------------------------------------------

interface PolicyRow {
  relation: string;
  proc: string;
  config: Record<string, string> | null;
}

/**
 * All telemetry policy jobs, keyed by the relation name the catalog reports.
 *
 * **That name is the user-facing one**, including for continuous aggregates:
 * verified 2026-08-10 after applying `0028`, `timescaledb_information.jobs` lists
 * `telemetry.point_values_1m` rather than the internal
 * `_timescaledb_internal._materialized_hypertable_18`, for refresh, compression
 * and retention policies alike. An earlier draft of this file resolved the
 * materialization hypertable name first and looked policies up under *that*,
 * which found nothing — and because every lookup returned `undefined`, the
 * failure would have surfaced as "no compression policy" rather than as a wrong
 * query.
 */
async function policies(pool: pg.Pool): Promise<PolicyRow[]> {
  const { rows } = await pool.query<PolicyRow>(
    `SELECT format('%s.%s', hypertable_schema, hypertable_name) AS relation,
            proc_name AS proc, config
       FROM timescaledb_information.jobs
      WHERE hypertable_schema = 'telemetry'`,
  );
  return rows;
}

/**
 * Guards the assumption above. If a TimescaleDB upgrade moves continuous-aggregate
 * policies to the internal name, every lookup in this file silently finds nothing
 * and the assertions become vacuous — so check that the four aggregates are
 * actually visible under their view names before relying on it.
 */
export async function assertPoliciesAreListedUnderViewNames(pool: pg.Pool): Promise<void> {
  const all = await policies(pool);
  for (const level of ["point_values_1m", "point_values_5m", "point_values_1h", "point_values_1d"]) {
    const found = all.some(
      (p) =>
        p.relation === `telemetry.${level}` &&
        p.proc === "policy_refresh_continuous_aggregate",
    );
    if (!found) {
      fail(
        `timescaledb_information.jobs lists no refresh policy under telemetry.${level}. ` +
          "Migration 0027 created one for every level, so the catalog is reporting policies " +
          "under a different relation name than this suite queries — which would make every " +
          "other configuration assertion here pass vacuously. Re-check the catalog shape.",
      );
    }
  }
}

function intervalToMs(value: string): number {
  // Postgres interval text, e.g. "7 days", "12:00:00", "2 days 02:00:00".
  const days = /(-?\d+)\s+day/.exec(value);
  const clock = /(\d+):(\d{2}):(\d{2})/.exec(value);
  const mons = /(-?\d+)\s+mon/.exec(value);
  let ms = 0;
  if (mons) ms += Number(mons[1]) * 30 * 86_400_000;
  if (days) ms += Number(days[1]) * 86_400_000;
  if (clock) {
    ms +=
      Number(clock[1]) * 3_600_000 + Number(clock[2]) * 60_000 + Number(clock[3]) * 1_000;
  }
  if (ms === 0 && !/^\s*00:00:00\s*$/.test(value)) {
    fail(`could not parse the interval "${value}"; the policy check would silently pass`);
  }
  return ms;
}

/**
 * Migration `0028`'s primary invariant: `retention(aggregate) > retention(source)`.
 *
 * Not `>=`. Equal horizons still produce the forbidden state transiently, because
 * the two policies run on independent schedules and either may fire first — and
 * the forbidden state is "raw holds period P, its aggregate does not", which is
 * unreadable *and* unrepairable (facts 13 and 14).
 */
export async function assertRetentionOutlivesSource(pool: pg.Pool): Promise<void> {
  const all = await policies(pool);

  const retentionFor = (relation: string): number | undefined => {
    const row = all.find(
      (p) => p.relation === relation && p.proc === "policy_retention",
    );
    const raw = row?.config?.drop_after;
    return raw === undefined ? undefined : intervalToMs(raw);
  };

  const rawRetention = retentionFor("telemetry.point_values");
  if (rawRetention === undefined) {
    fail("telemetry.point_values has no retention policy; migration 0028 did not take effect");
  }

  for (const level of ["point_values_1m", "point_values_5m"]) {
    const own = retentionFor(`telemetry.${level}`);
    if (own === undefined) {
      fail(`${level} has no retention policy, so it would outlive raw without bound`);
    }
    if (own <= rawRetention) {
      fail(
        `${level}'s retention (${own} ms) must be strictly GREATER than raw's ` +
          `(${rawRetention} ms). Shorter or equal opens the window where raw holds a period ` +
          "its aggregate does not — silently empty, and unrepairable by any refresh " +
          "(ADR 0024 facts 13 and 14).",
      );
    }
  }
}

/**
 * ADR 0023 decision 7, enforced rather than trusted: the two coarse levels are the
 * long-term record and must carry no retention policy at all.
 */
export async function assertCoarseLevelsAreNeverDropped(pool: pg.Pool): Promise<void> {
  const all = await policies(pool);

  for (const level of ["point_values_1h", "point_values_1d"]) {
    const found = all.find(
      (p) => p.relation === `telemetry.${level}` && p.proc === "policy_retention",
    );
    if (found) {
      fail(
        `${level} has a retention policy (${JSON.stringify(found.config)}). ADR 0023 decision 7 ` +
          "makes _1h and _1d the only record once raw is dropped; they are not droppable " +
          "without an ADR that overturns it.",
      );
    }
  }
}

/**
 * Migration `0028`'s secondary invariant: `compress_after(L) > start_offset(L)`.
 *
 * A refresh writes into buckets inside its own `start_offset`. Compressing sooner
 * would make every scheduled run write into a compressed aggregate chunk — which
 * is measured safe for *raw* writes (fact 4) but unmeasured for an aggregate
 * refresh, so the design keeps a wide margin instead of relying on it.
 */
export async function assertCompressionStartsAfterTheRefreshWindow(
  pool: pg.Pool,
): Promise<void> {
  const all = await policies(pool);

  for (const level of ["point_values_1m", "point_values_5m"]) {
    const compression = all.find(
      (p) => p.relation === `telemetry.${level}` && p.proc === "policy_compression",
    );
    const compressAfter = compression?.config?.compress_after;
    if (compressAfter === undefined) {
      fail(`${level} has no compression policy; migration 0028 did not take effect`);
    }

    const refresh = all.find(
      (p) =>
        p.relation === `telemetry.${level}` &&
        p.proc === "policy_refresh_continuous_aggregate",
    );
    const startOffset = refresh?.config?.start_offset;
    if (startOffset === undefined) {
      fail(`${level} has no refresh policy; migration 0027's policies are missing`);
    }

    const compressMs = intervalToMs(compressAfter);
    const startMs = intervalToMs(startOffset);
    if (compressMs <= startMs) {
      fail(
        `${level} compresses after ${compressAfter} but its refresh policy reaches back ` +
          `${startOffset}. Every scheduled run would then write into a compressed chunk. ` +
          "Raise compress_after or narrow start_offset.",
      );
    }
  }
}

/**
 * The bound `packages/db/src/refresh-aggregates.ts` computes, checked against the
 * real hypertable: raw's oldest chunk boundary, not `min(time)`.
 *
 * The distinction is load-bearing. A chunk is the unit retention drops, so
 * `range_start` is the earliest instant raw could still hold data for; `min(time)`
 * would sit later inside a live chunk and would let a refresh delete aggregate
 * rows for buckets raw is still entitled to receive late arrivals into.
 */
export async function assertRefreshBoundIsDerivedFromRawChunks(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ bound: Date | null; earliest: Date | null }>(
    `SELECT (SELECT min(range_start) FROM timescaledb_information.chunks
               WHERE hypertable_schema = 'telemetry' AND hypertable_name = 'point_values') AS bound,
            (SELECT min(time) FROM telemetry.point_values) AS earliest`,
  );
  const bound = rows[0]?.bound ?? null;
  const earliest = rows[0]?.earliest ?? null;

  if (bound === null) {
    // A fresh database with no chunks. The script returns early in that case, so
    // there is nothing to compare — and asserting otherwise would fail in CI.
    return;
  }
  if (earliest !== null && bound.getTime() > earliest.getTime()) {
    fail(
      `the refresh bound ${bound.toISOString()} is later than the oldest raw row ` +
        `${earliest.toISOString()}, so a bounded refresh would skip real data`,
    );
  }
}
