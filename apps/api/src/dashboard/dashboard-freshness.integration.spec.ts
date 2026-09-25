import { randomUUID } from "node:crypto";

import type pg from "pg";
import { vi } from "vitest";

import { DashboardService } from "./dashboard.service";

/**
 * `F3.30` (ADR 0075 decision 2) — the dashboard's three freshness counts use
 * the any-point rule of ADR 0074 OQ1 through the shared `live` CTE, and
 * `total_kw` does not change. Assertions live here; the sibling
 * `.integration.test` owns the pool (ADR 0014).
 *
 * **Every case runs in one transaction on one client and rolls it back.**
 * `inRolledBackTransaction` issues `BEGIN`, runs the case, and issues
 * `ROLLBACK` in a `finally` — a case that returns normally commits nothing.
 * The service is constructed over that same client, so it sees the fixture
 * rows and nobody else does. Every read is scoped to the fixture's location
 * or asset ids, so the fleet's own telemetry cannot move a number.
 *
 * **Two clocks.** SQL `now()` is frozen at `BEGIN`, and the `live` CTE
 * compares against it, so every sample the SQL judges is stamped in SQL
 * relative to that same `now()` — its age is exact however long the seeding
 * takes. `telemetryFreshness` judges in JS against `Date.now()`, so the one
 * sample it reads (case 7) is stamped from a JS instant, and `Date.now()` is
 * pinned to that instant for the read. Every sample is still inserted as the
 * last step before the read.
 *
 * **Fan-out.** `locationKpis` sums `kw` over `rtus × assets × alarms`, so each
 * fixture location has exactly one RTU and no alarm; a second RTU would
 * double `totalKw` without any change in this row.
 */

const RUN_CODE = `F330-FRESH-${randomUUID().slice(0, 8)}`;

const NO_TARIFFS = { resolveForAssets: async () => new Map<string, number>() };

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

interface Site {
  readonly organizationId: string;
  readonly locationId: string;
  readonly rtuId: string;
  readonly domainCode: string;
  readonly tag: string;
}

/** A fresh organization, active location and one RTU, inside the caller's transaction. */
async function seedSite(client: pg.PoolClient): Promise<Site> {
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
     VALUES ($1, $2, $3, $4, 'site', 0, 0, true) RETURNING id`,
    [organizationId, `${tag}-LOC`, tag.toLowerCase(), "F3.30 freshness fixture site"],
  );
  const locationId = loc.rows[0]?.id;
  if (!locationId) throw new Error("failed to insert the F3.30 fixture location");
  const rtu = await client.query<{ id: string }>(
    `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type)
     VALUES ($1, $2, $3, $4, 'simulator') RETURNING id`,
    [organizationId, locationId, `${tag}-RTU`, "F3.30 freshness fixture RTU"],
  );
  const rtuId = rtu.rows[0]?.id;
  if (!rtuId) throw new Error("failed to insert the F3.30 fixture RTU");
  return { organizationId, locationId, rtuId, domainCode, tag };
}

/** One asset on the site's RTU, with its own `site_name`. */
async function seedAsset(client: pg.PoolClient, site: Site, siteName: string): Promise<string> {
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
      site.rtuId,
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
async function insertSampleBeforeNow(
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
  return new DashboardService(client as unknown as pg.Pool, NO_TARIFFS);
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

/** Case 2 — a `kw` of 42 at 60 s old still sums into `totalKw`, and the asset is not fresh. */
export async function assertTotalKwSumsStaleKw(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const b = await seedAsset(client, site, "B");
  await insertSampleBeforeNow(client, b, "kw", 42, 60);
  const { items } = await service(client).locationKpis({ locationIds: [site.locationId], assetIds: [b] });
  const got = { totalKw: items[0]?.totalKw, freshAssetCount: items[0]?.freshAssetCount };
  assert(
    got.totalKw === 42 && got.freshAssetCount === 0,
    `expected { totalKw: 42, freshAssetCount: 0 }, got ${JSON.stringify(got)}`,
  );
}

/** Case 3 — `locationDashboard`'s RTU row counts a non-`kw` fresh asset. */
export async function assertRtuRowsCountNonKwFresh(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "A");
  await insertSampleBeforeNow(client, a, "temp_c", 21.5, 5);
  const dto = await service(client).locationDashboard(site.locationId, {
    locationIds: [site.locationId],
    assetIds: [a],
  });
  const rtu = dto?.rtus.find((r) => r.id === site.rtuId);
  assert(
    rtu?.freshAssetCount === 1,
    `expected the fixture RTU's freshAssetCount 1, got ${JSON.stringify(rtu ?? null)}`,
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
 * Case 5 — the `sites_online` window is 25 s: a `kw` sample 21 s old counts,
 * one 30 s old (another asset, its own site name) does not. Both are `kw`, so
 * the point-key change cannot turn this green; only the window can.
 */
export async function assertSitesOnlineWindowIs25s(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const inside = await seedAsset(client, site, "S1");
  const outside = await seedAsset(client, site, "S2");
  await insertSampleBeforeNow(client, outside, "kw", 7, 30);
  await insertSampleBeforeNow(client, inside, "kw", 5, 21);
  const kpis = await service(client).kpis([inside, outside]);
  const got = { sitesOnline: kpis.sitesOnline, sitesTotal: kpis.sitesTotal };
  assert(
    got.sitesOnline === 1 && got.sitesTotal === 2,
    `expected { sitesOnline: 1, sitesTotal: 2 } (21 s counts, 30 s does not), got ${JSON.stringify(got)}`,
  );
}

/** Case 6 — `kpis.totalKw` still sums a stale `kw` of 42, with no site online. */
export async function assertKpisTotalKwUnchanged(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const b = await seedAsset(client, site, "B");
  await insertSampleBeforeNow(client, b, "kw", 42, 60);
  const kpis = await service(client).kpis([b]);
  const got = { totalKw: kpis.totalKw, sitesOnline: kpis.sitesOnline };
  assert(
    got.totalKw === 42 && got.sitesOnline === 0,
    `expected { totalKw: 42, sitesOnline: 0 }, got ${JSON.stringify(got)}`,
  );
}

/**
 * Case 7 — an asset whose newest sample is 22 s old reads `"live"` in the
 * asset rows. `Date.now()` is pinned for the read: `telemetryFreshness` runs
 * after every query of `locationDashboard`, which took 3.7 s on the dev
 * database — more than the 3 s between 22 s and the 25 s window — so an
 * unpinned wall clock made the age drift past the window on its own.
 */
export async function assertTelemetryFreshnessReadsConstant(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "A");
  const judgedAt = Date.now();
  await insertSampleAt(client, a, "temp_c", 21.5, new Date(judgedAt - 22_000));
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
  const row = dto?.assets.items.find((item) => item.id === a);
  assert(
    row?.freshness === "live",
    `expected freshness "live" for a sample 22 s old, got ${JSON.stringify(row?.freshness ?? null)}`,
  );
}
