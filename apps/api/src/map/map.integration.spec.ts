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
    const service = new MapService(client as unknown as pg.Pool);

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
    const service = new MapService(client as unknown as pg.Pool);

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
    const service = new MapService(client as unknown as pg.Pool);

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
    const sites = await new MapService(client as unknown as pg.Pool).sitesLive({ assetIds: [assetId] });
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
    const sites = await new MapService(client as unknown as pg.Pool).sitesLive();
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
    const sites = await new MapService(client as unknown as pg.Pool).sitesLive({ assetIds: [fx.assetId] });
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
    const sites = await new MapService(client as unknown as pg.Pool).sitesLive({ assetIds: [fx.assetId] });
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
    const sites = await new MapService(client as unknown as pg.Pool).sitesLive({ assetIds: [fx.assetId] });
    const matches = sites.filter((candidate) => candidate.canonicalLocationId === fx.locationId);
    expect(matches, "the pinned location is listed exactly once").toHaveLength(1);
    expect(matches[0]?.id, "from its map_locations row, not as a second, location-built pin").not.toBe(
      fx.locationId,
    );
  });
}

/**
 * I4 — a scoped caller sees the new pin when the location's name is in its scope, and not when
 * it is not (`allowedSiteNames`, as `MapController` passes it).
 */
export async function assertTheScopeFilterKeepsTheNewPinByName(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await insertUnpinnedLocation(client, randomUUID().slice(0, 8), { active: true, pin: false });
    const service = new MapService(client as unknown as pg.Pool);
    const inScope = await service.sitesLive({ allowedSiteNames: [fx.name], assetIds: [fx.assetId] });
    expect(
      inScope.some((candidate) => candidate.canonicalLocationId === fx.locationId),
      "the location is in the caller's scope by name",
    ).toBe(true);
    const outOfScope = await service.sitesLive({
      allowedSiteNames: ["F3.79 a site outside the scope"],
      assetIds: [fx.assetId],
    });
    expect(
      outOfScope.some((candidate) => candidate.canonicalLocationId === fx.locationId),
      "a scope without the location must not see it",
    ).toBe(false);
  });
}

/** No `F379M` fixture row survives the rolled-back cases (counted as `bms_fleet`). */
export async function assertNoF379MapFixtureRowsRemain(pool: pg.Pool): Promise<void> {
  const result = await pool.query<{ role: string; locations: number; pins: number }>(
    `SELECT current_user AS role,
            (SELECT COUNT(*)::int FROM bms.locations WHERE code LIKE 'F379M-%') AS locations,
            (SELECT COUNT(*)::int FROM bms.map_locations WHERE slug LIKE 'f379m-%') AS pins`,
  );
  const row = result.rows[0];
  expect(row?.role, "counted as bms_fleet, which FORCE RLS does not hide rows from").toBe("bms_fleet");
  expect({ locations: row?.locations, pins: row?.pins }, "no F379M fixture row remains").toEqual({
    locations: 0,
    pins: 0,
  });
}
