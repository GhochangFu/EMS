import { randomUUID } from "node:crypto";

import type pg from "pg";
import { vi } from "vitest";

import { FRESHNESS_FLOOR_SECONDS } from "../telemetry/telemetry-cadence";
import { DashboardService } from "./dashboard.service";

/**
 * `F4.350` (ADR 0075 Amendment 3) — a sample just outside the 25 s floor, and one just inside it.
 * The 60 s-device cases are in `telemetry-cadence.integration.spec.ts`.
 *
 * `F4.375` (plan U1): every fixture RTU here is configured at {@link FIXTURE_RTU_INTERVAL_SECONDS},
 * so its window is the floor whatever the `learned` CTE reads. Without it, a fixture sample that
 * lands in the last completed hour (the 1 h aggregate is real-time) taught the RTU 3600 s and a
 * 900 s window, and every "not live" case failed when a run crossed the hour.
 */
export const FIXTURE_RTU_INTERVAL_SECONDS = 1;

const PAST_SITE_WINDOW_S = FRESHNESS_FLOOR_SECONDS + 10;
const INSIDE_SITE_WINDOW_S = FRESHNESS_FLOOR_SECONDS - 10;

/**
 * `F3.30` (ADR 0075 decision 2) — the dashboard's three freshness counts use
 * the any-point rule of ADR 0074 OQ1 through a shared CTE, and `total_kw`
 * does not change. `F4.260` (ADR 0075 Amendment 2): that CTE is now
 * `reporting`, the 25 s floor window (F4.350), no longer the 25 s `live` one. Assertions live here; the sibling
 * `.integration.test` owns the pool (ADR 0014).
 *
 * **Every case runs in one transaction on one client and rolls it back.**
 * `inRolledBackTransaction` issues `BEGIN`, runs the case, and issues
 * `ROLLBACK` in a `finally` — a case that returns normally commits nothing.
 * The service is constructed over that same client, so it sees the fixture
 * rows and nobody else does. Every read is scoped to the fixture's location
 * or asset ids, so the fleet's own telemetry cannot move a number.
 *
 * **Two clocks.** SQL `now()` is frozen at `BEGIN`, and the `reporting` CTE
 * compares against it, so every sample the SQL judges is stamped in SQL
 * relative to that same `now()` — its age is exact however long the seeding
 * takes. `telemetryFreshness` judges in JS against `Date.now()`, so the one
 * sample it reads (case 7) is stamped from a JS instant, and `Date.now()` is
 * pinned to that instant for the read. Every sample is still inserted as the
 * last step before the read.
 *
 * **Fan-out.** `locationKpis` joins `rtus × assets × alarms`. Until `F4.158`
 * it summed `kw` over that product, so a second RTU doubled `totalKw`; it now
 * sums `kw` per location in `kw_by_location` before the joins. Cases 11 and
 * 12 pin that; the `F3.30` cases keep one RTU and no alarm.
 */

const RUN_CODE = `F330-FRESH-${randomUUID().slice(0, 8)}`;

const NO_TARIFFS = { resolveForAssets: async () => new Map<string, number>() };
// F4.364 (plan D5): this suite reads no location card's health figure.
const NO_HEALTH = { scoresByLocation: async () => new Map<string, number | null>() };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Runs `fn` inside a transaction on one checked-out client and always rolls it
 * back. Not named `withRollback`: that name is the Drizzle helper the
 * `tests/f3.60-withrollback-cases-roll-back.test.ts` gate counts.
 */
export async function inRolledBackTransaction(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

export interface Site {
  readonly organizationId: string;
  readonly locationId: string;
  readonly rtuId: string;
  readonly domainCode: string;
  readonly tag: string;
}

/** A fresh organization, active location and one RTU (configured at the fixture interval), inside the caller's transaction. */
export async function seedSite(client: pg.PoolClient): Promise<Site> {
  const tag = `${RUN_CODE}-${randomUUID().slice(0, 8)}`;
  const domain = await client.query<{ code: string }>(
    "SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1",
  );
  const domainCode = domain.rows[0]?.code;
  if (!domainCode) {
    throw new Error("bms.asset_domains is empty — run pnpm db:migrate && pnpm db:seed first");
  }
  const org = await client.query<{ id: string }>(
    "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'ZAR') RETURNING id",
    [`${tag}-ORG`, "F3.30 freshness fixture organization"],
  );
  const organizationId = org.rows[0]?.id;
  if (!organizationId) throw new Error("failed to insert the F3.30 fixture organization");
  const loc = await client.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
     VALUES ($1, $2, $3, $4, 'rsmoc', 0, 0, true) RETURNING id`,
    [organizationId, `${tag}-LOC`, tag.toLowerCase(), "F3.30 freshness fixture site"],
  );
  const locationId = loc.rows[0]?.id;
  if (!locationId) throw new Error("failed to insert the F3.30 fixture location");
  const rtu = await client.query<{ id: string }>(
    `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type, expected_interval_seconds)
     VALUES ($1, $2, $3, $4, 'simulator', $5) RETURNING id`,
    [organizationId, locationId, `${tag}-RTU`, "F3.30 freshness fixture RTU", FIXTURE_RTU_INTERVAL_SECONDS],
  );
  const rtuId = rtu.rows[0]?.id;
  if (!rtuId) throw new Error("failed to insert the F3.30 fixture RTU");
  return { organizationId, locationId, rtuId, domainCode, tag };
}

/** `F4.317` — a second location (and RTU) in the site's organization; active unless told not. */
export async function seedLocation(client: pg.PoolClient, site: Site, active = true): Promise<Site> {
  const tag = `${site.tag}-${randomUUID().slice(0, 8)}`;
  const loc = await client.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
     VALUES ($1, $2, $3, $4, 'rsmoc', 0, 0, $5) RETURNING id`,
    [site.organizationId, `${tag}-LOC`, tag.toLowerCase(), "F4.317 second fixture site", active],
  );
  const locationId = loc.rows[0]?.id;
  if (!locationId) throw new Error("failed to insert the F4.317 fixture location");
  const rtu = await client.query<{ id: string }>(
    `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type, expected_interval_seconds)
     VALUES ($1, $2, $3, $4, 'simulator', $5) RETURNING id`,
    [site.organizationId, locationId, `${tag}-RTU`, "F4.317 second fixture RTU", FIXTURE_RTU_INTERVAL_SECONDS],
  );
  const rtuId = rtu.rows[0]?.id;
  if (!rtuId) throw new Error("failed to insert the F4.317 fixture RTU");
  return { ...site, locationId, rtuId, tag };
}

/** A further RTU at the site's location. */
async function seedRtu(client: pg.PoolClient, site: Site): Promise<string> {
  const rtu = await client.query<{ id: string }>(
    `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type, expected_interval_seconds)
     VALUES ($1, $2, $3, $4, 'simulator', $5) RETURNING id`,
    [
      site.organizationId,
      site.locationId,
      `${site.tag}-RTU-${randomUUID().slice(0, 8)}`,
      "F4.158 fixture RTU",
      FIXTURE_RTU_INTERVAL_SECONDS,
    ],
  );
  const id = rtu.rows[0]?.id;
  if (!id) throw new Error("failed to insert the F4.158 fixture RTU");
  return id;
}

/** One alarm on `assetId`, open or cleared. */
async function seedAlarm(client: pg.PoolClient, site: Site, assetId: string, cleared: boolean): Promise<void> {
  const severity = await client.query<{ code: string }>(
    "SELECT code FROM bms.alarm_severities ORDER BY code LIMIT 1",
  );
  const code = severity.rows[0]?.code;
  if (!code) throw new Error("bms.alarm_severities is empty — run pnpm db:seed first");
  await client.query(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
     VALUES ($1, $2, $3, 'F4.158 fixture alarm', now(), CASE WHEN $4::boolean THEN now() END)`,
    [site.organizationId, assetId, code, cleared],
  );
}

/** One asset on the site's RTU (or on `rtuId`), with its own `site_name`. */
export async function seedAsset(
  client: pg.PoolClient,
  site: Site,
  siteName: string,
  rtuId: string = site.rtuId,
): Promise<string> {
  const asset = await client.query<{ id: string }>(
    `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain, rtu_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      site.organizationId,
      `${site.tag}-${randomUUID().slice(0, 8)}`,
      "F3.30 freshness fixture asset",
      `${site.tag} ${siteName}`,
      site.locationId,
      site.domainCode,
      rtuId,
    ],
  );
  const id = asset.rows[0]?.id;
  if (!id) throw new Error("failed to insert the F3.30 fixture asset");
  return id;
}

/**
 * A sample `ageSeconds` before the transaction's frozen `now()` — the instant
 * the SQL freshness predicates compare against.
 */
export async function insertSampleBeforeNow(
  client: pg.PoolClient,
  assetId: string,
  pointKey: string,
  value: number,
  ageSeconds: number,
): Promise<void> {
  await client.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     VALUES (now() - make_interval(secs => $4), $1, $2, $3, 'u')`,
    [assetId, pointKey, value, ageSeconds],
  );
}

/** A sample stamped from the wall clock, for the JS-side `telemetryFreshness` judgement. */
async function insertSampleAt(
  client: pg.PoolClient,
  assetId: string,
  pointKey: string,
  value: number,
  time: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     VALUES ($4::timestamptz, $1, $2, $3, 'u')`,
    [assetId, pointKey, value, time.toISOString()],
  );
}

function service(client: pg.PoolClient): DashboardService {
  return new DashboardService(client as unknown as pg.Pool, NO_TARIFFS, NO_HEALTH);
}

/** Case 1 — a `temp_c` sample 5 s old and no `kw` makes the asset fresh on its location card. */
export async function assertNonKwSampleCountsAsFresh(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "A");
  await insertSampleBeforeNow(client, a, "temp_c", 21.5, 5);
  const { items } = await service(client).locationKpis({ locationIds: [site.locationId], assetIds: [a] });
  const got = items[0]?.freshAssetCount;
  assert(got === 1, `expected freshAssetCount 1 for a non-kw sample 5 s old, got ${JSON.stringify(got)}`);
}

/** Case 2 — a `kw` of 42 past the site window still sums into `totalKw`, and the asset is not fresh. */
export async function assertTotalKwSumsStaleKw(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const b = await seedAsset(client, site, "B");
  await insertSampleBeforeNow(client, b, "kw", 42, PAST_SITE_WINDOW_S);
  const { items } = await service(client).locationKpis({ locationIds: [site.locationId], assetIds: [b] });
  const got = { totalKw: items[0]?.totalKw, freshAssetCount: items[0]?.freshAssetCount };
  assert(
    got.totalKw === 42 && got.freshAssetCount === 0,
    `expected { totalKw: 42, freshAssetCount: 0 }, got ${JSON.stringify(got)}`,
  );
}

/**
 * Case 3 — `locationDashboard`'s RTU row counts a non-`kw` fresh asset, and
 * only that one: a second in-scope asset on the same RTU whose only sample is
 * past the site window is counted in `assetCount` and not in `freshAssetCount` — the
 * stale control the `FILTER (WHERE reporting.asset_id IS NOT NULL)` answers for
 * (code review 3).
 */
export async function assertRtuRowsCountNonKwFresh(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "A");
  const stale = await seedAsset(client, site, "S");
  await insertSampleBeforeNow(client, stale, "temp_c", 20, PAST_SITE_WINDOW_S);
  await insertSampleBeforeNow(client, a, "temp_c", 21.5, 5);
  const dto = await service(client).locationDashboard(site.locationId, {
    locationIds: [site.locationId],
    assetIds: [a, stale],
  });
  const rtu = dto?.rtus.find((r) => r.id === site.rtuId);
  assert(
    rtu?.freshAssetCount === 1 && rtu?.assetCount === 2,
    `expected the fixture RTU at 1 fresh of 2, got ${JSON.stringify(rtu ?? null)}`,
  );
}

/** Case 4 — `kpis.sitesOnline` counts a site whose only fresh sample is not `kw`. */
export async function assertSitesOnlineUsesAnyPoint(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "A");
  await insertSampleBeforeNow(client, a, "temp_c", 21.5, 5);
  const kpis = await service(client).kpis([a]);
  const got = { sitesOnline: kpis.sitesOnline, sitesTotal: kpis.sitesTotal };
  assert(
    got.sitesOnline === 1 && got.sitesTotal === 1,
    `expected { sitesOnline: 1, sitesTotal: 1 }, got ${JSON.stringify(got)}`,
  );
}

/**
 * Case 5 — `F4.260` (ADR 0075 Amendment 2): the `sites_online` window is the 25 s floor
 * reporting window. A `kw` sample 15 s old counts, one 35 s old (another asset at another
 * location) does not. Both are `kw`, so the point-key change cannot turn this green; only the
 * window can. `F4.317` (ADR 0112 decision 7): a site is a location, so the two assets sit at two
 * locations — two site names at one location are one site (case 5b).
 */
export async function assertSitesOnlineWindowIsTheReportingWindow(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const other = await seedLocation(client, site);
  const inside = await seedAsset(client, site, "S1");
  const outside = await seedAsset(client, other, "S2");
  await insertSampleBeforeNow(client, outside, "kw", 7, PAST_SITE_WINDOW_S);
  await insertSampleBeforeNow(client, inside, "kw", 5, INSIDE_SITE_WINDOW_S);
  const kpis = await service(client).kpis([inside, outside]);
  const got = { sitesOnline: kpis.sitesOnline, sitesTotal: kpis.sitesTotal };
  assert(
    got.sitesOnline === 1 && got.sitesTotal === 2,
    `expected { sitesOnline: 1, sitesTotal: 2 } (15 s counts, 35 s does not), got ${JSON.stringify(got)}`,
  );
}

/**
 * Case 5b — `F4.317` (ADR 0112 decision 7): `kpis()` counts LOCATIONS. Two assets at one
 * location carrying two different `site_name`s are one site, online when either reports — the
 * estate tile then agrees with the location cards (the "4 / 17" that read 16 cards).
 */
export async function assertSitesTotalCountsLocationsNotSiteNames(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const first = await seedAsset(client, site, "North");
  const second = await seedAsset(client, site, "South");
  await insertSampleBeforeNow(client, first, "kw", 5, INSIDE_SITE_WINDOW_S);
  const kpis = await service(client).kpis([first, second]);
  const got = { sitesOnline: kpis.sitesOnline, sitesTotal: kpis.sitesTotal };
  assert(
    got.sitesOnline === 1 && got.sitesTotal === 1,
    `expected { sitesOnline: 1, sitesTotal: 1 } (two site names, one location), got ${JSON.stringify(got)}`,
  );
}

/**
 * `F4.317` (ADR 0112 decision 7) — an inactive location is not a site: the location cards read
 * `l.active = true` and `sites.live.count` joins `l.active`, so a reporting asset left at a
 * deactivated location moves neither `sitesOnline` nor `sitesTotal`. Its open alarm still counts
 * in `alarmsOpen`, as it does in the catalog's `alarms.active.count`, which reads no location.
 */
export async function assertSitesSkipInactiveLocations(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const dead = await seedLocation(client, site, false);
  const live = await seedAsset(client, site, "Live");
  const orphan = await seedAsset(client, dead, "Dead");
  await insertSampleBeforeNow(client, live, "kw", 5, INSIDE_SITE_WINDOW_S);
  await insertSampleBeforeNow(client, orphan, "kw", 5, INSIDE_SITE_WINDOW_S);
  await client.query(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message)
     VALUES ($1, $2, (SELECT code FROM bms.alarm_severities ORDER BY code LIMIT 1), 'F4.317 inactive-location alarm')`,
    [site.organizationId, orphan],
  );
  const kpis = await service(client).kpis([live, orphan]);
  const got = { sitesOnline: kpis.sitesOnline, sitesTotal: kpis.sitesTotal, alarmsOpen: kpis.alarmsOpen };
  assert(
    got.sitesOnline === 1 && got.sitesTotal === 1 && got.alarmsOpen === 1,
    `expected { sitesOnline: 1, sitesTotal: 1, alarmsOpen: 1 } (one inactive location), got ${JSON.stringify(got)}`,
  );
}

/** Case 6 — `kpis.totalKw` still sums a stale `kw` of 42, with no site online. */
export async function assertKpisTotalKwUnchanged(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const b = await seedAsset(client, site, "B");
  await insertSampleBeforeNow(client, b, "kw", 42, PAST_SITE_WINDOW_S);
  const kpis = await service(client).kpis([b]);
  const got = { totalKw: kpis.totalKw, sitesOnline: kpis.sitesOnline };
  assert(
    got.totalKw === 42 && got.sitesOnline === 0,
    `expected { totalKw: 42, sitesOnline: 0 }, got ${JSON.stringify(got)}`,
  );
}

/**
 * `F4.390` — why a rolled-back `locationDashboard` telemetry case may be unable to run. The
 * Assets tab now finds an asset's keys in the real-time `telemetry.point_values_1d`, so an
 * uncommitted sample is visible only while it lies above the `_1m` and `_1h` watermarks; another
 * suite's `materializeCompleteBuckets`, or the refresh job, can move one past it mid-case. The
 * telemetry cases therefore stamp their sample at the current instant (never behind a watermark
 * yet) and check, after the read, that it is still in the daily aggregate. A watermark only moves
 * forward, so a sample visible then was visible to the read; one that is not reads skipped, never
 * a silent green or a false red.
 */
export const SAMPLE_NOT_IN_THE_DAILY_AGGREGATE =
  "the uncommitted sample fell behind a point_values_1m/_1h watermark during the case (another suite " +
  "or the refresh job materialized past it), so the Assets tab read could not see it; " +
  "latest-points.integration gates the read on committed rows";

/** `F4.390` — whether `assetId`'s `pointKey` sample is visible in the real-time daily aggregate. */
export async function sampleReachedTheDailyAggregate(
  client: pg.PoolClient,
  assetId: string,
  pointKey: string,
): Promise<boolean> {
  const r = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM telemetry.point_values_1d
     WHERE asset_id = $1 AND point_key = $2 AND bucket > now() - interval '2 days'`,
    [assetId, pointKey],
  );
  return (r.rows[0]?.n ?? 0) >= 1;
}

/**
 * Case 7 — an asset whose newest sample is 22 s old reads `"live"` in the
 * asset rows. `Date.now()` is pinned for the read: `telemetryFreshness` runs
 * after every query of `locationDashboard`, which took 3.7 s on the dev
 * database — more than the 3 s between 22 s and the 25 s window — so an
 * unpinned wall clock made the age drift past the window on its own.
 * `F4.390`: the sample is stamped now and the read judged 22 s later, not the
 * reverse, so the sample is never behind an aggregate watermark when it is
 * written ({@link SAMPLE_NOT_IN_THE_DAILY_AGGREGATE}).
 */
export async function assertTelemetryFreshnessReadsConstant(
  client: pg.PoolClient,
  skip: (reason: string) => never,
): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "A");
  const sampledAt = Date.now();
  await insertSampleAt(client, a, "temp_c", 21.5, new Date(sampledAt));
  const judgedAt = sampledAt + 22_000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(judgedAt);
  let dto: Awaited<ReturnType<DashboardService["locationDashboard"]>>;
  try {
    dto = await service(client).locationDashboard(site.locationId, {
      locationIds: [site.locationId],
      assetIds: [a],
    });
  } finally {
    clock.mockRestore();
  }
  if (!(await sampleReachedTheDailyAggregate(client, a, "temp_c"))) skip(SAMPLE_NOT_IN_THE_DAILY_AGGREGATE);
  const row = dto?.assets.items.find((item) => item.id === a);
  assert(
    row?.freshness === "live",
    `expected freshness "live" for a sample 22 s old, got ${JSON.stringify(row?.freshness ?? null)}`,
  );
}

/**
 * Case 8 — the upper bound: an asset whose newest sample is 30 s old reads
 * `"stale"`. Case 7 alone catches only a narrower window; this one catches a
 * wider one. `Date.now()` is pinned for the read, for case 7's reason, and the
 * sample is stamped now and judged 30 s later, for case 7's `F4.390` reason.
 */
export async function assertTelemetryFreshnessStaleBeyondWindow(
  client: pg.PoolClient,
  skip: (reason: string) => never,
): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "A");
  const sampledAt = Date.now();
  await insertSampleAt(client, a, "temp_c", 21.5, new Date(sampledAt));
  const judgedAt = sampledAt + 30_000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(judgedAt);
  let dto: Awaited<ReturnType<DashboardService["locationDashboard"]>>;
  try {
    dto = await service(client).locationDashboard(site.locationId, {
      locationIds: [site.locationId],
      assetIds: [a],
    });
  } finally {
    clock.mockRestore();
  }
  if (!(await sampleReachedTheDailyAggregate(client, a, "temp_c"))) skip(SAMPLE_NOT_IN_THE_DAILY_AGGREGATE);
  const row = dto?.assets.items.find((item) => item.id === a);
  assert(
    row?.freshness === "stale",
    `expected freshness "stale" for a sample 30 s old, got ${JSON.stringify(row?.freshness ?? null)}`,
  );
}

/**
 * Case 9 — no fan-out: one asset with `kw = 42` and two more samples of other
 * keys, all inside the window, still sums to `totalKw` 42 and counts one
 * fresh asset. The extra samples are not `kw`, so this case gates the
 * `point_key = 'kw'` filter in `latest`. Since `F4.158` it no longer gates
 * the `DISTINCT` in `live`: `totalKw` reads `kw_by_location`, which never
 * joins `live`, and `freshAssetCount` is `COUNT(DISTINCT …)`.
 * `tests/f3.28-offline-bound-single-source.test.ts` pins that `DISTINCT` as
 * text, for `map.service.ts`'s plain `COUNT`.
 */
export async function assertThreeSamplesDoNotFanOutTotalKw(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "A");
  await insertSampleBeforeNow(client, a, "kw", 42, 5);
  await insertSampleBeforeNow(client, a, "temp_c", 21.5, 4);
  await insertSampleBeforeNow(client, a, "humidity_pct", 40, 3);
  const { items } = await service(client).locationKpis({ locationIds: [site.locationId], assetIds: [a] });
  const got = { totalKw: items[0]?.totalKw, freshAssetCount: items[0]?.freshAssetCount };
  assert(
    got.totalKw === 42 && got.freshAssetCount === 1,
    `expected { totalKw: 42, freshAssetCount: 1 }, got ${JSON.stringify(got)}`,
  );
}

/**
 * Case 10 — security L1: a fresh asset at the same location but outside
 * `assetIds` stays out of `freshAssetCount`. The in-scope asset is fresh too,
 * so the count must read exactly 1 — the positive control that the read ran.
 */
export async function assertOutOfScopeFreshAssetIsNotCounted(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const inScope = await seedAsset(client, site, "IN");
  const outOfScope = await seedAsset(client, site, "OUT");
  await insertSampleBeforeNow(client, outOfScope, "temp_c", 21.5, 5);
  await insertSampleBeforeNow(client, inScope, "temp_c", 21.5, 5);
  const { items } = await service(client).locationKpis({
    locationIds: [site.locationId],
    assetIds: [inScope],
  });
  const got = { freshAssetCount: items[0]?.freshAssetCount, assetCount: items[0]?.assetCount };
  assert(
    got.freshAssetCount === 1 && got.assetCount === 1,
    `expected { freshAssetCount: 1, assetCount: 1 }, got ${JSON.stringify(got)}`,
  );
}

/**
 * Case 11 — `F4.158`: `totalKw` is the per-asset sum, however many RTUs and
 * alarms the location has. Two RTUs; X (RTU 1, two alarms, one open) and Y
 * (RTU 2) at `kw = 21`, Z (RTU 1, no alarm) at `kw = 10`: expect 52. The
 * product-summing query reads 146 (each asset once per RTU, times its alarm
 * rows or 1). X and Y are equal on purpose: `SUM(DISTINCT kw)` reads 31,
 * `MAX(kw)` 21, and `AVG(kw) × COUNT(DISTINCT a.id)` over the joined rows
 * 54.75, so this one assertion also rejects those wrong fixes. `rtuCount` 2
 * and `openAlarms` 1 are the positive control that both joins still ran.
 */
export async function assertTotalKwDoesNotFanOutOverRtusAndAlarms(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const secondRtu = await seedRtu(client, site);
  const x = await seedAsset(client, site, "X");
  const y = await seedAsset(client, site, "Y", secondRtu);
  const z = await seedAsset(client, site, "Z");
  await seedAlarm(client, site, x, false);
  await seedAlarm(client, site, x, true);
  await insertSampleBeforeNow(client, x, "kw", 21, 5);
  await insertSampleBeforeNow(client, y, "kw", 21, 5);
  await insertSampleBeforeNow(client, z, "kw", 10, 5);
  const { items } = await service(client).locationKpis({ locationIds: [site.locationId], assetIds: [x, y, z] });
  const got = { totalKw: items[0]?.totalKw, rtuCount: items[0]?.rtuCount, openAlarms: items[0]?.openAlarms };
  assert(
    got.totalKw === 52 && got.rtuCount === 2 && got.openAlarms === 1,
    `expected { totalKw: 52, rtuCount: 2, openAlarms: 1 }, got ${JSON.stringify(got)}`,
  );
}

/**
 * Case 12 — `F4.158`: the per-location `kw` sum keeps the caller's asset
 * scope. An out-of-scope asset at the same location reads `kw = 100`; the
 * in-scope one reads 42 and is the positive control. Without the `$2`
 * predicate in `kw_by_location` the card reads 142 and no count shows it.
 */
export async function assertTotalKwExcludesOutOfScopeAsset(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const inScope = await seedAsset(client, site, "IN");
  const outOfScope = await seedAsset(client, site, "OUT");
  await insertSampleBeforeNow(client, outOfScope, "kw", 100, 5);
  await insertSampleBeforeNow(client, inScope, "kw", 42, 5);
  const { items } = await service(client).locationKpis({
    locationIds: [site.locationId],
    assetIds: [inScope],
  });
  const got = items[0]?.totalKw;
  assert(got === 42, `expected totalKw 42 (the in-scope asset only), got ${JSON.stringify(got)}`);
}

/**
 * Case 13 — `F4.158`: a global user passes `assetIds: null`, and the card
 * then sums every asset at the location — 42 + 100. Cases 11 and 12 always
 * pass `assetIds`, so without this case a `kw_by_location` that lost its
 * `$2 IS NULL OR` branch would read 0 on every card for every global user
 * and stay green. The fixture location holds only fixture assets, so fleet
 * data cannot move the number.
 */
export async function assertTotalKwSumsEveryAssetForGlobalScope(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "A");
  const b = await seedAsset(client, site, "B");
  await insertSampleBeforeNow(client, b, "kw", 100, 5);
  await insertSampleBeforeNow(client, a, "kw", 42, 5);
  const { items } = await service(client).locationKpis({ locationIds: [site.locationId], assetIds: null });
  const got = items[0]?.totalKw;
  assert(got === 142, `expected totalKw 142 (both assets, global scope), got ${JSON.stringify(got)}`);
}

/**
 * Case 14 — `F3.70` (ADR 0076 decision 9, D7): the location KPI row's `code`
 * is `bms.locations.code`, the fixture's `${tag}-LOC`, not its name.
 */
export async function assertLocationKpiCodeIsLocationsCode(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const { items } = await service(client).locationKpis({ locationIds: [site.locationId], assetIds: null });
  const got = items[0]?.code;
  assert(
    got === `${site.tag}-LOC`,
    `expected code ${site.tag}-LOC, got ${JSON.stringify(got)}`,
  );
}

/**
 * Case 15 — `F3.70`: `locationDashboard` (the `/locations/:id` read) carries
 * the same `code` through its `...card` spread, not a copy from the name.
 */
export async function assertLocationDashboardCodeIsLocationsCode(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const dto = await service(client).locationDashboard(site.locationId, {
    locationIds: [site.locationId],
    assetIds: null,
  });
  const got = dto?.code;
  assert(
    got === `${site.tag}-LOC`,
    `expected locationDashboard code ${site.tag}-LOC, got ${JSON.stringify(got)}`,
  );
}

/**
 * `F4.260` (ADR 0075 Amendment 2) — the location card counts an asset whose newest sample is
 * 15 s old (inside the 25 s floor window (F4.350), outside the 25 s reading window) and not one 35 s
 * old. A 60 s device is never older than about 60 s between reports, so its site stays live.
 */
export async function assertLocationCardsUseTheReportingWindow(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const inside = await seedAsset(client, site, "W1");
  const outside = await seedAsset(client, site, "W2");
  await insertSampleBeforeNow(client, inside, "temp_c", 21, INSIDE_SITE_WINDOW_S);
  await insertSampleBeforeNow(client, outside, "temp_c", 22, PAST_SITE_WINDOW_S);
  const { items } = await service(client).locationKpis({
    locationIds: [site.locationId],
    assetIds: [inside, outside],
  });
  const got = { fresh: items[0]?.freshAssetCount, total: items[0]?.assetCount };
  assert(
    got.fresh === 1 && got.total === 2,
    `expected { fresh: 1, total: 2 } (15 s counts, 35 s does not), got ${JSON.stringify(got)}`,
  );
}

/** `F4.260` — the site page's RTU row uses the same 150 s window as the location card. */
export async function assertRtuRowsUseTheReportingWindow(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const inside = await seedAsset(client, site, "R1");
  const outside = await seedAsset(client, site, "R2");
  await insertSampleBeforeNow(client, inside, "temp_c", 21, INSIDE_SITE_WINDOW_S);
  await insertSampleBeforeNow(client, outside, "temp_c", 22, PAST_SITE_WINDOW_S);
  const dto = await service(client).locationDashboard(site.locationId, {
    locationIds: [site.locationId],
    assetIds: [inside, outside],
  });
  const rtu = dto?.rtus.find((r) => r.id === site.rtuId);
  assert(
    rtu?.freshAssetCount === 1 && rtu?.assetCount === 2,
    `expected the fixture RTU at 1 fresh of 2 (15 s counts, 35 s does not), got ${JSON.stringify(rtu ?? null)}`,
  );
}

/**
 * `F4.375` (plan U1) — a history sample in the last completed hour does not widen the window.
 * The aggregates are real-time, so an uncommitted fixture row stamped just before the hour
 * boundary is visible to the `learned` CTE whenever it lies above the `_1m` aggregate's
 * watermark (always on a fresh test database; on a busy one, only in the first minute or two of
 * the hour). One sample there teaches the RTU `3600 / 1` s, a 900 s window, and every "not live"
 * expectation on the same RTU flips — this is how CI failed when a run crossed the hour. H
 * carries that sample (outside the read's scope, so it is never itself the fresh one); S, on the
 * same RTU, is past the floor window and must still read not fresh — which holds only because the
 * fixture RTU's configured interval wins over anything learned. The positive control first
 * checks the sample reached the 1 h aggregate; when it did not (the `_1m` watermark is past it —
 * routine in a full suite run, where other suites commit telemetry and the refresh job runs), the
 * case cannot stage its scenario and calls `skip` with the reason, so it reads skipped, never a
 * silent green. Telemetry-cadence C7 gates the precedence rule itself with no clock.
 */
/**
 * `F4.375` — the reason a history-sample case cannot run on this database, or `null` when it can:
 * `assetId`'s sample must be visible in the last completed hour of `telemetry.point_values_1h`,
 * as the `learned` CTE reads it. It is not when the `_1m` aggregate's watermark is already past
 * the sample. Exported for `system-status.integration.spec.ts`.
 */
export const HISTORY_SAMPLE_NOT_STAGED =
  "the history sample did not reach point_values_1h's last completed hour (the _1m watermark is past it), " +
  "so this database cannot stage the scenario; C7 in telemetry-cadence gates the rule";

async function historySampleReachedTheHourAggregate(client: pg.PoolClient, assetId: string): Promise<boolean> {
  const r = await client.query<{ n: string | null }>(
    `SELECT max(sample_count)::text AS n FROM telemetry.point_values_1h
     WHERE asset_id = $1 AND bucket = date_trunc('hour', now()) - interval '1 hour'`,
    [assetId],
  );
  return Number(r.rows[0]?.n ?? 0) >= 1;
}

export async function assertAHistorySampleInTheLastCompletedHourDoesNotWidenTheWindow(
  client: pg.PoolClient,
  skip: (reason: string) => never,
): Promise<void> {
  const site = await seedSite(client);
  const h = await seedAsset(client, site, "H");
  const s = await seedAsset(client, site, "S");
  await client.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     VALUES (date_trunc('hour', now()) - interval '5 seconds', $1, 'temp_c', 20, 'u')`,
    [h],
  );
  if (!(await historySampleReachedTheHourAggregate(client, h))) skip(HISTORY_SAMPLE_NOT_STAGED);
  await insertSampleBeforeNow(client, s, "temp_c", 21, PAST_SITE_WINDOW_S);
  const { items } = await service(client).locationKpis({ locationIds: [site.locationId], assetIds: [s] });
  const got = { freshAssetCount: items[0]?.freshAssetCount, assetCount: items[0]?.assetCount };
  assert(
    got.freshAssetCount === 0 && got.assetCount === 1,
    `expected { freshAssetCount: 0, assetCount: 1 } (a history sample must not widen the window), got ${JSON.stringify(got)}`,
  );
}
