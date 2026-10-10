import { randomUUID } from "node:crypto";

import type pg from "pg";
import { expect } from "vitest";

import { createDb } from "@bms/db";
import type { MapSiteDto } from "@bms/shared";

import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";
import { MapService } from "./map.service";

/**
 * `F3.30` (ADR 0075 decision 2) — `sitesLive`'s comm-status counts move to
 * the any-point rule through the shared `live` CTE, the same as
 * `dashboard.service.ts` (`F3.30` U2). A second fixture asset (no alarms of
 * its own) carries a non-`kw` sample; scoping `assetIds` to only that asset
 * keeps `insertFixture`'s alarmed asset out of both the alarm and comm counts,
 * so `assetsTotal` and `status` read off this asset alone.
 */

/**
 * `F3.10` U12 — the map's per-site open-alarm counts follow `cleared_at`, not
 * `acknowledged_at` (ADR 0057 decision 1, owner ruling Q1). Assertions live
 * here; the sibling `.integration.test` owns the pool (ADR 0014).
 *
 * The same shape as `dashboard.integration.spec.ts`, and for the same reasons
 * — the predicate is SQL inside `sitesLive`, and the fixture (one
 * acknowledged-uncleared `critical`, two cleared-unacknowledged `warning`)
 * counts 1 open / 1 critical under `cleared_at IS NULL` and would count
 * 2 / 0 under the old predicate. One thing is added: `sitesLive` keys its
 * alarm counts on `bms.locations.id` reached through `map_locations.slug =
 * locations.slug`, and only for a pin that joins a location (`F4.157`), so the
 * fixture location gets a `map_locations` row of its own with the same slug.
 *
 * One connection, one transaction, rolled back — see the dashboard spec's
 * header for why the service is constructed over the `PoolClient`.
 */

/** Runs `run` inside one transaction on one connection, and rolls it back whatever happens. */
async function withRolledBackClient<T>(
  pool: pg.Pool,
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await run(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/** The service over one checked-out client: the raw pool and the drizzle tree executor share the connection. */
function mapService(client: pg.PoolClient): MapService {
  return new MapService(client as unknown as pg.Pool, createDb(client as unknown as pg.Pool));
}

type Fixture = { locationId: string; organizationId: string; assetId: string; slug: string };

/** The dashboard spec's fixture plus the `map_locations` row that makes the location a map site. */
async function insertFixture(client: pg.PoolClient, run: string): Promise<Fixture> {
  const db = createDb(client as unknown as pg.Pool);
  const { organizationId } = await fixtureLocation(db);
  const slug = `f310m-${run}`;
  const location = await client.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
     VALUES ($1, $2, $3, $4, 'csmoc', 0, 0) RETURNING id`,
    [organizationId, `F310M-${run}`, slug, `F3.10 map fixture ${run}`],
  );
  const locationId = location.rows[0]?.id as string;
  // The pin joins the location by slug, which is what makes it carry live health.
  await client.query(
    `INSERT INTO bms.map_locations (slug, name, kind, site_name, latitude, longitude)
     VALUES ($1, $2, 'csmoc', $3, 0, 0)`,
    [slug, `F3.10 map fixture ${run}`, `F3.10 map fixture site ${run}`],
  );
  const [assetId] = await createFixtureAssets(db, 1, "F310M", { locationId, organizationId });
  if (!assetId) throw new Error("F3.10: no fixture asset");

  const rule = await client.query<{ id: string }>(
    `INSERT INTO bms.automation_rules (organization_id, code, name, rule_type, asset_id, enabled)
     VALUES ($1, $2, $3, 'threshold', $4, false) RETURNING id`,
    [organizationId, `F310M_${run}`, `F3.10 map fixture rule ${run}`, assetId],
  );
  const ruleId = rule.rows[0]?.id as string;

  await client.query(
    `INSERT INTO bms.alarms
       (organization_id, asset_id, rule_id, severity, message, raised_at, acknowledged_at, cleared_at)
     VALUES ($1, $2, $3, 'critical', $4, now(), now(), NULL),
            ($1, $2, $3, 'warning',  $5, now(), NULL,  now()),
            ($1, $2, $3, 'warning',  $6, now(), NULL,  now())`,
    [
      organizationId,
      assetId,
      ruleId,
      `F3.10 acknowledged, uncleared ${run}`,
      `F3.10 cleared, unacknowledged A ${run}`,
      `F3.10 cleared, unacknowledged B ${run}`,
    ],
  );
  return { locationId, organizationId, assetId, slug };
}

/** `sitesLive` counts the acknowledged-uncleared alarm for the site and excludes the cleared-unacknowledged ones. */
export async function assertSiteOpenAlarmsFollowClearedAt(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const run = randomUUID().slice(0, 8);
    const { locationId, assetId, slug } = await insertFixture(client, run);
    const service = mapService(client);

    // Scoped to the fixture asset, so every other site reads 0 and the
    // fixture site's numbers are its own.
    const sites = await service.sitesLive({ assetIds: [assetId] });
    const site = sites.find((candidate) => candidate.slug === slug);
    expect(site, "the fixture map location is listed").toBeDefined();
    expect(site?.canonicalLocationId, "joined to the fixture bms.locations row by slug").toBe(locationId);
    expect(
      site?.live.openAlarms,
      "sitesLive.openAlarms: an acknowledged, uncleared alarm is still open (ADR 0057 decision 1) — " +
        "2 here means the count follows acknowledged_at and counts the two cleared rows instead",
    ).toBe(1);
    expect(
      site?.live.criticalAlarms,
      "sitesLive.criticalAlarms: the acknowledged critical alarm counts; 0 means acknowledgement closed it",
    ).toBe(1);
    expect(site?.live.status, "one open critical alarm makes the site critical").toBe("critical");
  });
}

/**
 * `sitesLive`'s comm-status counts a non-`kw` sample as fresh (ADR 0075
 * decision 2, `F3.30`). Red today: the query's `latest` CTE only reads
 * `point_key = 'kw'`, so a `humidity_pct` sample counts nowhere and
 * `assetsFresh` reads 0.
 */
export async function assertCommStatusCountsNonKwFresh(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const run = randomUUID().slice(0, 8);
    const { locationId, organizationId, slug } = await insertFixture(client, run);
    const db = createDb(client as unknown as pg.Pool);
    const [freshAssetId] = await createFixtureAssets(db, 1, "F330MC", { locationId, organizationId });
    if (!freshAssetId) throw new Error("F3.30: no fixture comm-status asset");
    // SQL `now()` is frozen for the whole transaction, so this sample's age
    // relative to sitesLive's own `now()` read is exactly 5 s, not a race.
    await client.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES (now() - interval '5 seconds', $1, 'humidity_pct', 42, 'pct')`,
      [freshAssetId],
    );
    const service = mapService(client);

    // Scoped to only the new, alarm-free asset: insertFixture's own asset and
    // its alarms fall outside `assetIds`, so this site's counts and status
    // come from the non-kw sample alone.
    const sites = await service.sitesLive({ assetIds: [freshAssetId] });
    const site = sites.find((candidate) => candidate.slug === slug);
    expect(site, "the fixture map location is listed").toBeDefined();
    expect(
      site?.live.assetsFresh,
      "a humidity_pct sample 5 s old must count as fresh under the any-point rule",
    ).toBe(1);
    expect(site?.live.assetsTotal, "scoped to the one new fixture asset").toBe(1);
    expect(
      site?.live.status,
      "no alarms in scope and a full freshness ratio makes the site healthy",
    ).toBe("healthy");
  });
}

/**
 * `sitesLive`'s comm-status counts only the fresh asset as fresh: a second
 * in-scope asset whose only sample is 60 s old counts in `assetsTotal` and
 * not in `assetsFresh` (`F3.30` code review 3). `COUNT(l.asset_id)` is what
 * tells them apart — `COUNT(a.id)` would read 2 of 2.
 */
export async function assertCommStatusLeavesAStaleAssetOut(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const run = randomUUID().slice(0, 8);
    const { locationId, organizationId, slug } = await insertFixture(client, run);
    const db = createDb(client as unknown as pg.Pool);
    const [freshAssetId, staleAssetId] = await createFixtureAssets(db, 2, "F330MS", {
      locationId,
      organizationId,
    });
    if (!freshAssetId || !staleAssetId) throw new Error("F3.30: no fixture comm-status assets");
    // SQL `now()` is frozen for the transaction, so both ages are exact.
    await client.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES (now() - make_interval(secs => 60), $1, 'humidity_pct', 40, 'pct'),
              (now() - make_interval(secs => 5), $2, 'humidity_pct', 42, 'pct')`,
      [staleAssetId, freshAssetId],
    );
    const service = mapService(client);

    const sites = await service.sitesLive({ assetIds: [freshAssetId, staleAssetId] });
    const site = sites.find((candidate) => candidate.slug === slug);
    expect(site, "the fixture map location is listed").toBeDefined();
    expect(
      { fresh: site?.live.assetsFresh, total: site?.live.assetsTotal },
      "one fresh asset of two in scope — the 60 s one is not fresh",
    ).toEqual({ fresh: 1, total: 2 });
  });
}

/**
 * `F4.157` (ADR 0077 gate question 3, plan D8) — a pin that joins a location
 * takes its `kind` from `bms.locations.type` and its `kindLabel` from
 * `bms.location_types.label`, and carries live health because it joins a
 * location, not because its type is one of a fixed list. The fixture is the
 * shape migration `0085` fixes for PHE: a `pump_station` location whose map
 * pin may still say `rsmoc` (`seedMapLocations` never rewrites a pin's kind).
 *
 * Every fixture row is prefixed `F4157M` / `f4157m-` and written inside the
 * rolled-back transaction; `assertNoF4157MapFixtureRowsRemain` proves none
 * survives the run.
 */
type PumpStationFixture = { assetId: string; slug: string };

async function insertPumpStationFixture(
  client: pg.PoolClient,
  run: string,
  pinKind: string,
): Promise<PumpStationFixture> {
  const db = createDb(client as unknown as pg.Pool);
  const { organizationId } = await fixtureLocation(db);
  const slug = `f4157m-${run}`;
  const location = await client.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
     VALUES ($1, $2, $3, $4, 'pump_station', 0, 0) RETURNING id`,
    [organizationId, `F4157M-${run}`, slug, `F4.157 map fixture ${run}`],
  );
  const locationId = location.rows[0]?.id as string;
  await client.query(
    `INSERT INTO bms.map_locations (slug, name, kind, site_name, latitude, longitude)
     VALUES ($1, $2, $3, $4, 0, 0)`,
    [slug, `F4.157 map fixture ${run}`, pinKind, `F4.157 map fixture site ${run}`],
  );
  const [assetId] = await createFixtureAssets(db, 1, "F4157M", { locationId, organizationId });
  if (!assetId) throw new Error("F4.157: no fixture asset");
  const rule = await client.query<{ id: string }>(
    `INSERT INTO bms.automation_rules (organization_id, code, name, rule_type, asset_id, enabled)
     VALUES ($1, $2, $3, 'threshold', $4, false) RETURNING id`,
    [organizationId, `F4157M_${run}`, `F4.157 map fixture rule ${run}`, assetId],
  );
  await client.query(
    `INSERT INTO bms.alarms (organization_id, asset_id, rule_id, severity, message, raised_at)
     VALUES ($1, $2, $3, 'critical', $4, now())`,
    [organizationId, assetId, rule.rows[0]?.id as string, `F4.157 open critical ${run}`],
  );
  return { assetId, slug };
}

/** Lists the sites scoped to the fixture asset and returns the fixture's pin. */
async function pumpStationSite(pool: pg.Pool, pinKind: string): Promise<MapSiteDto | undefined> {
  return withRolledBackClient(pool, async (client) => {
    const { assetId, slug } = await insertPumpStationFixture(client, randomUUID().slice(0, 8), pinKind);
    const sites = await mapService(client).sitesLive({ assetIds: [assetId] });
    const site = sites.find((candidate) => candidate.slug === slug);
    expect(site, "the fixture map location is listed").toBeDefined();
    return site;
  });
}

/** M1a — the joined pin's `kind` is the location's type, not the pin's own `rsmoc`. */
export async function assertJoinedPinKindIsTheLocationType(pool: pg.Pool): Promise<void> {
  const site = await pumpStationSite(pool, "rsmoc");
  expect(site?.kind, "kind comes from bms.locations.type when the pin joins a location").toBe(
    "pump_station",
  );
}

/** M1b — the joined pin's `kindLabel` is the lookup row's label. */
export async function assertJoinedPinKindLabelIsTheLookupLabel(pool: pg.Pool): Promise<void> {
  const site = await pumpStationSite(pool, "rsmoc");
  expect(site?.kindLabel, "kindLabel comes from bms.location_types.label").toBe("Pump station");
}

/** M2a — a joined `pump_station` pin counts its location's assets (campus live health). */
export async function assertJoinedPumpStationPinCountsItsAssets(pool: pg.Pool): Promise<void> {
  const site = await pumpStationSite(pool, "rsmoc");
  expect(
    site?.live.assetsTotal,
    "a pin that joins a location carries campus live health — 0 means it fell to stationLive",
  ).toBe(1);
}

/** M2b — a joined `pump_station` pin counts its location's open critical alarm. */
export async function assertJoinedPumpStationPinCountsItsCriticalAlarm(pool: pg.Pool): Promise<void> {
  const site = await pumpStationSite(pool, "rsmoc");
  expect(
    site?.live.criticalAlarms,
    "a pin that joins a location counts its open critical alarm — 0 means it fell to stationLive",
  ).toBe(1);
}

/**
 * M2c — the post-`0085` shape, where the pin also says `pump_station`: a
 * three-literal test on either the pin's kind or the resolved kind drops it.
 */
export async function assertJoinedPumpStationPinOfPumpStationKindCountsItsAssets(
  pool: pg.Pool,
): Promise<void> {
  const site = await pumpStationSite(pool, "pump_station");
  expect(
    site?.live.assetsTotal,
    "a pump_station pin that joins a location carries campus live health",
  ).toBe(1);
}

/** Lists every site and returns an `eskom_station` pin that joins no location. */
async function unjoinedStationSite(pool: pg.Pool): Promise<MapSiteDto | undefined> {
  return withRolledBackClient(pool, async (client) => {
    const run = randomUUID().slice(0, 8);
    const slug = `f4157m-station-${run}`;
    await client.query(
      `INSERT INTO bms.map_locations (slug, name, kind, latitude, longitude, station_operating_status)
       VALUES ($1, $2, 'eskom_station', 0, 0, 'op')`,
      [slug, `F4.157 map station fixture ${run}`],
    );
    const sites = await mapService(client).sitesLive();
    const site = sites.find((candidate) => candidate.slug === slug);
    expect(site, "the fixture station pin is listed").toBeDefined();
    expect(site?.canonicalLocationId, "the station pin joins no location").toBeNull();
    return site;
  });
}

/** M3a — an unjoined `eskom_station` pin reads "Station". */
export async function assertUnjoinedStationPinKindLabelIsStation(pool: pg.Pool): Promise<void> {
  const site = await unjoinedStationSite(pool);
  expect(site?.kindLabel, "an eskom_station pin with no location is labelled Station").toBe("Station");
}

/**
 * M3b — an unjoined pin's status comes from `station_operating_status`:
 * `'op'` reads `nominal`, which campus live health never returns.
 */
export async function assertUnjoinedStationPinStatusIsItsOperatingStatus(pool: pg.Pool): Promise<void> {
  const site = await unjoinedStationSite(pool);
  expect(site?.live.status, "station_operating_status 'op' makes the pin nominal").toBe("nominal");
}

/** No `F4157M` fixture row survives the rolled-back cases (counted as `bms_fleet`). */
export async function assertNoF4157MapFixtureRowsRemain(pool: pg.Pool): Promise<void> {
  const result = await pool.query<{ role: string; locations: number; pins: number }>(
    `SELECT current_user AS role,
            (SELECT COUNT(*)::int FROM bms.locations WHERE code LIKE 'F4157M-%') AS locations,
            (SELECT COUNT(*)::int FROM bms.map_locations WHERE slug LIKE 'f4157m-%') AS pins`,
  );
  const row = result.rows[0];
  expect(row?.role, "counted as bms_fleet, which FORCE RLS does not hide rows from").toBe("bms_fleet");
  expect({ locations: row?.locations, pins: row?.pins }, "no F4157M fixture row remains").toEqual({
    locations: 0,
    pins: 0,
  });
}

/**
 * `F3.79` (owner ruling 2026-10-04) — every active location is a map pin. Only the seed writes
 * `bms.map_locations`, so a location an admin or the onboarding agent creates had no pin and the
 * Control Room organization level's site map showed a card with no marker. `sitesLive` now adds
 * each active location that no `map_locations` row joins, from the location's own columns.
 *
 * Every fixture row is prefixed `F379M` / `f379m-` and written inside a rolled-back transaction;
 * `assertNoF379MapFixtureRowsRemain` proves none survives the run.
 */
type UnpinnedFixture = {
  locationId: string;
  organizationId: string;
  assetId: string;
  slug: string;
  name: string;
};

async function insertUnpinnedLocation(
  client: pg.PoolClient,
  run: string,
  opts: { active: boolean; pin: boolean },
): Promise<UnpinnedFixture> {
  const db = createDb(client as unknown as pg.Pool);
  const { organizationId } = await fixtureLocation(db);
  const slug = `f379m-${run}`;
  const name = `F3.79 map fixture ${run}`;
  const location = await client.query<{ id: string }>(
    `INSERT INTO bms.locations
       (organization_id, code, slug, name, type, province, latitude, longitude, active)
     VALUES ($1, $2, $3, $4, 'pump_station', 'Odisha', 21.5, 86.9, $5) RETURNING id`,
    [organizationId, `F379M-${run}`, slug, name, opts.active],
  );
  const locationId = location.rows[0]?.id as string;
  if (opts.pin) {
    await client.query(
      `INSERT INTO bms.map_locations (slug, name, kind, site_name, latitude, longitude)
       VALUES ($1, $2, 'pump_station', $2, 21.5, 86.9)`,
      [slug, name],
    );
  }
  const [assetId] = await createFixtureAssets(db, 1, "F379M", { locationId, organizationId });
  if (!assetId) throw new Error("F3.79: no fixture asset");
  return { locationId, organizationId, assetId, slug, name };
}

/**
 * I1 — an active location with no `map_locations` row is a pin, built from its own columns, and
 * carries campus live health (its one fixture asset is counted).
 */
export async function assertAnUnpinnedActiveLocationIsAPin(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await insertUnpinnedLocation(client, randomUUID().slice(0, 8), { active: true, pin: false });
    const sites = await mapService(client).sitesLive({ assetIds: [fx.assetId] });
    const site = sites.find((candidate) => candidate.canonicalLocationId === fx.locationId);
    expect(site, "an active location with no map_locations row must be listed").toBeDefined();
    expect({
      id: site?.id,
      slug: site?.slug,
      name: site?.name,
      siteName: site?.siteName,
      organizationId: site?.organization?.id,
      latitude: site?.latitude,
      longitude: site?.longitude,
      kind: site?.kind,
      kindLabel: site?.kindLabel,
      province: site?.province,
    }).toEqual({
      id: fx.locationId,
      slug: fx.slug,
      name: fx.name,
      siteName: fx.name,
      organizationId: fx.organizationId,
      latitude: 21.5,
      longitude: 86.9,
      kind: "pump_station",
      kindLabel: "Pump station",
      province: "Odisha",
    });
    expect(site?.live.assetsTotal, "the location's asset is counted: campus live health").toBe(1);
  });
}

/**
 * I2 — an inactive location with no pin is not listed. The active location of I1 is the control
 * that such a location is listed at all.
 */
export async function assertAnUnpinnedInactiveLocationIsNotAPin(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await insertUnpinnedLocation(client, randomUUID().slice(0, 8), { active: false, pin: false });
    const sites = await mapService(client).sitesLive({ assetIds: [fx.assetId] });
    expect(
      sites.filter((candidate) => candidate.canonicalLocationId === fx.locationId),
      "an inactive location must not become a pin",
    ).toEqual([]);
  });
}

/** I3 — a location that a `map_locations` row joins is listed once, from that row. */
export async function assertAPinnedLocationIsListedOnce(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await insertUnpinnedLocation(client, randomUUID().slice(0, 8), { active: true, pin: true });
    const sites = await mapService(client).sitesLive({ assetIds: [fx.assetId] });
    const matches = sites.filter((candidate) => candidate.canonicalLocationId === fx.locationId);
    expect(matches, "the pinned location is listed exactly once").toHaveLength(1);
    expect(matches[0]?.id, "from its map_locations row, not as a second, location-built pin").not.toBe(
      fx.locationId,
    );
  });
}

/**
 * I4 — a scoped caller sees the new pin when the location's id is in its scope, and not when it
 * is not, even with the location's name in scope (`allowedLocationIds`, as `MapController`
 * passes it).
 */
export async function assertTheScopeFilterKeepsTheNewPinById(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await insertUnpinnedLocation(client, randomUUID().slice(0, 8), { active: true, pin: false });
    const service = mapService(client);
    const inScope = await service.sitesLive({
      allowedSiteNames: [fx.name],
      allowedLocationIds: [fx.locationId],
      assetIds: [fx.assetId],
    });
    expect(
      inScope.some((candidate) => candidate.canonicalLocationId === fx.locationId),
      "the location is in the caller's scope by id",
    ).toBe(true);
    const outOfScope = await service.sitesLive({
      allowedSiteNames: [fx.name],
      allowedLocationIds: [randomUUID()],
      assetIds: [fx.assetId],
    });
    expect(
      outOfScope.some((candidate) => candidate.canonicalLocationId === fx.locationId),
      "a scope without the location's id must not see it, whatever names it holds",
    ).toBe(false);
  });
}

/**
 * I5 — security review of `F3.79`: two organizations each hold an active, unpinned location of
 * the same name. A caller scoped to org A's location sees it and not org B's: location names are
 * tenant free text and not unique, so the filter must not match by name. Org A's location is the
 * positive control.
 */
export async function assertASameNamedLocationOfAnotherOrganizationIsNotSeen(
  pool: pg.Pool,
): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const run = randomUUID().slice(0, 8);
    const mine = await insertUnpinnedLocation(client, run, { active: true, pin: false });
    const org = await client.query<{ id: string }>(
      `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
      [`F379M-ORG-${run}`, `F3.79 other organization ${run}`],
    );
    const theirs = await client.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, $4, 'pump_station', 22.5, 88.3) RETURNING id`,
      [org.rows[0]?.id, `F379M-B-${run}`, `f379m-b-${run}`, mine.name],
    );
    const theirLocationId = theirs.rows[0]?.id as string;

    const sites = await mapService(client).sitesLive({
      allowedSiteNames: [mine.name],
      allowedLocationIds: [mine.locationId],
      assetIds: [mine.assetId],
    });
    const ids = sites.map((candidate) => candidate.canonicalLocationId);
    expect(ids, "control: the caller sees its own location").toContain(mine.locationId);
    expect(ids, "the other organization's same-named location must not be seen").not.toContain(
      theirLocationId,
    );
  });
}

/**
 * I6 — a pin that joins no location (a seeded reference station) is still scoped by its
 * `site_name`: it has no location id to match. Seen with its name in scope, not seen without.
 */
export async function assertAnUnjoinedPinIsStillScopedByName(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const run = randomUUID().slice(0, 8);
    const slug = `f379m-station-${run}`;
    const siteName = `F3.79 station site ${run}`;
    await client.query(
      `INSERT INTO bms.map_locations (slug, name, kind, site_name, latitude, longitude)
       VALUES ($1, $2, 'eskom_station', $3, 0, 0)`,
      [slug, `F3.79 station ${run}`, siteName],
    );
    const service = mapService(client);
    const named = await service.sitesLive({ allowedSiteNames: [siteName], allowedLocationIds: [] });
    expect(
      named.some((candidate) => candidate.slug === slug),
      "an unjoined pin is seen when its site_name is in scope",
    ).toBe(true);
    const unnamed = await service.sitesLive({ allowedSiteNames: [], allowedLocationIds: [] });
    expect(
      unnamed.some((candidate) => candidate.slug === slug),
      "an unjoined pin is not seen when its site_name is out of scope",
    ).toBe(false);
  });
}

/** No `F379M` fixture row survives the rolled-back cases (counted as `bms_fleet`). */
export async function assertNoF379MapFixtureRowsRemain(pool: pg.Pool): Promise<void> {
  const result = await pool.query<{ role: string; locations: number; pins: number; organizations: number }>(
    `SELECT current_user AS role,
            (SELECT COUNT(*)::int FROM bms.locations WHERE code LIKE 'F379M-%') AS locations,
            (SELECT COUNT(*)::int FROM bms.map_locations WHERE slug LIKE 'f379m-%') AS pins,
            (SELECT COUNT(*)::int FROM bms.organizations WHERE code LIKE 'F379M-%') AS organizations`,
  );
  const row = result.rows[0];
  expect(row?.role, "counted as bms_fleet, which FORCE RLS does not hide rows from").toBe("bms_fleet");
  expect(
    { locations: row?.locations, pins: row?.pins, organizations: row?.organizations },
    "no F379M fixture row remains",
  ).toEqual({
    locations: 0,
    pins: 0,
    organizations: 0,
  });
}

// ---------------------------------------------------------------------------
// F2.10 — the pin rule on both arms, and the parent filter (ADR 0098 decision 11, B4, B12)
// ---------------------------------------------------------------------------

/**
 * One organization the case creates (`F210M-<run>`; the tree guard's advisory lock is per
 * organization, so never a seeded one):
 *
 *     campus (no asset) ── siteA (asset)
 *                       └─ siteB (no asset) ── inactive child
 *     secondCampus (asset) ── secondSite (asset)
 *     dormant (inactive asset only) ── dormantSite (asset)
 *     seededCampus (no asset, joined by a map_locations row) ── seededSite (asset)
 *
 * plus a `map_locations` row that joins no location (a reference station). `seededCampus` is
 * its own node rather than `campus` so each arm has an asset-less interior node of its own: arm 2
 * never lists a node a `map_locations` row joins, so one node cannot gate both arms. `siteB` holds
 * no asset so it is a pin by the leaf half of `PIN_RULE` alone — an asset would make it a pin
 * whatever its child's `active` flag is, and P3 would gate nothing. `dormant` is its own root so
 * its inactive asset (P9) does not touch P5's set under `campus`.
 */
type TreeMapFixture = {
  readonly campus: string;
  readonly siteA: string;
  readonly siteB: string;
  readonly secondCampus: string;
  readonly dormant: string;
  readonly dormantSite: string;
  readonly seededCampus: string;
  readonly seededSlug: string;
  readonly stationSlug: string;
  readonly assetIds: string[];
};

async function insertTreeMapFixture(client: pg.PoolClient): Promise<TreeMapFixture> {
  const run = randomUUID().slice(0, 8);
  const db = createDb(client as unknown as pg.Pool);
  const org = await client.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
    [`F210M-${run}`, `F2.10 map ${run}`],
  );
  const organizationId = org.rows[0]?.id as string;
  const node = async (name: string, parentId: string | null, active = true): Promise<string> => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id, active)
       VALUES ($1, $2, $3, $4, 'smoc_campus', 19.1, 72.9, $5, $6) RETURNING id`,
      [organizationId, `F210M-${run}-${name}`, `f210m-${run}-${name}`, `F2.10 map ${name} ${run}`, parentId, active],
    );
    return rows[0]?.id as string;
  };
  const assetIds: string[] = [];
  const asset = async (locationId: string): Promise<void> => {
    const [id] = await createFixtureAssets(db, 1, "F210M", { locationId, organizationId });
    if (!id) throw new Error("F2.10: no fixture asset");
    assetIds.push(id);
  };
  const campus = await node("campus", null);
  const siteA = await node("sitea", campus);
  const siteB = await node("siteb", campus);
  await node("inactive", siteB, false);
  const secondCampus = await node("second", null);
  const secondSite = await node("secondsite", secondCampus);
  const seededCampus = await node("seeded", null);
  const seededSite = await node("seededsite", seededCampus);
  const dormant = await node("dormant", null);
  const dormantSite = await node("dormantsite", dormant);
  for (const id of [siteA, secondCampus, secondSite, seededSite, dormantSite, dormant]) await asset(id);
  // The last asset is dormant's own, and the only one it holds: inactive (P9).
  await client.query(`UPDATE bms.assets SET active = false WHERE id = $1`, [assetIds[assetIds.length - 1]]);

  const seededSlug = `f210m-${run}-seeded`;
  const stationSlug = `f210m-${run}-station`;
  await client.query(
    `INSERT INTO bms.map_locations (slug, name, kind, site_name, latitude, longitude)
     VALUES ($1, $2, 'smoc_campus', $2, 19.1, 72.9)`,
    [seededSlug, `F2.10 map seeded pin ${run}`],
  );
  await client.query(
    `INSERT INTO bms.map_locations (slug, name, kind, site_name, latitude, longitude)
     VALUES ($1, $2, 'eskom_station', $2, 0, 0)`,
    [stationSlug, `F2.10 map station ${run}`],
  );
  return { campus, siteA, siteB, secondCampus, dormant, dormantSite, seededCampus, seededSlug, stationSlug, assetIds };
}

async function treeSites(
  pool: pg.Pool,
  run: (service: MapService, fx: TreeMapFixture) => Promise<void>,
): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await insertTreeMapFixture(client);
    await run(mapService(client), fx);
  });
}

const locationIdsOf = (sites: readonly MapSiteDto[]): Array<string | null> =>
  sites.map((site) => site.canonicalLocationId);

/** P1 — an interior node with no asset of its own (the campus, arm 2) is a filter, not a pin. */
export async function assertAnInteriorNodeWithNoAssetIsNotAPin(pool: pg.Pool): Promise<void> {
  await treeSites(pool, async (service, fx) => {
    const ids = locationIdsOf(await service.sitesLive());
    expect(ids, "control: the campus's leaf siteA is a pin").toContain(fx.siteA);
    expect(ids, "an asset-less interior node is not a pin").not.toContain(fx.campus);
  });
}

/** P2 — an interior node that holds an active asset is a pin. */
export async function assertAnInteriorNodeHoldingAnActiveAssetIsAPin(pool: pg.Pool): Promise<void> {
  await treeSites(pool, async (service, fx) => {
    expect(locationIdsOf(await service.sitesLive()), "an interior node holding an asset is a pin").toContain(
      fx.secondCampus,
    );
  });
}

/** P3 — a parent whose only child is inactive counts as a leaf: siteB (no asset of its own) is a pin. */
export async function assertAParentWhoseOnlyChildIsInactiveIsAPin(pool: pg.Pool): Promise<void> {
  await treeSites(pool, async (service, fx) => {
    expect(locationIdsOf(await service.sitesLive()), "an inactive child does not make a parent").toContain(fx.siteB);
  });
}

/** P9 — an interior node whose only asset is inactive is not a pin; its active child site is (the control). */
export async function assertAnInteriorNodeHoldingOnlyAnInactiveAssetIsNotAPin(pool: pg.Pool): Promise<void> {
  await treeSites(pool, async (service, fx) => {
    const ids = locationIdsOf(await service.sitesLive());
    expect(ids, "control: the dormant root's child site is a pin").toContain(fx.dormantSite);
    expect(ids, "an inactive asset does not make an interior node a pin").not.toContain(fx.dormant);
  });
}

/** P4 — arm 1: a `map_locations` row joined to an asset-less interior node is dropped; the unjoined station row is not. */
export async function assertTheSeededArmFollowsThePinRule(pool: pg.Pool): Promise<void> {
  await treeSites(pool, async (service, fx) => {
    const sites = await service.sitesLive();
    const slugs = sites.map((site) => site.slug);
    expect(slugs, "control: an unjoined map_locations row stays").toContain(fx.stationSlug);
    expect(slugs, "a map_locations row joined to an asset-less interior node is not a pin").not.toContain(
      fx.seededSlug,
    );
    expect(locationIdsOf(sites), "nor is the node listed through arm 2").not.toContain(fx.seededCampus);
  });
}

/** P5 — `parentLocationId: campus` keeps exactly the campus subtree's pins: siteA and siteB. */
export async function assertTheParentFilterKeepsOnlyTheSubtreesPins(pool: pg.Pool): Promise<void> {
  await treeSites(pool, async (service, fx) => {
    const sites = await service.sitesLive({ parentLocationId: fx.campus });
    expect(new Set(locationIdsOf(sites)), "exactly the campus subtree's pins").toEqual(new Set([fx.siteA, fx.siteB]));
  });
}

/** P6 — with a parent filter, a pin that joins no location is dropped (B4); without one it is listed. */
export async function assertTheParentFilterDropsUnjoinedStationPins(pool: pg.Pool): Promise<void> {
  await treeSites(pool, async (service, fx) => {
    const unfiltered = (await service.sitesLive()).map((site) => site.slug);
    expect(unfiltered, "control: the station pin is listed without a filter").toContain(fx.stationSlug);
    const filtered = await service.sitesLive({ parentLocationId: fx.campus });
    expect(filtered.map((site) => site.slug), "the station pin is dropped under a filter").not.toContain(fx.stationSlug);
    expect(filtered.length, "control: the filter still lists the subtree's pins").toBeGreaterThan(0);
    expect(filtered.every((site) => site.canonicalLocationId !== null), "no unjoined pin under a filter").toBe(true);
  });
}

/** P7 — a caller scoped to siteA asking for a foreign root's subtree sees nothing. */
export async function assertAScopedCallerWithAnUnreadableParentSeesNothing(pool: pg.Pool): Promise<void> {
  await treeSites(pool, async (service, fx) => {
    const scope = { allowedSiteNames: [], allowedLocationIds: [fx.siteA], assetIds: fx.assetIds };
    expect(locationIdsOf(await service.sitesLive(scope)), "control: the scoped caller sees siteA").toContain(fx.siteA);
    const sites = await service.sitesLive({ ...scope, parentLocationId: fx.secondCampus });
    expect(sites, "an unreadable parent answers []").toEqual([]);
  });
}

/**
 * P8 — a caller scoped to siteA asking for siteA's unreadable **ancestor** sees nothing. Intersecting
 * the subtree with the scope alone would answer [siteA] here and confirm a parent link that
 * `/auth/me` hides; the filter refuses a parent outside the readable set first.
 */
export async function assertAScopedCallerWithAnUnreadableAncestorSeesNothing(pool: pg.Pool): Promise<void> {
  await treeSites(pool, async (service, fx) => {
    const scope = { allowedSiteNames: [], allowedLocationIds: [fx.siteA], assetIds: fx.assetIds };
    const own = await service.sitesLive({ ...scope, parentLocationId: fx.siteA });
    expect(locationIdsOf(own), "control: a readable parent keeps its own pin").toEqual([fx.siteA]);
    const sites = await service.sitesLive({ ...scope, parentLocationId: fx.campus });
    expect(sites, "an unreadable ancestor of a readable node answers []").toEqual([]);
  });
}

/** No `F210M` fixture row survives the rolled-back cases (counted as `bms_fleet`). */
export async function assertNoF210MapFixtureRowsRemain(pool: pg.Pool): Promise<void> {
  const result = await pool.query<{ role: string; locations: number; pins: number; organizations: number }>(
    `SELECT current_user AS role,
            (SELECT COUNT(*)::int FROM bms.locations WHERE code LIKE 'F210M-%') AS locations,
            (SELECT COUNT(*)::int FROM bms.map_locations WHERE slug LIKE 'f210m-%') AS pins,
            (SELECT COUNT(*)::int FROM bms.organizations WHERE code LIKE 'F210M-%') AS organizations`,
  );
  const row = result.rows[0];
  expect(row?.role, "counted as bms_fleet, which FORCE RLS does not hide rows from").toBe("bms_fleet");
  expect(
    { locations: row?.locations, pins: row?.pins, organizations: row?.organizations },
    "no F210M fixture row remains",
  ).toEqual({ locations: 0, pins: 0, organizations: 0 });
}
