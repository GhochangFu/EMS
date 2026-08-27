import { randomUUID } from "node:crypto";

import { refreshAggregatesFrom } from "@bms/db";
import type pg from "pg";

import type { EnergyReportQuery } from "./reports.schema";
import { ReportsService } from "./reports.service";

/**
 * `E7.1b` — why the energy report must read on the fleet (BYPASSRLS) pool.
 *
 * `ReportsService` moved from `TENANT_POOL` to `FLEET_POOL` (commit `5b314db`,
 * ADR 0043 Amendment 3). The report has two reads that touch `bms.assets`, which
 * migration `0047` gave `organization_id` + a `tenant_isolation` policy +
 * `FORCE`:
 *
 * - `energyTopConsumers` — `INNER JOIN bms.assets a ON a.id = v.asset_id`.
 * - `energySourceTotals` — the `solar_ids` CTE, `SELECT id FROM bms.assets WHERE
 *   code ILIKE 'PV%'`.
 *
 * On a bare tenant pool with no `app.current_organization` GUC, the FORCE policy
 * returns **zero** rows from `bms.assets` for every caller — so the inner join
 * empties `topConsumers`, and `solar_ids` empties, which misattributes all solar
 * generation to grid. The report's telemetry aggregate (`aggregateRelation`) is
 * unpoliced, so `summary.totalKwh` stays non-zero. That asymmetry is the whole
 * client-visible harm the constructor comment claims, and it is what this proves.
 *
 * ## Why this needs a telemetry fixture, and why it refreshes production
 *
 * Both diverging reads join telemetry to `bms.assets`, so with **no** telemetry
 * both pools return all-zero output and the divergence is invisible — the same
 * "the fixture is the point" trap `F4.1`/`F4.2` document. `db:seed` writes zero
 * `telemetry.point_values` rows, so this suite must create its own, and it reads
 * the shipped `aggregateRelation(level)` → `telemetry.point_values_1h`, not a
 * probe view: pointing the service at a throwaway cagg would prove a probe
 * relation diverges, not the one that ships.
 *
 * Freshly inserted rows sit behind `_1h`'s watermark, so the fixture is
 * materialised by refreshing `_1m`/`_5m`/`_1h`. **This is the watermark-safe
 * refresh, not the hazard `point-aggregates.integration.spec.ts:11-33`
 * describes.** That hazard was a window *derived from the aggregate's own
 * watermark and padded two days past it*, which ratchets the watermark forward
 * forever. Here the window ends at `now()`, so no watermark moves past the
 * present — the identical licence `assertEnergySummaryMatchesRaw` runs under, and
 * what `_1m`'s own scheduled policy (`[now-3h, now-1min]`) does every minute.
 *
 * ## The cleanup is load-bearing, because `point_key = 'kw'` is shared
 *
 * The report hard-codes `point_key = 'kw'`, which is exactly what the live
 * simulator writes, so this suite **cannot** fence its rows off with a distinct
 * marker key the way `F4.1` uses `TEST_POINT_KEY`, and a range-shaped
 * `DELETE ... WHERE ... AND time >= $2` would delete real simulator rows in the
 * window. So every insert uses `ON CONFLICT DO NOTHING RETURNING`, capturing only
 * the `(time, asset_id)` pairs this suite actually created; cleanup deletes
 * exactly those and re-refreshes the aggregates — leaving no orphan aggregate
 * rows (the self-poisoning failure `assertEnergySummaryMatchesRaw`'s finally
 * block exists to prevent). A refresh that throws during setup cleans up before
 * rethrowing, so the guarantee holds even when `beforeAll` fails.
 *
 * The delete is issued **per asset**, with `asset_id` and `point_key` as constant
 * equality filters and the exact timestamps in `time = ANY(...)`. `asset_id` and
 * `point_key` are `0028` SEGMENTBY columns, and only a constant filter on them
 * prunes compressed batches — a `USING`/subquery join would force TimescaleDB to
 * decompress every batch (`tuple decompression limit exceeded`). That is the
 * `tests/adr-0024-retention-bounds.test.ts` invariant, and it is why this is not
 * a single `DELETE ... USING unnest(pairs)`.
 *
 * ## Why the two fixture assets are named by exact code
 *
 * They used to be resolved by pattern: `code ILIKE 'PV%' ORDER BY code LIMIT 1`
 * for the solar one, `code NOT ILIKE 'PV%' ORDER BY code LIMIT 1` for its
 * sibling. That reads *whatever currently sorts first*, not *what the seed
 * contains* — and `rollup-conversion.integration.spec.ts` commits a probe asset
 * coded `PV-F428-PROBE` for the whole of its run. `PV-F428-PROBE` sorts **before**
 * `PV-INV-01`, the only seeded `PV%` asset, so whenever the two files overlapped
 * in one Vitest invocation this suite adopted the other suite's fixture as its
 * own: it wrote 1890 `kw` rows onto a foreign probe and refreshed the production
 * aggregates over them, while that suite's `cleanupProbes` deleted the asset and
 * every telemetry row on it. Both then failed on the other's damage, neither
 * naming the collision — `fleet: the PV fixture asset must appear in
 * topConsumers` here, and
 * `this check requires the raw fixture to be deleted first; 1890 rows remain`
 * there. Reproduced 2026-08-27; the count is this suite's own per-asset insert
 * total (120 minutes x mean(1,5,17,40) = 1890), which is what identifies the
 * writer.
 *
 * `integration-fixtures.ts` already states the rule this broke: **`ORDER BY` does
 * not close the race, it narrows it** — "by code it depends on every other
 * suite's prefix convention holding forever". `tests/integration-fixture-
 * isolation.test.ts` even names the convention and the fact that it is "a
 * convention holding, not a constraint". `PV-F428-PROBE` is the first fixture
 * code in the tree that sorts ahead of the seeded row a pattern read wanted.
 *
 * An exact `code = ANY(...)` cannot adopt a foreign row: every committed fixture
 * code in this repository carries its own prefix, and no suite creates
 * `PV-INV-01` or `CH-CRAC-101`. It also serves the reason the pattern read was
 * chosen for — a seed rename — strictly better: the resolver returns nothing and
 * trips its own `run pnpm db:seed` assertion by name, where the pattern silently
 * selected something else. {@link assertForeignPvFixtureIsNotAdopted} proves the
 * property against a planted decoy rather than asserting it in prose, and
 * `tests/integration-fixture-isolation.test.ts` gates the class statically.
 *
 * ## What this proves, and what it does not
 *
 * A **necessity** proof: the read has to be on fleet for the report to work.
 * Each assertion constructs `ReportsService` with an explicit pool, so none of
 * them gates the `@Inject(FLEET_POOL)` token — reverting the decorator to
 * `TENANT_POOL` leaves these green. That token is gated by
 * `database/fleet-read-wiring.test.ts`; this suite is the behavioural half.
 */

/** Point key the report hard-codes; shared with the live simulator (see header). */
const POINT_KEY = "kw";

/**
 * The seeded solar asset, by exact code — see the header section on the
 * 2026-08-27 adoption flake.
 *
 * Must satisfy the report's own `code ILIKE 'PV%'` split, which
 * {@link resolveEnergyFixtureAssets} asserts rather than assumes: renaming this
 * constant to a non-`PV` code would leave every assertion below comparing zero
 * to zero.
 *
 * Written by `packages/db/src/eskom-assets-seed.ts`. Nothing under `apps/**` or
 * `tests/**` creates or deletes it — the committed-fixture suites sweep only
 * their own prefixes — so unlike a pattern read this cannot resolve to another
 * suite's row.
 */
const SOLAR_ASSET_CODE = "PV-INV-01";

/**
 * Its non-solar sibling, by exact code, and in the **same** organization so one
 * `app.current_organization` GUC makes both visible. The same-org premise is
 * asserted in {@link resolveEnergyFixtureAssets}: a seed that moved either row
 * to another organization would otherwise turn the positive control into a
 * silent half-pass.
 */
const GRID_ASSET_CODE = "CH-CRAC-101";

/** Two hours of minute-level readings, uneven per minute so buckets are non-trivial. */
const FIXTURE_MINUTES = 120;
const SAMPLES_PER_MINUTE = [1, 5, 17, 40] as const;

/**
 * A distinctive fractional-second offset that lowers the chance of a fixture
 * timestamp colliding with an existing row. It is only a belt: measured against a
 * live database, other writers do land on `.137` occasionally, so this is **not**
 * a uniqueness guarantee. The guarantee is the `RETURNING`-captured cleanup — it
 * removes only the `(time, asset_id)` pairs this insert actually created, so a
 * pre-existing row sharing a timestamp is never inserted over and never deleted.
 */
const SUBSECOND_MS = 137;

/**
 * An assertion signature (`asserts condition`) rather than a plain `void`, so a
 * checked premise narrows for the code after it. Without that, every use below
 * needs an `as string` or a `?.` that quietly re-admits the case the assertion
 * just ruled out — which is how `pv.organization_id as string` got written here
 * before {@link resolveEnergyFixtureAssets} existed.
 */
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export interface EnergyRlsFixture {
  /** The seeded `PV%`-coded asset (solar), resolved by exact code as fleet. */
  readonly pvAssetId: string;
  /** Its non-`PV%` sibling in the **same** organization, so one GUC makes both visible. */
  readonly otherAssetId: string;
  /** The organization both fixture assets belong to. */
  readonly organizationId: string;
  /** The date-range the report is asked for; brackets the recent fixture window. */
  readonly query: EnergyReportQuery;
  /** Exactly the rows this suite inserted, for precise cleanup. */
  readonly insertedTimes: string[];
  readonly insertedAssets: string[];
  /**
   * The lower bound both the setup and the cleanup refresh use — one bucket before
   * the fixture. Carried as a constant rather than re-derived from `insertedTimes`,
   * whose `RETURNING` order SQL does not guarantee: a cleanup refresh that started
   * later than the earliest fixture bucket would leave that bucket un-recomputed
   * (an orphan aggregate row), the self-poisoning `assertEnergySummaryMatchesRaw`
   * guards against.
   */
  readonly refreshFromIso: string;
}

/** The two fixture assets scoped into every `energyPreview` call. */
function scopedAssetIds(fx: EnergyRlsFixture): string[] {
  return [fx.pvAssetId, fx.otherAssetId];
}

/** What {@link resolveEnergyFixtureAssets} returns — the seed rows, and their org. */
export interface EnergyFixtureAssets {
  readonly pvAssetId: string;
  readonly otherAssetId: string;
  readonly organizationId: string;
}

/**
 * Resolves the two seeded fixture assets by exact code, as **fleet** (BYPASSRLS).
 *
 * Exported and taking a `pg.PoolClient` as well as a `pg.Pool` for one reason:
 * {@link assertForeignPvFixtureIsNotAdopted} drives it inside its own
 * transaction, against a planted decoy, so the "cannot adopt a foreign row"
 * property is executed rather than argued. See the exact-code section in the
 * header for what adopting one did.
 *
 * Every premise the three assertions rest on is checked here rather than
 * downstream: both rows exist, the solar one really is `PV%`-coded, the other one
 * really is not, and both carry the same non-null organization.
 */
export async function resolveEnergyFixtureAssets(
  fleet: pg.Pool | pg.PoolClient,
): Promise<EnergyFixtureAssets> {
  const { rows } = await fleet.query<{
    code: string;
    id: string;
    organization_id: string | null;
  }>(`SELECT code, id, organization_id FROM bms.assets WHERE code = ANY($1::text[])`, [
    [SOLAR_ASSET_CODE, GRID_ASSET_CODE],
  ]);

  const pv = rows.find((r) => r.code === SOLAR_ASSET_CODE);
  const other = rows.find((r) => r.code === GRID_ASSET_CODE);
  assert(
    pv !== undefined,
    `E7.1b energy RLS fixture needs the seeded asset ${SOLAR_ASSET_CODE}; run \`pnpm db:seed\`. ` +
      "If the seed renamed it, rename SOLAR_ASSET_CODE here — do not widen this back to a " +
      "`code ILIKE 'PV%'` scan, which adopts another suite's committed probe (see the " +
      "exact-code section in this file's header).",
  );
  assert(
    other !== undefined,
    `E7.1b energy RLS fixture needs the seeded asset ${GRID_ASSET_CODE}; run \`pnpm db:seed\`. ` +
      "Same rule as above: rename the constant, do not restore the pattern read.",
  );

  // The report splits solar with `code ILIKE 'PV%'`, so the codes above are not
  // interchangeable labels — one must match that predicate and the other must
  // not, or `sourceTotals.solarKwh` is zero on every pool and the divergence
  // this suite exists to show becomes invisible.
  assert(
    /^PV/i.test(SOLAR_ASSET_CODE),
    `SOLAR_ASSET_CODE is "${SOLAR_ASSET_CODE}", which the report's \`code ILIKE 'PV%'\` split ` +
      "does not match — solarKwh would be 0 on every pool and every assertion here vacuous",
  );
  assert(
    !/^PV/i.test(GRID_ASSET_CODE),
    `GRID_ASSET_CODE is "${GRID_ASSET_CODE}", which the report reads as solar. The second ` +
      "fixture asset must be non-solar for the grid/solar attribution to mean anything.",
  );

  const organizationId = pv.organization_id;
  assert(
    typeof organizationId === "string",
    `${SOLAR_ASSET_CODE} carries no organization_id — 0047 gave bms.assets a NOT NULL tenant ` +
      "column, so an unmigrated or hand-edited database is the likely cause",
  );
  assert(
    other.organization_id === organizationId,
    `${SOLAR_ASSET_CODE} (${organizationId}) and ${GRID_ASSET_CODE} ` +
      `(${other.organization_id}) are in different organizations. One \`app.current_organization\` ` +
      "GUC cannot make both visible, so the third assertion would half-pass.",
  );

  return { pvAssetId: pv.id, otherAssetId: other.id, organizationId };
}

/**
 * Resolves the two fixture assets and materialises `kw` telemetry for both.
 *
 * Assets are read as **fleet** (BYPASSRLS) by {@link resolveEnergyFixtureAssets}
 * — the seed's `PV-INV-01` and its same-org sibling `CH-CRAC-101`, named by exact
 * code. The exact-code section in this file's header is why they are not resolved
 * by pattern, and what it cost when they were.
 *
 * The refresh is `@bms/db`'s `refreshAggregatesFrom` — the same shared helper the
 * `CalcWriteService`/`TelemetryWriteService` write paths use — rather than a
 * hand-rolled one: it takes the role (`bms_rollup`) itself, refreshes every level
 * finest-first, caps the window at `now()` (watermark-safe), and applies the
 * `REFRESH_MARGIN_MS` a bare `refresh_continuous_aggregate(view, from, now())`
 * needs to not silently skip a boundary bucket.
 */
export async function setUpEnergyFixture(
  ownerPool: pg.Pool,
  fleetPool: pg.Pool,
): Promise<EnergyRlsFixture> {
  const { pvAssetId, otherAssetId, organizationId } =
    await resolveEnergyFixtureAssets(fleetPool);

  // Recent, uneven, distinct sub-second timestamps. `base` is far enough inside
  // today's window that a two-date range brackets it regardless of the hour.
  const base = Date.now() - 3 * 3_600_000;
  const times: string[] = [];
  const assetsArr: string[] = [];
  const values: number[] = [];
  const fixtureAssets: { id: string; magnitude: number }[] = [
    { id: pvAssetId, magnitude: 40 },
    { id: otherAssetId, magnitude: 55 },
  ];
  for (const { id, magnitude } of fixtureAssets) {
    for (let minute = 0; minute < FIXTURE_MINUTES; minute += 1) {
      const n = SAMPLES_PER_MINUTE[minute % SAMPLES_PER_MINUTE.length] ?? 1;
      for (let s = 0; s < n; s += 1) {
        times.push(new Date(base + minute * 60_000 + s * 1_000 + SUBSECOND_MS).toISOString());
        assetsArr.push(id);
        values.push(magnitude + minute * 0.25 + s * 0.1);
      }
    }
  }

  // `RETURNING` so only rows this insert actually created are captured — a
  // pre-existing simulator row at the same key is left untouched and, crucially,
  // is never scheduled for deletion.
  const inserted = await ownerPool.query<{ time: string; asset_id: string }>(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT t, a::uuid, $3, v, 'kW'
     FROM unnest($1::timestamptz[], $2::uuid[], $4::float8[]) AS x(t, a, v)
     ON CONFLICT DO NOTHING
     RETURNING time::text AS time, asset_id::text AS asset_id`,
    [times, assetsArr, POINT_KEY, values],
  );
  assert(
    inserted.rows.length > 0,
    "E7.1b energy RLS fixture inserted no telemetry rows — the window collided entirely with " +
      "existing data, so nothing this suite owns landed and cleanup would have nothing to remove",
  );

  const refreshFromIso = new Date(base - 3_600_000).toISOString();
  const fx: EnergyRlsFixture = {
    pvAssetId,
    otherAssetId,
    organizationId,
    query: { startDate: refreshFromIso.slice(0, 10), endDate: new Date().toISOString().slice(0, 10) },
    insertedTimes: inserted.rows.map((r) => r.time),
    insertedAssets: inserted.rows.map((r) => r.asset_id),
    refreshFromIso,
  };

  // The insert is already committed, so if the refresh throws (e.g. `55P03`
  // exhausts its retries) the harness's `fx`-guarded `afterAll` would never see
  // this fixture and the rows would orphan. Clean up here before rethrowing, so
  // the "leaves nothing behind" guarantee holds even on a failed setup.
  try {
    await refreshAggregatesFrom(ownerPool, new Date(refreshFromIso));
  } catch (err) {
    await cleanupEnergyFixture(ownerPool, fx);
    throw err;
  }

  return fx;
}

/**
 * Deletes exactly the rows {@link setUpEnergyFixture} inserted and re-refreshes,
 * so neither raw telemetry nor an orphan aggregate bucket outlives the run.
 * Never throws from a cleanup path — a `finally` caller must not have a real
 * assertion failure replaced by a teardown error — but warns, because leftover
 * orphans would fail an unrelated suite later.
 */
export async function cleanupEnergyFixture(
  ownerPool: pg.Pool,
  fx: EnergyRlsFixture,
): Promise<void> {
  if (fx.insertedTimes.length === 0) {
    return;
  }
  try {
    // Per asset: `asset_id`/`point_key` constant so the delete prunes compressed
    // batches rather than decompressing every one (the `0028` SEGMENTBY rule the
    // adr-0024-retention-bounds invariant enforces), with the exact captured
    // timestamps in `time = ANY(...)` so only this suite's rows are removed.
    const timesByAsset = new Map<string, string[]>();
    for (let i = 0; i < fx.insertedAssets.length; i += 1) {
      const assetId = fx.insertedAssets[i] as string;
      const list = timesByAsset.get(assetId) ?? [];
      list.push(fx.insertedTimes[i] as string);
      timesByAsset.set(assetId, list);
    }
    for (const [assetId, times] of timesByAsset) {
      await ownerPool.query(
        `DELETE FROM telemetry.point_values
         WHERE asset_id = $1 AND point_key = $2 AND time = ANY($3::timestamptz[])`,
        [assetId, POINT_KEY, times],
      );
    }
    // Re-materialise from the same lower bound, so the buckets that held fixture
    // rows are recomputed from a now-empty raw range and no orphan aggregate row
    // survives (ADR 0024 fact 7). The DELETE ran first, so even if this refresh
    // fails the raw rows are already gone.
    await refreshAggregatesFrom(ownerPool, new Date(fx.refreshFromIso));
  } catch (err: unknown) {
    process.stderr.write(
      `\n[E7.1b] WARNING: energy RLS fixture cleanup failed: ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Leftover kw rows / orphan aggregate buckets may remain. Repair with:\n" +
        "        pnpm db:refresh-aggregates\n\n",
    );
  }
}

/**
 * **Positive control on the shipped path.** On the fleet pool the report resolves
 * fully: both scoped assets appear in `topConsumers`, and the PV asset's
 * generation is attributed to solar rather than grid.
 */
export async function assertReportResolvesOnFleet(
  fleetPool: pg.Pool,
  fx: EnergyRlsFixture,
): Promise<void> {
  const svc = new ReportsService(fleetPool);
  const preview = await svc.energyPreview(fx.query, scopedAssetIds(fx));

  assert(
    preview.summary.totalKwh > 0,
    `fleet: summary.totalKwh must be > 0 for the fixture, got ${preview.summary.totalKwh}`,
  );
  assert(
    preview.topConsumers.some((c) => c.assetId === fx.pvAssetId),
    "fleet: the PV fixture asset must appear in topConsumers",
  );
  assert(
    preview.topConsumers.some((c) => c.assetId === fx.otherAssetId),
    "fleet: the non-PV fixture asset must appear in topConsumers",
  );
  assert(
    preview.sourceTotals.solarKwh > 0,
    `fleet: PV generation must be attributed to solar, got solarKwh=${preview.sourceTotals.solarKwh}`,
  );
}

/**
 * **The divergence.** On a bare tenant pool the `bms.assets` reads go dark under
 * `0047` FORCE, so `topConsumers` is empty and solar is misattributed to grid —
 * while the unpoliced telemetry aggregate keeps `totalKwh` non-zero. That last
 * assertion is not decoration: it rules out "the fixture never landed" and
 * "this pool cannot read the cagg" as the reason `topConsumers` is empty.
 */
export async function assertReportGoesDarkOnBareTenant(
  bareTenantPool: pg.Pool,
  fx: EnergyRlsFixture,
): Promise<void> {
  const svc = new ReportsService(bareTenantPool);
  const preview = await svc.energyPreview(fx.query, scopedAssetIds(fx));

  assert(
    preview.topConsumers.length === 0,
    `bare tenant: topConsumers must be empty under 0047 FORCE with no GUC, got ` +
      `${preview.topConsumers.length}`,
  );
  assert(
    preview.summary.totalKwh > 0,
    `bare tenant: the unpoliced telemetry aggregate must still return totalKwh > 0 — otherwise ` +
      `the empty topConsumers proves nothing about RLS. Got ${preview.summary.totalKwh}`,
  );
  assert(
    preview.sourceTotals.solarKwh === 0,
    `bare tenant: solar must be misattributed to grid (solar_ids goes dark), got ` +
      `solarKwh=${preview.sourceTotals.solarKwh}`,
  );
}

/**
 * **Pins the cause to the missing GUC.** The same tenant role, now carrying
 * `app.current_organization` for the fixture org, resolves the report again.
 * This is what turns "empty on the bare pool" into "empty *because* no GUC under
 * FORCE" rather than any incidental defect in the fixture or the pool.
 */
export async function assertReportResolvesWithOrgGuc(
  gucTenantPool: pg.Pool,
  fx: EnergyRlsFixture,
): Promise<void> {
  const svc = new ReportsService(gucTenantPool);
  const preview = await svc.energyPreview(fx.query, scopedAssetIds(fx));

  assert(
    preview.topConsumers.some((c) => c.assetId === fx.pvAssetId),
    "tenant + org GUC: the PV fixture asset must reappear in topConsumers once the GUC is set",
  );
  assert(
    preview.topConsumers.some((c) => c.assetId === fx.otherAssetId),
    "tenant + org GUC: the non-PV fixture asset must reappear in topConsumers once the GUC is set",
  );
  assert(
    preview.sourceTotals.solarKwh > 0,
    `tenant + org GUC: solar must be attributed again once the GUC is set, got ` +
      `solarKwh=${preview.sourceTotals.solarKwh}`,
  );
}

/**
 * **The 2026-08-27 adoption regression, executed rather than argued.** Plants an asset that
 * sorts ahead of every seeded `PV%` code and proves
 * {@link resolveEnergyFixtureAssets} still returns the seeded row.
 *
 * The decoy is a stand-in for `rollup-conversion.integration.spec.ts`'s
 * `PV-F428-PROBE`, which really did get adopted here (see the exact-code section
 * in this file's header). Restoring the old `code ILIKE 'PV%' ORDER BY code LIMIT 1`
 * read fails this immediately — the decoy sorts first by construction, and the
 * sanity check below proves that rather than trusting the collation.
 *
 * **It runs inside its own transaction and rolls back**, which is the same
 * property `integration-fixtures.ts` names as the only one that closes this class
 * of race: an uncommitted row is invisible to every other connection, so planting
 * a `PV%` decoy cannot itself become the hazard it is testing for. That is also
 * why this takes a checked-out client rather than the pool — a pooled `BEGIN` and
 * the `SELECT` after it can land on different connections.
 *
 * `randomUUID()` in the code, not a constant: two instances of this file on one
 * database would otherwise collide on `assets_code_unique`, and an uncommitted
 * duplicate key blocks the second inserter until the first transaction ends.
 */
export async function assertForeignPvFixtureIsNotAdopted(
  fleetPool: pg.Pool,
  fx: EnergyRlsFixture,
): Promise<void> {
  const client = await fleetPool.connect();
  try {
    await client.query("BEGIN");

    // `PV-AAA-` sorts before `PV-INV-01`, and before `PV-F428-PROBE` too, so this
    // is a decoy for any future fixture prefix as well as the one that bit.
    // Columns are copied from the seeded row so the insert cannot fail on a NOT
    // NULL or a foreign key this suite would otherwise have to track.
    const decoyCode = `PV-AAA-E71B-DECOY-${randomUUID()}`;
    const { rows: planted } = await client.query<{ id: string }>(
      `INSERT INTO bms.assets (code, name, site_name, domain, location_id, organization_id)
       SELECT $1, $1, 'E7.1b decoy site', a.domain, a.location_id, a.organization_id
       FROM bms.assets a WHERE a.code = $2
       RETURNING id`,
      [decoyCode, SOLAR_ASSET_CODE],
    );
    const decoyId = planted[0]?.id;
    assert(
      typeof decoyId === "string",
      `the decoy asset was not created from ${SOLAR_ASSET_CODE}; this assertion proves nothing ` +
        "without it",
    );

    // The premise, measured on this database's collation rather than assumed: the
    // decoy really is what the old pattern read would have returned. Without this
    // the test would pass on a collation where it sorted last, for the wrong
    // reason.
    //
    // Scoped to the two ids rather than written as the forbidden
    // `WHERE code ILIKE 'PV%' ORDER BY code LIMIT 1` — an id-scoped read cannot
    // adopt anything, so this guard does not have to exempt itself from the rule
    // in `tests/integration-fixture-isolation.test.ts` that it exists to support.
    // It orders the real rows under the real collation, which is the whole
    // premise; any third `PV%` row present would be another foreign fixture, so
    // "the decoy beats the seeded row" is the claim that matters either way.
    const { rows: wouldHaveBeen } = await client.query<{ id: string }>(
      `SELECT id FROM bms.assets WHERE id = ANY($1::uuid[]) ORDER BY code LIMIT 1`,
      [[decoyId, fx.pvAssetId]],
    );
    assert(
      wouldHaveBeen[0]?.id === decoyId,
      `the decoy ${decoyCode} does not sort before ${SOLAR_ASSET_CODE} under this database's ` +
        "collation, so the pattern read this guards against would not have adopted it and " +
        "nothing below is tested",
    );

    const resolved = await resolveEnergyFixtureAssets(client);
    assert(
      resolved.pvAssetId === fx.pvAssetId,
      `resolveEnergyFixtureAssets adopted a foreign PV asset: got ${resolved.pvAssetId}, ` +
        `expected the seeded ${SOLAR_ASSET_CODE} (${fx.pvAssetId}). This is the 2026-08-27 ` +
        `adoption defect — ` +
        "the resolution went back to matching a code pattern instead of an exact code, and " +
        "whichever suite currently owns a PV-prefixed committed fixture is now this suite's " +
        "fixture. See the exact-code section in this file's header.",
    );
    assert(
      resolved.otherAssetId === fx.otherAssetId,
      `resolveEnergyFixtureAssets adopted a foreign non-PV asset: got ${resolved.otherAssetId}, ` +
        `expected the seeded ${GRID_ASSET_CODE} (${fx.otherAssetId}). Same defect, other half.`,
    );
  } finally {
    // The decoy must never become visible to another connection, so the rollback
    // runs even when an assertion above threw — and its own failure must not
    // replace that assertion's message.
    //
    // A failed ROLLBACK is not survivable, though, and swallowing it alone would
    // hand a connection back to the pool **still inside this transaction, with
    // the decoy row uncommitted on it**; the next checkout would then run inside
    // it. So the release destroys the connection instead — the same shape
    // `withRollupRole` in `packages/db/src/refresh-aggregates.ts` uses for its
    // `RESET ROLE`, and for the same reason.
    let rolledBack = true;
    try {
      await client.query("ROLLBACK");
    } catch {
      rolledBack = false;
    }
    client.release(rolledBack ? undefined : new Error("ROLLBACK failed on the decoy transaction"));
  }
}
