import { randomUUID } from "node:crypto";

import type pg from "pg";

import { latestPueRatio, windowedPueRatio } from "./pue-ratio";

/**
 * `F2.8` — the two database halves of the PUE reader, run against a real
 * TimescaleDB. The arithmetic is `pue-ratio.spec.ts`; nothing below can be
 * asserted without a connection.
 *
 * Three behaviours live only in the SQL and are invisible to the pure spec:
 *
 * 1. **The pairing rule.** `HAVING COUNT(*) = 2` drops an incomer that computes
 *    `site_kw` but not `it_kw` from **both** sums — ruling 3's "sites with no
 *    PUE point are left out of both sums", which is the difference between a
 *    plausible estate figure and one inflated by an unmatched site load. Asset C
 *    below is that half-pair, and `[a, c]` is the case that discriminates: with
 *    the mutation `COUNT(*) >= 1` it answers `20` instead of `2`. `[c]` alone
 *    does **not** discriminate — the mutant reaches `itKw = 0` and returns
 *    `null` for the wrong reason — which is why the half-pair is always asserted
 *    alongside a paired incomer.
 * 2. **The window mean.** `windowedPueRatio` divides Σ(window mean of `site_kw`)
 *    by Σ(window mean of `it_kw`), and the mean is `avgExpr()` —
 *    `sum(sum_value) / sum(sample_count)`, never an average of averages.
 *    Asset A's buckets carry uneven sample counts (3 then 1) precisely so the
 *    naive form gives a different answer: 3.0 where the correct one is 3.5.
 * 3. **The scope.** `null` means every incomer; an array is the containment
 *    (ADR 0043 Amendments 2/3) the caller's `FLEET_POOL` read depends on.
 *
 * **Fixture placement is load-bearing, and the obvious placement does not work.**
 * The rows go in a **fixed far-future** window ({@link BASE}), the same device
 * `health-rollup.integration.spec.ts` uses. Migration `0027` builds the four
 * aggregates `materialized_only = false`, so a bucket ahead of the
 * materialization watermark is served live from the source — but
 * `point_values_1h` is hierarchical (`_1h ← _5m ← _1m ← raw`) and the chain only
 * reaches raw where **every** level's bucket is ahead of **that level's**
 * watermark. `_1h`'s watermark is bounded by its 2-hour `end_offset`; `_1m`'s is
 * not — measured 2026-09-05 on the compose database, `_1m`'s watermark was
 * `16:57` against a `now()` of `16:58`. So a fixture in the current or previous
 * hour is behind `_1m`'s watermark, invisible in `_1m`, and therefore invisible
 * in `_1h`: the first draft of this suite read **0 buckets**. A far-future
 * window is ahead of all four watermarks at once, and no refresh policy can ever
 * reach it (each materialises only up to `now() - end_offset`), so nothing here
 * calls `refresh_continuous_aggregate` and deleting the rows in `afterAll`
 * cannot leave an orphaned aggregate row behind.
 * `assertFixtureIsVisibleInTheHourlyView` runs first and names that mechanism if
 * the assumption ever stops holding.
 *
 * **Fixtures are throwaway and per-run**: one organization, one location, three
 * assets, all coded from {@link RUN_CODE} and deleted in `afterAll`. The cleanup
 * matches this run's code and no other — a constant prefix would let two
 * instances on one database delete each other's committed rows mid-test, which
 * `tests/integration-fixture-isolation.test.ts` refuses. {@link reapStaleFixtures}
 * is the separate, `created_at`-bounded sweep that clears a run which died
 * before its `afterAll`; a stray organization here is not cosmetic, because
 * `verifyHierarchySeed` pins `bms.organizations` at exactly 2 and the `compose
 * up` boot gate runs it.
 *
 * Nothing is read off the seed except `bms.asset_domains`, a vocabulary table
 * that is nobody's fixture row — so none of the hazards in
 * `tests/integration-fixture-isolation.test.ts` or
 * `tests/f4.53-fixture-reads-prefer-seeded-rows.test.ts` apply.
 */

/** The family every run's code starts with. Only the reaper below matches on it. */
const FIXTURE_FAMILY = "F28-PUE-";

/**
 * **This run's** fixture code, and the only pattern the ordinary cleanup
 * deletes by.
 *
 * Unique per file load, the way `TEST_CODE` is in
 * `asset-templates.lifecycle.integration.spec.ts`, because
 * `tests/integration-fixture-isolation.test.ts` refuses a cleanup that sweeps a
 * constant prefix: two instances of one suite on one database would otherwise
 * delete each other's committed rows mid-test.
 */
const RUN_CODE = `${FIXTURE_FAMILY}${randomUUID()}`;

/**
 * How old a fixture row must be before {@link reapStaleFixtures} may remove it.
 *
 * An hour is far longer than this suite's own runtime and far shorter than the
 * interval between developer sessions, so the reaper can only ever reach a run
 * that has already died.
 */
const STALE_AFTER_MS = 3_600_000;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/**
 * The fixture's first hour bucket. Fixed, far future, and on an exact hour
 * boundary so `time_bucket('1 hour', …)` needs no rounding here.
 *
 * A different month from `health-rollup.integration.spec.ts`'s `2031-03-01`, so
 * the two suites cannot share a chunk on a shared database — though the real
 * isolation is that every row below also carries this suite's own random
 * `asset_id`, and `telemetry.point_values` is keyed on `(time, asset_id,
 * point_key)`.
 */
const BASE = new Date("2031-04-01T00:00:00.000Z");

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export interface Fixtures {
  readonly organizationId: string;
  readonly locationId: string;
  /** Paired incomer: uneven sample counts, so an avg-of-averages reader fails. */
  readonly assetA: string;
  /** Paired incomer: even counts, the second term of every Σ below. */
  readonly assetB: string;
  /** Half pair — `site_kw` only. Must be absent from both sums. */
  readonly assetC: string;
  /** Bucket start of the earlier of the fixture's two hours (three samples per key). */
  readonly earlyBucket: Date;
  /** Bucket start of the later hour (one sample per key — the "latest" values). */
  readonly lateBucket: Date;
}

/** A vocabulary read, not a fixture read — `bms.asset_domains` is nobody's fixture row. */
async function anyAssetDomain(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query<{ code: string }>(
    "SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1",
  );
  const code = rows[0]?.code;
  if (!code) {
    throw new Error("bms.asset_domains is empty — run pnpm db:migrate && pnpm db:seed first");
  }
  return code;
}

/**
 * Deletes this suite's telemetry rows by a **constant list of ids**.
 *
 * Never through a subquery or a join: `asset_id` is a `SEGMENTBY` column
 * (migration `0028`), and only a constant filter on it prunes compressed
 * batches — anything else decompresses every batch and dies with
 * `tuple decompression limit exceeded` on a database old enough to have
 * compressed chunks. `tests/adr-0024-retention-bounds.test.ts` is the gate, and
 * it caught the first draft of this function.
 */
async function deleteTelemetryFor(pool: pg.Pool, assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) {
    return;
  }
  // A backticked literal, not a quoted one: `tests/adr-0024-retention-bounds.test.ts`
  // slices each telemetry DELETE it finds to the next backtick in the file, so a
  // quoted form here would swallow the `SELECT` in `assetIdsMatching` below and
  // fail claiming this statement joins. Its own docblock names that trap.
  await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [
    assetIds,
  ]);
}

async function assetIdsMatching(pool: pg.Pool, pattern: string, olderThan?: Date): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    olderThan
      ? "SELECT id FROM bms.assets WHERE code LIKE $1 AND created_at < $2"
      : "SELECT id FROM bms.assets WHERE code LIKE $1",
    olderThan ? [pattern, olderThan] : [pattern],
  );
  return rows.map((r) => r.id);
}

/** Removes exactly this run's rows, innermost first. Safe to call twice. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await deleteTelemetryFor(pool, await assetIdsMatching(pool, `${RUN_CODE}%`));
  await pool.query("DELETE FROM bms.assets WHERE code LIKE $1", [`${RUN_CODE}%`]);
  await pool.query("DELETE FROM bms.locations WHERE code LIKE $1", [`${RUN_CODE}%`]);
  await pool.query("DELETE FROM bms.organizations WHERE code LIKE $1", [`${RUN_CODE}%`]);
}

/**
 * Removes fixtures from a run that died before its `afterAll`, and **only**
 * those — every statement is bounded by `created_at`, which is the one form
 * `tests/integration-fixture-isolation.test.ts` permits a family-wide sweep to
 * take.
 *
 * This is not housekeeping. `verifyHierarchySeed` asserts
 * `COUNT(*) FROM bms.organizations = 2` exactly, it runs on every `db:seed`, and
 * `compose up`'s `migrate` service is what the `api` service waits on — so one
 * orphaned fixture organization stops the whole stack from starting, with an
 * error that names the seed rather than the test that leaked.
 */
export async function reapStaleFixtures(pool: pg.Pool): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const pattern = `${FIXTURE_FAMILY}%`;
  await deleteTelemetryFor(pool, await assetIdsMatching(pool, pattern, cutoff));
  await pool.query("DELETE FROM bms.assets WHERE code LIKE $1 AND created_at < $2", [
    pattern,
    cutoff,
  ]);
  await pool.query("DELETE FROM bms.locations WHERE code LIKE $1 AND created_at < $2", [
    pattern,
    cutoff,
  ]);
  await pool.query("DELETE FROM bms.organizations WHERE code LIKE $1 AND created_at < $2", [
    pattern,
    cutoff,
  ]);
}

/**
 * The sample plan, written out rather than generated.
 *
 * `A` puts three samples in the early bucket and one in the late bucket, so its
 * window mean is `(200·3 + 100) / 4 = 175` while an average of averages would
 * say `(200 + 100) / 2 = 150`. Its **latest** value is the late bucket's `100`,
 * which is what `latestPueRatio` must read — the two functions therefore
 * disagree on the same fixture, on purpose, and neither can pass the other's
 * cases by accident.
 */
function samplePlan(fx: {
  assetA: string;
  assetB: string;
  assetC: string;
  earlyBucket: Date;
  lateBucket: Date;
}): ReadonlyArray<{ time: Date; assetId: string; pointKey: string; value: number }> {
  const prev = (minutes: number): Date => new Date(fx.earlyBucket.getTime() + minutes * MINUTE_MS);
  const cur = (seconds: number): Date => new Date(fx.lateBucket.getTime() + seconds * 1_000);
  return [
    { time: prev(10), assetId: fx.assetA, pointKey: "site_kw", value: 200 },
    { time: prev(20), assetId: fx.assetA, pointKey: "site_kw", value: 200 },
    { time: prev(30), assetId: fx.assetA, pointKey: "site_kw", value: 200 },
    { time: cur(1), assetId: fx.assetA, pointKey: "site_kw", value: 100 },
    { time: prev(10), assetId: fx.assetA, pointKey: "it_kw", value: 50 },
    { time: prev(20), assetId: fx.assetA, pointKey: "it_kw", value: 50 },
    { time: prev(30), assetId: fx.assetA, pointKey: "it_kw", value: 50 },
    { time: cur(2), assetId: fx.assetA, pointKey: "it_kw", value: 50 },
    { time: prev(15), assetId: fx.assetB, pointKey: "site_kw", value: 300 },
    { time: cur(1), assetId: fx.assetB, pointKey: "site_kw", value: 300 },
    { time: prev(15), assetId: fx.assetB, pointKey: "it_kw", value: 100 },
    { time: cur(2), assetId: fx.assetB, pointKey: "it_kw", value: 100 },
    // C is the half pair: a large site load and no IT load at all. 900 is far
    // from A's 100 so a mutated pairing rule cannot answer plausibly.
    { time: prev(15), assetId: fx.assetC, pointKey: "site_kw", value: 900 },
    { time: cur(1), assetId: fx.assetC, pointKey: "site_kw", value: 900 },
  ];
}

export async function setupFixtures(pool: pg.Pool): Promise<Fixtures> {
  await reapStaleFixtures(pool);
  const domain = await anyAssetDomain(pool);

  const orgRows = await pool.query<{ id: string }>(
    "INSERT INTO bms.organizations (code, name) VALUES ($1, $2) RETURNING id",
    [`${RUN_CODE}-ORG`, "F2.8 PUE reader fixture organization"],
  );
  const organizationId = orgRows.rows[0]?.id;
  if (!organizationId) throw new Error("failed to insert the F2.8 fixture organization");

  const locRows = await pool.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
     VALUES ($1, $2, $3, $4, 'site', 0, 0) RETURNING id`,
    [
      organizationId,
      `${RUN_CODE}-LOC`,
      `f28-pue-loc-${RUN_CODE.toLowerCase()}`,
      "F2.8 PUE reader fixture site",
    ],
  );
  const locationId = locRows.rows[0]?.id;
  if (!locationId) throw new Error("failed to insert the F2.8 fixture location");

  const assetIds: string[] = [];
  for (const label of ["A", "B", "C"]) {
    const rows = await pool.query<{ id: string }>(
      `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        organizationId,
        `${RUN_CODE}-AST-${label}`,
        `F2.8 fixture incomer ${label}`,
        "F2.8 fixture site",
        locationId,
        domain,
      ],
    );
    const id = rows.rows[0]?.id;
    if (!id) throw new Error(`failed to insert the F2.8 fixture asset ${label}`);
    assetIds.push(id);
  }
  const [assetA, assetB, assetC] = assetIds as [string, string, string];

  const earlyBucket = BASE;
  const lateBucket = new Date(BASE.getTime() + HOUR_MS);
  for (const s of samplePlan({ assetA, assetB, assetC, earlyBucket, lateBucket })) {
    await pool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES ($1, $2, $3, $4, 'kW')`,
      [s.time.toISOString(), s.assetId, s.pointKey, s.value],
    );
  }

  return { organizationId, locationId, assetA, assetB, assetC, earlyBucket, lateBucket };
}

/** End of the fixture's two-hour span — inclusive of the late bucket, exclusive of nothing else. */
function fullWindowEnd(fx: Fixtures): Date {
  return new Date(fx.lateBucket.getTime() + HOUR_MS - 1);
}

/**
 * Anti-vacuity, and it runs before every windowed case.
 *
 * `db:seed` writes **zero** `telemetry.point_values` rows, so a windowed
 * assertion that silently saw nothing would compare `null` against `null` and
 * pass having proved nothing. This reads the hourly view directly and fails with
 * the cause named, because the one way it can go wrong — a watermark pushed past
 * the fixture window by another suite — reports otherwise as "expected 3.5, got
 * null" and costs an hour.
 */
export async function assertFixtureIsVisibleInTheHourlyView(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const { rows } = await pool.query<{ bucket: Date; sum_value: string; sample_count: string }>(
    `SELECT bucket, sum_value, sample_count
     FROM telemetry.point_values_1h
     WHERE asset_id = $1 AND point_key = 'site_kw' AND bucket >= $2
     ORDER BY bucket ASC`,
    [fx.assetA, fx.earlyBucket.toISOString()],
  );
  const counts = rows.map((r) => Number(r.sample_count));
  const total = counts.reduce((a, b) => a + b, 0);
  assert(
    rows.length === 2 && total === 4,
    "the F2.8 fixture is not visible in telemetry.point_values_1h " +
      `(${rows.length} buckets, ${total} samples; expected 2 and 4). The fixture sits in a ` +
      "far-future window so that every level of the _1h ← _5m ← _1m ← raw chain serves it from " +
      "the real-time branch; if a suite has pushed a watermark past 2031 — the failure mode " +
      "`point-aggregates.integration.test.ts` documents in its header — this fixture becomes " +
      "invisible and every windowed case below would pass vacuously.",
  );
  assert(
    counts[0] === 3 && counts[1] === 1,
    `expected the uneven 3/1 sample split that makes an avg-of-averages reader fail, got ${counts.join("/")}`,
  );
}

/** Ruling 3: Σ 400 / Σ 150 over two paired incomers, the plan's worked case. */
export async function assertLatestSumsBothIncomers(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const got = await latestPueRatio(pool, [fx.assetA, fx.assetB]);
  assert(got === 2.67, `expected (100 + 300) / (50 + 100) = 2.67, got ${JSON.stringify(got)}`);
}

/** Ruling 3's single-site reduction, and a scope that excludes A. */
export async function assertLatestOneIncomerIsItsOwnRatio(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const alone = await latestPueRatio(pool, [fx.assetB]);
  assert(alone === 3, `one incomer must reduce to 300 / 100 = 3, got ${JSON.stringify(alone)}`);
  // A scope that excludes A but still carries the unpaired C: the answer must be
  // B's own ratio, unchanged by C's 900 kW.
  const excludingA = await latestPueRatio(pool, [fx.assetB, fx.assetC]);
  assert(
    excludingA === 3,
    `a scope excluding A must be B's own ratio 3, got ${JSON.stringify(excludingA)}`,
  );
}

/**
 * **The mutation case.** `HAVING COUNT(*) = 2` → `>= 1` answers
 * `(100 + 900) / 50 = 20` here. `[c]` alone is asserted too, but only this pair
 * discriminates — see the header.
 */
export async function assertHalfPairIsExcludedFromBothSums(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const withHalfPair = await latestPueRatio(pool, [fx.assetA, fx.assetC]);
  assert(
    withHalfPair === 2,
    "an incomer computing site_kw but not it_kw must be left out of BOTH sums (ruling 3): " +
      `expected A's own 100 / 50 = 2, got ${JSON.stringify(withHalfPair)}`,
  );
  const halfPairAlone = await latestPueRatio(pool, [fx.assetC]);
  assert(
    halfPairAlone === null,
    `a scope holding only a half pair has no PUE, got ${JSON.stringify(halfPairAlone)}`,
  );
}

/** An empty scope is "nothing readable", not "every incomer". */
export async function assertEmptyScopeIsNull(pool: pg.Pool): Promise<void> {
  const got = await latestPueRatio(pool, []);
  assert(got === null, `an empty scope must be null, got ${JSON.stringify(got)}`);
}

/**
 * A `null` scope is every incomer in the database — the global admin's read.
 *
 * Asserted against an independently formulated reference (an INNER JOIN of two
 * `DISTINCT ON` reads, where the implementation uses `GROUP BY … HAVING`), so
 * this holds whatever else the shared database happens to contain, and the
 * count check keeps it from passing on an empty estate.
 */
export async function assertNullScopeReadsEveryIncomer(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const { rows } = await pool.query<{ incomers: number; site_kw: string; it_kw: string }>(
    `WITH site AS (
       SELECT DISTINCT ON (asset_id) asset_id, value
       FROM telemetry.point_values WHERE point_key = 'site_kw'
       ORDER BY asset_id, time DESC
     ),
     it AS (
       SELECT DISTINCT ON (asset_id) asset_id, value
       FROM telemetry.point_values WHERE point_key = 'it_kw'
       ORDER BY asset_id, time DESC
     )
     SELECT COUNT(*)::int AS incomers,
            COALESCE(SUM(site.value), 0)::float8 AS site_kw,
            COALESCE(SUM(it.value), 0)::float8 AS it_kw
     FROM site INNER JOIN it ON it.asset_id = site.asset_id`,
  );
  const reference = rows[0];
  assert(reference !== undefined, "the reference query returned no row");
  const incomers = Number(reference?.incomers ?? 0);
  assert(
    incomers >= 2,
    `expected the unscoped read to see at least this suite's two paired incomers, saw ${incomers}`,
  );
  const expected =
    Math.round((Number(reference?.site_kw) / Number(reference?.it_kw)) * 100) / 100;
  const got = await latestPueRatio(pool, null);
  assert(
    got === expected,
    `a null scope must read every incomer: expected ${expected} over ${incomers} incomers, got ${JSON.stringify(got)}`,
  );
  // And the fixture is inside that set: A and B alone are 2.67, so the estate
  // figure cannot be the fixture's by coincidence unless nothing else reports.
  assert(
    fx.assetA !== fx.assetB,
    "fixture assets collapsed to one id — the scoped cases above would be meaningless",
  );
}

/**
 * The window mean, and the case that fails under an average of averages.
 *
 * A: `(200·3 + 100) / 4 = 175` over `(50·3 + 50) / 4 = 50` → **3.5**. The naive
 * `avg(sum_value / sample_count)` says `150 / 50 = 3.0`.
 */
export async function assertWindowedUsesTheWeightedMean(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const got = await windowedPueRatio(pool, {
    level: "1h",
    start: fx.earlyBucket,
    end: fullWindowEnd(fx),
    assetIds: [fx.assetA],
  });
  assert(
    got === 3.5,
    "the window mean must be sum(sum_value) / sum(sample_count), never an average of " +
      `averages (which would answer 3): expected 3.5, got ${JSON.stringify(got)}`,
  );
}

/** Ruling 3 over a window: Σ of the two window means, not a mean of ratios. */
export async function assertWindowedSumsBothIncomers(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const got = await windowedPueRatio(pool, {
    level: "1h",
    start: fx.earlyBucket,
    end: fullWindowEnd(fx),
    assetIds: [fx.assetA, fx.assetB],
  });
  assert(
    got === 3.17,
    `expected (175 + 300) / (50 + 100) = 3.17, got ${JSON.stringify(got)}`,
  );
}

/** The half pair is dropped from a windowed read for the same reason. */
export async function assertWindowedExcludesTheHalfPair(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const withHalfPair = await windowedPueRatio(pool, {
    level: "1h",
    start: fx.earlyBucket,
    end: fullWindowEnd(fx),
    assetIds: [fx.assetA, fx.assetC],
  });
  assert(
    withHalfPair === 3.5,
    `C's 900 kW window mean must not enter either sum: expected 3.5, got ${JSON.stringify(withHalfPair)}`,
  );
  const halfPairAlone = await windowedPueRatio(pool, {
    level: "1h",
    start: fx.earlyBucket,
    end: fullWindowEnd(fx),
    assetIds: [fx.assetC],
  });
  assert(
    halfPairAlone === null,
    `a windowed scope holding only a half pair has no PUE, got ${JSON.stringify(halfPairAlone)}`,
  );
}

/**
 * Both bounds, each proved by a bucket the other window excludes.
 *
 * Narrowed to the late bucket, A is `100 / 50 = 2` and B is `300 / 100`, so the
 * pair is `400 / 150 = 2.67`. Narrowed to the early bucket — `end` one
 * millisecond before the late bucket — A is `200 / 50 = 4` and the pair is
 * `500 / 150 = 3.33`. Neither equals the 3.17 of the full window, so a reader
 * that dropped either predicate fails here.
 */
export async function assertWindowBoundsExcludeOutsideBuckets(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const lateBucketOnly = await windowedPueRatio(pool, {
    level: "1h",
    start: fx.lateBucket,
    end: fullWindowEnd(fx),
    assetIds: [fx.assetA, fx.assetB],
  });
  assert(
    lateBucketOnly === 2.67,
    `a window starting at the late bucket must drop the early one: expected 2.67, got ${JSON.stringify(lateBucketOnly)}`,
  );
  const earlyBucketOnly = await windowedPueRatio(pool, {
    level: "1h",
    start: fx.earlyBucket,
    end: new Date(fx.lateBucket.getTime() - 1),
    assetIds: [fx.assetA, fx.assetB],
  });
  assert(
    earlyBucketOnly === 3.33,
    `a window ending before the late bucket must drop it: expected 3.33, got ${JSON.stringify(earlyBucketOnly)}`,
  );
}

/** An empty scope is null on the windowed read too — the service's own guard is separate. */
export async function assertWindowedEmptyScopeIsNull(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const got = await windowedPueRatio(pool, {
    level: "1h",
    start: fx.earlyBucket,
    end: fullWindowEnd(fx),
    assetIds: [],
  });
  assert(got === null, `an empty windowed scope must be null, got ${JSON.stringify(got)}`);
}
