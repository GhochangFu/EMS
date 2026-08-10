import type pg from "pg";

/**
 * `F4.28` / ADR 0025 — the six converted rollup reads, each executed against the
 * database and compared to the raw query it replaced.
 *
 * Assertions only (§4.6); `rollup-conversion.integration.test.ts` owns the
 * lifecycle.
 *
 * ## Why this suite never calls `refresh_continuous_aggregate`
 *
 * `F4.1`'s suite refreshed the **production** `_1m`/`_5m`/`_1h` over its fixture
 * and then deleted the fixture from raw. That left orphaned aggregate buckets on
 * every run — value exactly 50.0, `sample_count` 1 — which inflated the aggregate
 * side of its own comparison and made a *later* run fail by 0.833 kWh while the
 * message blamed something else. It was invisible in CI by construction, because a
 * CI database is created fresh each run. Fixed in `eb8a55b`; this suite is designed
 * so the defect is not available to it.
 *
 * The fixture is dated **ahead of `now()`**, and that single choice closes it:
 *
 * 1. **The live branch serves it.** Migration `0027` sets
 *    `materialized_only = false` on all four levels, so a bucket after the
 *    watermark is unioned in from a live aggregate over raw. ADR 0023 fact 7
 *    measured that path exact three levels deep, and ADR 0025 fact 1 re-measured
 *    it across all six sites — including, as it happens, the MQTT ingest's own
 *    33-minutes-ahead rows.
 * 2. **No policy can materialise it.** Every refresh policy in `0027` ends at
 *    `now() - end_offset` (1 min / 10 min / 2 h / 2 d), and every refresh call in
 *    this repo — `pnpm db:refresh-aggregates` and `F4.1`'s suite — ends at
 *    `now()`. Nothing materialises the future. So a `DELETE` cannot orphan
 *    anything, because nothing was ever stored.
 * 3. **It sits far from both window edges.** Every window here is trailing to
 *    `now()` or beyond, so the fixture is nowhere near the leading cutoff and the
 *    `bucket >` vs `time >` boundary difference (ADR 0025 decision 6) cannot
 *    influence the comparison. No alignment arithmetic, and no flakiness from a
 *    fixture that straddles a cutoff.
 *
 * {@link assertFixtureIsAheadOfEveryWatermark} proves premise 1 rather than
 * assuming it, and {@link assertSuiteLeftNoOrphans} proves the consequence — run
 * last, it is the assertion `F4.1` did not have.
 *
 * ## Why the comparison is scoped to probe assets
 *
 * The simulator and the MQTT ingest write continuously, so an unscoped comparison
 * races them: rows arriving between the aggregate query and the raw query make the
 * two disagree for a reason that has nothing to do with the conversion. Every
 * converted method takes `assetIds`, so each assertion passes the probe ids and
 * the comparison is deterministic.
 *
 * ## Which of these assertions can detect an `avgExpr` regression
 *
 * Only the two bare-`avg` sites, and this is measured rather than assumed
 * (ADR 0025 fact 2). Sites that group by the read level's own bucket width draw
 * **exactly one** source row per output bucket, where `sum(sum)/sum(count)` and
 * the naive average-of-averages are algebraically identical — so their parity
 * tests prove predicate translation, relation name and parameter binding, and
 * nothing whatever about the mean. `F4.1` proved that the hard way: its per-bucket
 * test passed with `avgExpr` mutated to the naive form.
 *
 * The two sites with no display bucket fold many rows into one mean, so they can
 * and do discriminate — and each additionally asserts its own fold is ≥ 2, because
 * at the `_1h` site ADR 0025 fact 3 measured **8 of 37** real assets whose fold is
 * 1 and which therefore agree under both forms. An assertion landing on one of
 * those reads as coverage while proving nothing.
 */

/** Asset codes the fixture owns. `PV` prefix matters: it is how solar is detected. */
const PLAIN_CODE = "F428-PROBE-LOAD";
const SOLAR_CODE = "PV-F428-PROBE";

/**
 * How far ahead of `now()` the fixture starts, and how many minutes it spans.
 *
 * The lead is the suite's whole safety margin, so it is generous. The only way the
 * fixture can stop being "in the future" is **elapsed wall-clock time**: no
 * scheduled policy reaches past `now() - end_offset` and no refresh call in this
 * repo passes an upper bound later than `now()`, so nothing can materialise the
 * fixture while `now()` is still behind it. 45 minutes against a suite that runs in
 * seconds leaves two orders of magnitude of headroom.
 *
 * The span crosses at least one hour boundary, which sites 4–6 need: a fixture
 * inside a single hour gives `_1h` a fold of 1 per asset, and
 * {@link assertReportTopConsumersMatchRaw} would then correctly refuse to run.
 */
const LEAD_MINUTES = 45;
const SPAN_MINUTES = 90;

/**
 * Samples per minute bucket, cycled. **Deliberately uneven**: an even fixture is
 * exactly the one on which the naive average-of-averages form also passes, because
 * equal weights make the two expressions agree. ADR 0023 fact 4 measured real
 * per-minute counts ranging 1–60, so this is representative as well as adversarial.
 */
const SAMPLES_PER_MINUTE = [1, 3, 11, 29, 47];

export interface Probes {
  readonly plainId: string;
  readonly solarId: string;
  readonly assetIds: string[];
  /** First and last sample instants, inclusive. */
  readonly firstSample: Date;
  readonly lastSample: Date;
  /** Every minute bucket the fixture writes into. */
  readonly bucketCount: number;
  readonly rowCount: number;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Relative comparison — absolute tolerance is meaningless across these magnitudes. */
function assertClose(
  actual: number,
  expected: number,
  what: string,
  tolerance = 1e-9,
): void {
  const scale = Math.max(1, Math.abs(expected));
  const relative = Math.abs(actual - expected) / scale;
  assert(
    relative <= tolerance,
    `${what}: aggregate gave ${actual}, raw gave ${expected} (relative error ${relative})`,
  );
}

/**
 * Removes every trace of the fixture. Safe to call before creation.
 *
 * Deletes telemetry **before** the assets, because `point_values.asset_id` has no
 * cascade. Matched by `code`, not by a remembered id, so a crashed earlier run is
 * cleaned up too.
 */
export async function cleanupProbes(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM telemetry.point_values
     WHERE asset_id IN (SELECT id FROM bms.assets WHERE code = ANY($1::text[]))`,
    [[PLAIN_CODE, SOLAR_CODE]],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code = ANY($1::text[])`, [
    [PLAIN_CODE, SOLAR_CODE],
  ]);
}

/**
 * Creates two probe assets and a future-dated `kw` fixture across both.
 *
 * Two assets, and one of them is `PV`-prefixed, because `energySourceMix` and
 * `energySourceTotals` split solar out with `code ILIKE 'PV%'`. A single-asset
 * fixture would leave the solar branch of both queries returning zero on each
 * side — agreeing, and asserting nothing about the split.
 */
export async function createProbes(pool: pg.Pool): Promise<Probes> {
  const { rows: locations } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.locations ORDER BY name LIMIT 1`,
  );
  const locationId = locations[0]?.id;
  if (typeof locationId !== "string") {
    throw new Error("F4.28 probes need at least one row in bms.locations");
  }

  const { rows: created } = await pool.query<{ id: string; code: string }>(
    `INSERT INTO bms.assets (code, name, site_name, domain, location_id)
     SELECT c, c, 'F4.28 probe site', 'electrical', $2::uuid
     FROM unnest($1::text[]) AS x(c)
     RETURNING id, code`,
    [[PLAIN_CODE, SOLAR_CODE], locationId],
  );
  const plainId = created.find((r) => r.code === PLAIN_CODE)?.id;
  const solarId = created.find((r) => r.code === SOLAR_CODE)?.id;
  if (typeof plainId !== "string" || typeof solarId !== "string") {
    throw new Error("F4.28 probe asset creation did not return both ids");
  }

  // Anchored on the DATABASE's clock, not the test process's. The predicates all
  // say `now()`, and a container whose clock differs from the host's by a minute
  // would otherwise put part of the fixture behind the watermark.
  const { rows: clock } = await pool.query<{ now: Date }>(`SELECT now() AS now`);
  const dbNow = clock[0]?.now;
  if (!(dbNow instanceof Date)) {
    throw new Error("could not read now() from the database");
  }
  // Floored to a minute boundary. Not cosmetic: samples are laid out at
  // `base + minute*60s + s*1s` with up to 47 per minute, so an unaligned `base`
  // pushes the tail of every dense minute into the *next* minute bucket — 90
  // minute indices landing in 91 buckets, which is how the first run of this suite
  // failed. Alignment makes `bucketCount` exactly `SPAN_MINUTES` and keeps each
  // bucket's sample count exactly `SAMPLES_PER_MINUTE`, which the fold assertions
  // rely on. Costs under a minute of the lead.
  const base = new Date(
    Math.floor((dbNow.getTime() + LEAD_MINUTES * 60_000) / 60_000) * 60_000,
  );

  const times: string[] = [];
  const values: number[] = [];
  const assetIdColumn: string[] = [];
  for (const [index, assetId] of [plainId, solarId].entries()) {
    for (let minute = 0; minute < SPAN_MINUTES; minute += 1) {
      const n = SAMPLES_PER_MINUTE[minute % SAMPLES_PER_MINUTE.length] as number;
      for (let s = 0; s < n; s += 1) {
        times.push(new Date(base.getTime() + minute * 60_000 + s * 1_000).toISOString());
        // Distinct per asset and drifting within each minute, so a bucket's mean
        // is not its first sample and an off-by-one in the fold is visible.
        values.push(40 + index * 25 + minute * 0.37 + s * 0.11);
        assetIdColumn.push(assetId);
      }
    }
  }

  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT t, a::uuid, 'kw', v, 'kW'
     FROM unnest($1::timestamptz[], $2::text[], $3::float8[]) AS x(t, a, v)
     ON CONFLICT DO NOTHING`,
    [times, assetIdColumn, values],
  );

  const last = times[times.length - 1];
  if (last === undefined) {
    throw new Error("fixture produced no rows");
  }
  return {
    plainId,
    solarId,
    assetIds: [plainId, solarId],
    firstSample: base,
    lastSample: new Date(last),
    bucketCount: SPAN_MINUTES,
    rowCount: times.length,
  };
}

const LEVEL_VIEWS = [
  "telemetry.point_values_1m",
  "telemetry.point_values_5m",
  "telemetry.point_values_1h",
  "telemetry.point_values_1d",
] as const;

/**
 * The suite's safety premises, asserted rather than assumed — both of them, and
 * from the things that actually govern them rather than from a watermark.
 *
 * An earlier version read `cagg_watermark` and converted it with
 * `_timescaledb_functions.to_timestamp`. That is wrong in a way only a fresh
 * database shows: a never-refreshed aggregate's watermark is the minimum `bigint`
 * sentinel, and converting it raises **`timestamp out of range`** rather than
 * returning `-infinity`. CI creates its database per run, so the check would have
 * failed there and passed locally — the exact asymmetry §4.6's gate exists to
 * prevent. Both premises are checked directly instead:
 *
 * 1. **The fixture is visible through every level.** Nothing has refreshed it, so
 *    if the views return it at all, the real-time branch is serving it. That is
 *    the property the parity assertions depend on, stated as behaviour.
 * 2. **No refresh policy can reach it.** Every policy's window ends at
 *    `now() - end_offset`, so a strictly positive `end_offset` means no policy can
 *    ever materialise a future-dated bucket — which is what makes the closing
 *    `DELETE` unable to orphan anything.
 */
export async function assertFixtureIsOnlyOnTheLiveBranch(
  pool: pg.Pool,
  probes: Probes,
): Promise<void> {
  // Premise 1 — visible everywhere, with nothing materialised.
  for (const view of LEVEL_VIEWS) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${view} WHERE asset_id = ANY($1::uuid[])`,
      [probes.assetIds],
    );
    assert(
      Number(rows[0]?.n ?? 0) > 0,
      `${view} returns no rows for the probe assets. The fixture is dated ahead of now(), so ` +
        "it can only be served by the real-time branch — if that returns nothing, migration " +
        "0027's materialized_only = false is no longer in force, and every parity assertion in " +
        "this suite would be comparing zero against zero.",
    );
  }

  // Premise 2 — no policy's window can reach the future.
  const { rows: policies } = await pool.query<{
    hypertable_name: string;
    end_offset: string | null;
  }>(
    `SELECT hypertable_name, (config ->> 'end_offset') AS end_offset
     FROM timescaledb_information.jobs
     WHERE proc_name = 'policy_refresh_continuous_aggregate'
       AND hypertable_name = ANY($1::name[])
     ORDER BY hypertable_name`,
    [["point_values_1m", "point_values_5m", "point_values_1h", "point_values_1d"]],
  );
  assert(
    policies.length === 4,
    `expected 4 refresh policies, found ${policies.length} — migration 0027 may not be applied`,
  );
  for (const policy of policies) {
    const offset = policy.end_offset;
    assert(
      typeof offset === "string" && offset.length > 0,
      `${policy.hypertable_name} has no end_offset in its refresh policy config`,
    );
    const { rows: sign } = await pool.query<{ positive: boolean }>(
      `SELECT ($1::interval > interval '0') AS positive`,
      [offset],
    );
    assert(
      sign[0]?.positive === true,
      `${policy.hypertable_name}'s refresh policy has end_offset "${offset}", which is not ` +
        "strictly positive. Its refresh window would then reach now() or beyond and could " +
        "materialise this suite's future-dated fixture — after which the closing DELETE leaves " +
        "orphaned aggregate rows in a shared database. That is the F4.1 defect (eb8a55b).",
    );
  }
}

/**
 * ADR 0025 site 1 — `loadTrend`. `_1m`, minute buckets, trailing window.
 *
 * **Fold 1**, so this cannot detect an `avgExpr` regression and does not claim to.
 * What it does prove: the read hits `_1m` rather than raw, `bucket` replaced
 * `date_trunc('minute', time)` correctly, the parameters still bind in the right
 * order, and the per-bucket totals are unchanged.
 */
export async function assertLoadTrendMatchesRaw(
  pool: pg.Pool,
  probes: Probes,
  loadTrend: (
    window: string,
    assetIds: string[] | null,
  ) => Promise<{ points: { t: string; totalKw: number }[] }>,
): Promise<void> {
  // 168h is the widest this endpoint allows, and it comfortably contains a fixture
  // that starts 20 minutes from now.
  const { points } = await loadTrend("168h", probes.assetIds);

  const { rows: expected } = await pool.query<{ bucket: Date; total_kw: string }>(
    `WITH per AS (
       SELECT date_trunc('minute', time) AS bucket, asset_id, avg(value) AS kw
       FROM telemetry.point_values
       WHERE point_key = 'kw'
         AND time > now() - '168 hours'::interval
         AND asset_id = ANY($1::uuid[])
       GROUP BY 1, 2
     )
     SELECT bucket, SUM(kw)::float8 AS total_kw FROM per GROUP BY bucket ORDER BY bucket`,
    [probes.assetIds],
  );

  assert(
    expected.length === probes.bucketCount,
    `the raw reference found ${expected.length} minute buckets, expected ${probes.bucketCount} — ` +
      "a comparison over the wrong row count proves nothing",
  );
  assert(
    points.length === expected.length,
    `loadTrend returned ${points.length} buckets, raw has ${expected.length}`,
  );

  const byBucket = new Map(
    expected.map((row) => [new Date(row.bucket).toISOString(), Number(row.total_kw)]),
  );
  for (const point of points) {
    const want = byBucket.get(point.t);
    assert(want !== undefined, `loadTrend returned bucket ${point.t}, which raw does not have`);
    // loadTrend does not round, so this is an exact-modulo-float comparison.
    assertClose(point.totalKw, want as number, `loadTrend bucket ${point.t}`);
  }
}

/**
 * ADR 0025 site 2 — `energySourceMix`. Both branches: minute buckets under 48 h
 * and hour buckets at or above it.
 *
 * **Fold 1 at both**, so again this proves translation and not the mean. The solar
 * split is the part worth having: it is the only assertion covering
 * `code ILIKE 'PV%'` against the aggregate relation, and the fixture puts a real
 * value on both sides of it.
 */
export async function assertEnergySourceMixMatchesRaw(
  pool: pg.Pool,
  probes: Probes,
  energySourceMix: (
    window: string,
    assetIds: string[] | null,
  ) => Promise<{ points: { t: string; gridKw: number; solarKw: number; dgKw: number }[] }>,
): Promise<void> {
  for (const [window, interval, trunc] of [
    ["24h", "24 hours", "minute"],
    ["7d", "7 days", "hour"],
  ] as const) {
    const { points } = await energySourceMix(window, probes.assetIds);

    const { rows: expected } = await pool.query<{
      bucket: Date;
      total_kw: string;
      solar_kw: string;
    }>(
      `WITH per AS (
         SELECT date_trunc($2, time) AS bucket, asset_id, avg(value) AS kw
         FROM telemetry.point_values
         WHERE point_key = 'kw'
           AND time > now() - $1::interval
           AND asset_id = ANY($3::uuid[])
         GROUP BY 1, 2
       ),
       solar_ids AS (
         SELECT id FROM bms.assets WHERE code ILIKE 'PV%' AND id = ANY($3::uuid[])
       )
       SELECT
         t.bucket,
         t.total_kw,
         COALESCE(s.solar_kw, 0)::float8 AS solar_kw
       FROM (SELECT bucket, SUM(kw)::float8 AS total_kw FROM per GROUP BY bucket) t
       LEFT JOIN (
         SELECT p.bucket, SUM(p.kw)::float8 AS solar_kw
         FROM per p JOIN solar_ids si ON si.id = p.asset_id GROUP BY p.bucket
       ) s ON s.bucket = t.bucket
       ORDER BY t.bucket`,
      [interval, trunc, probes.assetIds],
    );

    assert(
      expected.length > 0,
      `the raw reference for energySourceMix ${window} found no buckets`,
    );
    assert(
      points.length === expected.length,
      `energySourceMix ${window} returned ${points.length} buckets, raw has ${expected.length}`,
    );

    // The method derives grid/dg/solar from total and solar, so compare the two
    // independent inputs by reconstructing them: solar directly, and the total as
    // grid + dg + solar. Asserting only `solarKw` would leave the total untested.
    const byBucket = new Map(
      expected.map((row) => [
        new Date(row.bucket).toISOString(),
        { total: Number(row.total_kw), solar: Number(row.solar_kw) },
      ]),
    );
    for (const point of points) {
      const want = byBucket.get(point.t);
      assert(
        want !== undefined,
        `energySourceMix ${window} returned bucket ${point.t}, which raw does not have`,
      );
      const { total, solar } = want as { total: number; solar: number };
      // The method rounds each component to 2 dp, so the reconstruction carries up
      // to three roundings — 0.02 is the honest tolerance, well below the 25 kW
      // separation between the two probe assets.
      const rebuiltTotal = point.gridKw + point.dgKw + point.solarKw;
      assert(
        Math.abs(rebuiltTotal - total) <= 0.02,
        `energySourceMix ${window} bucket ${point.t}: grid+dg+solar = ${rebuiltTotal}, ` +
          `raw total = ${total}`,
      );
      assert(
        Math.abs(point.solarKw - Math.round(solar * 100) / 100) <= 0.02,
        `energySourceMix ${window} bucket ${point.t}: solar ${point.solarKw}, raw ${solar}`,
      );
    }

    assert(
      points.some((p) => p.solarKw > 0),
      `energySourceMix ${window} reported no solar anywhere — the PV probe asset should supply ` +
        "it, and a zero-vs-zero comparison asserts nothing about the ILIKE 'PV%' split",
    );
  }
}

/**
 * ADR 0025 site 3 — `energyTopConsumers` on the dashboard. `_1m`, **no display
 * bucket**, so every source row for an asset folds into one mean.
 *
 * **This one discriminates**, and it asserts three things in order:
 *
 * 1. the fold is ≥ 2, so the comparison is capable of detecting the defect;
 * 2. the aggregate result equals raw;
 * 3. the naive average-of-averages form does **not** equal raw, by a margin
 *    larger than the tolerance — which is what makes (2) evidence rather than
 *    coincidence.
 */
export async function assertTopConsumersMatchRaw(
  pool: pg.Pool,
  probes: Probes,
  energyTopConsumers: (
    window: string,
    limit: number,
    assetIds: string[] | null,
  ) => Promise<{ consumers: { assetId: string; avgKw: number }[] }>,
): Promise<void> {
  const { rows: fold } = await pool.query<{ asset_id: string; n: string }>(
    `SELECT asset_id, count(*) AS n
     FROM telemetry.point_values_1m
     WHERE point_key = 'kw'
       AND bucket > now() - '24 hours'::interval
       AND asset_id = ANY($1::uuid[])
     GROUP BY asset_id`,
    [probes.assetIds],
  );
  assert(fold.length === 2, `expected both probe assets in _1m, found ${fold.length}`);
  for (const row of fold) {
    assert(
      Number(row.n) >= 2,
      `asset ${row.asset_id} folds ${row.n} _1m row(s) into its mean. At a fold of 1 the correct ` +
        "and the naive forms are algebraically identical, so this assertion could not detect an " +
        "avgExpr regression — ADR 0025 fact 3 measured 8 of 37 real assets in exactly that state.",
    );
  }

  const { consumers } = await energyTopConsumers("24h", 25, probes.assetIds);
  assert(consumers.length === 2, `expected 2 consumers, got ${consumers.length}`);

  const { rows: reference } = await pool.query<{
    asset_id: string;
    raw_avg: string;
    naive_avg: string;
  }>(
    `WITH raw_ref AS (
       SELECT asset_id, avg(value)::float8 AS a
       FROM telemetry.point_values
       WHERE point_key = 'kw'
         AND time > now() - '24 hours'::interval
         AND asset_id = ANY($1::uuid[])
       GROUP BY asset_id
     ),
     naive AS (
       SELECT asset_id, avg(sum_value / sample_count)::float8 AS a
       FROM telemetry.point_values_1m
       WHERE point_key = 'kw'
         AND bucket > now() - '24 hours'::interval
         AND asset_id = ANY($1::uuid[])
       GROUP BY asset_id
     )
     SELECT r.asset_id, r.a AS raw_avg, n.a AS naive_avg
     FROM raw_ref r JOIN naive n ON n.asset_id = r.asset_id`,
    [probes.assetIds],
  );
  assert(reference.length === 2, `raw reference returned ${reference.length} rows, expected 2`);

  for (const row of reference) {
    const got = consumers.find((c) => c.assetId === row.asset_id);
    assert(got !== undefined, `energyTopConsumers omitted asset ${row.asset_id}`);
    const rawAvg = Number(row.raw_avg);
    const naiveAvg = Number(row.naive_avg);

    // The method rounds to 2 dp. Compare against the rounded reference so the
    // tolerance stays tight enough to see the naive form's error.
    assert(
      Math.abs((got as { avgKw: number }).avgKw - Math.round(rawAvg * 100) / 100) <= 0.005,
      `energyTopConsumers avgKw for ${row.asset_id}: ${(got as { avgKw: number }).avgKw}, ` +
        `raw ${rawAvg}`,
    );

    // And the mutation this suite must be able to see.
    assert(
      Math.abs(naiveAvg - rawAvg) > 0.01,
      `the fixture does not separate the two forms for asset ${row.asset_id}: naive ${naiveAvg} ` +
        `vs raw ${rawAvg}. Without separation, passing the assertion above says nothing about ` +
        "avgExpr — make SAMPLES_PER_MINUTE more uneven.",
    );
  }
}

/**
 * ADR 0025 sites 4 and 5 — `reports.energyPreview`'s summary and source totals.
 * Both `_1h`, both **fold 1**, both over an explicit day-aligned range.
 *
 * The range is derived from the fixture's own UTC dates so the fixture is always
 * fully inside it, whatever time of day the suite runs. `parseRange` snaps to
 * `T00:00:00.000Z` / `T23:59:59.999Z`, and a UTC day boundary is an hour boundary,
 * so `_1h` has no partial edge bucket (ADR 0025 fact 5).
 */
export async function assertReportPreviewMatchesRaw(
  pool: pg.Pool,
  probes: Probes,
  energyPreview: (
    query: { startDate: string; endDate: string },
    assetIds: string[] | null,
  ) => Promise<{
    summary: { totalKwh: number; peakKw: number };
    sourceTotals: { solarKwh: number; dgKwh: number; gridKwh: number };
  }>,
): Promise<void> {
  const startDate = probes.firstSample.toISOString().slice(0, 10);
  // The day the last sample falls on — the fixture may cross midnight UTC.
  const endDate = probes.lastSample.toISOString().slice(0, 10);
  const rangeStart = `${startDate}T00:00:00.000Z`;
  const rangeEnd = `${endDate}T23:59:59.999Z`;

  const preview = await energyPreview({ startDate, endDate }, probes.assetIds);

  const { rows } = await pool.query<{
    total_kwh: string;
    peak_kw: string;
    solar_kw: string;
    buckets: string;
  }>(
    `WITH per AS (
       SELECT date_trunc('hour', time) AS bucket, asset_id, avg(value) AS kw
       FROM telemetry.point_values
       WHERE point_key = 'kw'
         AND time >= $1::timestamptz
         AND time <= $2::timestamptz
         AND asset_id = ANY($3::uuid[])
       GROUP BY 1, 2
     ),
     agg AS (SELECT bucket, SUM(kw)::float8 AS total_kw FROM per GROUP BY bucket),
     solar_ids AS (
       SELECT id FROM bms.assets WHERE code ILIKE 'PV%' AND id = ANY($3::uuid[])
     )
     SELECT
       (SELECT COALESCE(SUM(total_kw), 0) FROM agg)::float8 AS total_kwh,
       (SELECT COALESCE(MAX(total_kw), 0) FROM agg)::float8 AS peak_kw,
       (SELECT COALESCE(SUM(p.kw) FILTER (WHERE s.id IS NOT NULL), 0)
          FROM per p LEFT JOIN solar_ids s ON s.id = p.asset_id)::float8 AS solar_kw,
       (SELECT count(*) FROM agg)::text AS buckets`,
    [rangeStart, rangeEnd, probes.assetIds],
  );
  const row = rows[0];
  assert(row !== undefined, "the raw reference for the report preview returned no row");
  const reference = row as {
    total_kwh: string;
    peak_kw: string;
    solar_kw: string;
    buckets: string;
  };

  assert(
    Number(reference.buckets) > 0,
    "the raw reference found no hour buckets in the report range — a 0-vs-0 comparison passes " +
      "for any implementation",
  );

  // Site 4. The method rounds to 2 dp.
  assertClose(
    preview.summary.totalKwh,
    Math.round(Number(reference.total_kwh) * 100) / 100,
    "report summary totalKwh",
    1e-6,
  );
  assertClose(
    preview.summary.peakKw,
    Math.round(Number(reference.peak_kw) * 100) / 100,
    "report summary peakKw",
    1e-6,
  );

  // Site 5. Solar is the directly comparable component; grid and dg are derived
  // from it and the total by the same arithmetic on both sides, so checking solar
  // plus the reconstructed total covers the query's two outputs.
  const solar = Math.round(Number(reference.solar_kw) * 100) / 100;
  assertClose(preview.sourceTotals.solarKwh, solar, "report sourceTotals solarKwh", 1e-6);
  const rebuilt =
    preview.sourceTotals.gridKwh + preview.sourceTotals.dgKwh + preview.sourceTotals.solarKwh;
  assert(
    Math.abs(rebuilt - Number(reference.total_kwh)) <= 0.02,
    `report sourceTotals grid+dg+solar = ${rebuilt}, raw total = ${reference.total_kwh}`,
  );
  assert(
    preview.sourceTotals.solarKwh > 0,
    "the report reported no solar — the PV probe asset should supply it, and zero-vs-zero " +
      "asserts nothing about the ILIKE 'PV%' split",
  );
}

/**
 * ADR 0025 site 6 — `reports.energyPreview`'s top consumers. `_1h`, **no display
 * bucket**, so this discriminates like site 3.
 *
 * The fold matters more here than at site 3 and the reason is measured: at `_1h`,
 * `sample_count` spans 7–629 on real data against `_1m`'s 1–60, so the naive
 * form's error reaches **11.19 kW** rather than 0.046 (ADR 0025 facts 3 and 4).
 * The coarse level is the more dangerous one, not the safer.
 */
export async function assertReportTopConsumersMatchRaw(
  pool: pg.Pool,
  probes: Probes,
  energyPreview: (
    query: { startDate: string; endDate: string },
    assetIds: string[] | null,
  ) => Promise<{ topConsumers: { assetId: string; avgKw: number }[] }>,
): Promise<void> {
  const startDate = probes.firstSample.toISOString().slice(0, 10);
  const endDate = probes.lastSample.toISOString().slice(0, 10);
  const rangeStart = `${startDate}T00:00:00.000Z`;
  const rangeEnd = `${endDate}T23:59:59.999Z`;

  const { rows: fold } = await pool.query<{ asset_id: string; n: string }>(
    `SELECT asset_id, count(*) AS n
     FROM telemetry.point_values_1h
     WHERE point_key = 'kw'
       AND bucket >= $1::timestamptz AND bucket <= $2::timestamptz
       AND asset_id = ANY($3::uuid[])
     GROUP BY asset_id`,
    [rangeStart, rangeEnd, probes.assetIds],
  );
  assert(fold.length === 2, `expected both probe assets in _1h, found ${fold.length}`);
  for (const row of fold) {
    assert(
      Number(row.n) >= 2,
      `asset ${row.asset_id} folds ${row.n} _1h row(s). The fixture spans ${SPAN_MINUTES} ` +
        "minutes, so it must cross at least one hour boundary — at a fold of 1 this assertion " +
        "cannot detect an avgExpr regression (ADR 0025 fact 3).",
    );
  }

  const { topConsumers } = await energyPreview({ startDate, endDate }, probes.assetIds);
  assert(topConsumers.length === 2, `expected 2 top consumers, got ${topConsumers.length}`);

  const { rows: reference } = await pool.query<{
    asset_id: string;
    raw_avg: string;
    naive_avg: string;
  }>(
    `WITH raw_ref AS (
       SELECT asset_id, avg(value)::float8 AS a
       FROM telemetry.point_values
       WHERE point_key = 'kw'
         AND time >= $1::timestamptz AND time <= $2::timestamptz
         AND asset_id = ANY($3::uuid[])
       GROUP BY asset_id
     ),
     naive AS (
       SELECT asset_id, avg(sum_value / sample_count)::float8 AS a
       FROM telemetry.point_values_1h
       WHERE point_key = 'kw'
         AND bucket >= $1::timestamptz AND bucket <= $2::timestamptz
         AND asset_id = ANY($3::uuid[])
       GROUP BY asset_id
     )
     SELECT r.asset_id, r.a AS raw_avg, n.a AS naive_avg
     FROM raw_ref r JOIN naive n ON n.asset_id = r.asset_id`,
    [rangeStart, rangeEnd, probes.assetIds],
  );
  assert(reference.length === 2, `raw reference returned ${reference.length} rows, expected 2`);

  for (const row of reference) {
    const got = topConsumers.find((c) => c.assetId === row.asset_id);
    assert(got !== undefined, `report topConsumers omitted asset ${row.asset_id}`);
    const rawAvg = Number(row.raw_avg);
    const naiveAvg = Number(row.naive_avg);
    assert(
      Math.abs((got as { avgKw: number }).avgKw - Math.round(rawAvg * 100) / 100) <= 0.005,
      `report topConsumers avgKw for ${row.asset_id}: ${(got as { avgKw: number }).avgKw}, ` +
        `raw ${rawAvg}`,
    );
    assert(
      Math.abs(naiveAvg - rawAvg) > 0.01,
      `the fixture does not separate the two forms at _1h for asset ${row.asset_id}: naive ` +
        `${naiveAvg} vs raw ${rawAvg}`,
    );
  }
}

/**
 * **The assertion `F4.1` did not have.** Run last, after the fixture is deleted
 * from raw.
 *
 * If any of the reads above had caused a bucket to be materialised, deleting the
 * raw rows would leave an orphan — a stored aggregate row with no source — and the
 * production views would still return it. That is exactly the `F4.1` defect
 * (`eb8a55b`): orphans at value 50.0 with `sample_count` 1, which inflated the
 * aggregate side of its own comparison and made a later run fail by 0.833 kWh.
 *
 * With raw empty for these assets, every level must return **nothing**. Anything
 * else means this suite poisons the database it runs against, and it means the
 * future-dating premise documented at the top of this file has stopped holding.
 */
export async function assertSuiteLeftNoOrphans(
  pool: pg.Pool,
  probes: Probes,
): Promise<void> {
  const { rows: rawRows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`,
    [probes.assetIds],
  );
  assert(
    Number(rawRows[0]?.n ?? -1) === 0,
    `this check requires the raw fixture to be deleted first; ${rawRows[0]?.n} rows remain`,
  );

  for (const view of LEVEL_VIEWS) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${view} WHERE asset_id = ANY($1::uuid[])`,
      [probes.assetIds],
    );
    assert(
      Number(rows[0]?.n ?? -1) === 0,
      `${view} still holds ${rows[0]?.n} row(s) for the probe assets after the raw fixture was ` +
        "deleted. Those are ORPHANS: this suite materialised a bucket it should not have, and " +
        "every later run against this database — and every other suite comparing aggregates to " +
        "raw — is now reading inflated figures. This is the F4.1 defect (eb8a55b) reappearing. " +
        "Do not relax this assertion; find what materialised past now().",
    );
  }
}
