import { randomUUID } from "node:crypto";

import type pg from "pg";
import { expect } from "vitest";

import { createDb } from "@bms/db";

import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";
import { MapService } from "./map.service";

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
 * locations.slug`, and only for an operational `kind`, so the fixture
 * location gets a `map_locations` row of its own with the same slug.
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

type Fixture = { locationId: string; assetId: string; slug: string };

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
  // `csmoc` is one of the three kinds `isOperationalLocation` counts alarms for.
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
  return { locationId, assetId, slug };
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
