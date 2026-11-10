import { randomUUID } from "node:crypto";

import type pg from "pg";
import { expect } from "vitest";

import { assetIdsScopeSql, assetWindowsCteSql, LIVE_ASSETS_CTE_SQL } from "./telemetry-cadence";

/**
 * `F4.350` (ADR 0075 Amendment 3) — the per-asset window against a real database: a device is
 * live inside `clamp(2.5 x its RTU's interval, 25 s, 900 s)`. Assertions live here; the sibling
 * `.integration.test` owns the pool (ADR 0014).
 *
 * **Every case runs in one transaction and rolls it back**, and stamps each sample in SQL
 * relative to the transaction's frozen `now()`, the instant the CTE compares against, so a
 * sample's age is exact however long seeding takes. Every read is scoped to the fixture's asset
 * ids, so the fleet's own telemetry cannot move a result.
 *
 * Only the **configured** interval is exercised here. The learned interval reads the
 * `point_values_1h` aggregate, whose completed hours an uncommitted fixture row cannot enter,
 * so that path is NOT covered by a gate here: it was checked by hand on a stub Postgres (PR body) and is owed to the AWS check.
 */

const RUN_CODE = `F4350-${randomUUID().slice(0, 8)}`;

/** Runs `fn` in a transaction on one client and always rolls it back. */
export async function inRolledBackCadenceTransaction(
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

interface Fixture {
  readonly organizationId: string;
  readonly locationId: string;
  readonly domainCode: string;
}

async function seedFixture(client: pg.PoolClient): Promise<Fixture> {
  const domain = await client.query<{ code: string }>("SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1");
  const domainCode = domain.rows[0]?.code;
  if (!domainCode) throw new Error("bms.asset_domains is empty — run pnpm db:migrate && pnpm db:seed first");
  const tag = `${RUN_CODE}-${randomUUID().slice(0, 8)}`;
  const org = await client.query<{ id: string }>(
    "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'ZAR') RETURNING id",
    [`${tag}-ORG`, "F4.350 cadence fixture organization"],
  );
  const organizationId = org.rows[0]?.id;
  if (!organizationId) throw new Error("failed to insert the F4.350 fixture organization");
  const loc = await client.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
     VALUES ($1, $2, $3, $4, 'rsmoc', 0, 0, true) RETURNING id`,
    [organizationId, `${tag}-LOC`, tag.toLowerCase(), "F4.350 cadence fixture site"],
  );
  const locationId = loc.rows[0]?.id;
  if (!locationId) throw new Error("failed to insert the F4.350 fixture location");
  return { organizationId, locationId, domainCode };
}

/** An RTU with the given configured interval (null = not configured) and one asset on it with a sample `ageSeconds` old. */
async function seedDevice(
  client: pg.PoolClient,
  fixture: Fixture,
  expectedIntervalSeconds: number | null,
  ageSeconds: number,
): Promise<string> {
  const tag = `${RUN_CODE}-${randomUUID().slice(0, 8)}`;
  const rtu = await client.query<{ id: string }>(
    `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type, expected_interval_seconds)
     VALUES ($1, $2, $3, $4, 'simulator', $5) RETURNING id`,
    [fixture.organizationId, fixture.locationId, `${tag}-RTU`, "F4.350 fixture RTU", expectedIntervalSeconds],
  );
  const rtuId = rtu.rows[0]?.id;
  if (!rtuId) throw new Error("failed to insert the F4.350 fixture RTU");
  const asset = await client.query<{ id: string }>(
    `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain, rtu_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [fixture.organizationId, tag, "F4.350 fixture asset", tag, fixture.locationId, fixture.domainCode, rtuId],
  );
  const assetId = asset.rows[0]?.id;
  if (!assetId) throw new Error("failed to insert the F4.350 fixture asset");
  await client.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     VALUES (now() - make_interval(secs => $2), $1, 'kw', 1, 'u')`,
    [assetId, ageSeconds],
  );
  return assetId;
}

/** Which of `assetIds` the shared `live` CTE counts live. */
async function liveAmong(client: pg.PoolClient, assetIds: readonly string[]): Promise<Set<string>> {
  const result = await client.query<{ asset_id: string }>(
    `WITH ${LIVE_ASSETS_CTE_SQL} SELECT asset_id FROM live WHERE asset_id = ANY($1::uuid[])`,
    [[...assetIds]],
  );
  return new Set(result.rows.map((row) => row.asset_id));
}

/** C1 — a 60 s device is live at 55 s and offline at 160 s (window 150 s); the old 25 s read both offline. */
export async function assertSixtySecondDeviceFollowsItsInterval(client: pg.PoolClient): Promise<void> {
  const fixture = await seedFixture(client);
  const at55 = await seedDevice(client, fixture, 60, 55);
  const at140 = await seedDevice(client, fixture, 60, 140);
  const at160 = await seedDevice(client, fixture, 60, 160);
  const live = await liveAmong(client, [at55, at140, at160]);
  expect([live.has(at55), live.has(at140), live.has(at160)]).toEqual([true, true, false]);
}

/** C2 — a 2 s device keeps the 25 s floor: live at 20 s, offline at 30 s. */
export async function assertFastDeviceKeepsTheFloor(client: pg.PoolClient): Promise<void> {
  const fixture = await seedFixture(client);
  const at20 = await seedDevice(client, fixture, 2, 20);
  const at30 = await seedDevice(client, fixture, 2, 30);
  const live = await liveAmong(client, [at20, at30]);
  expect([live.has(at20), live.has(at30)]).toEqual([true, false]);
}

/** C3 — an RTU with no interval and no history takes the floor, not a wider window. */
export async function assertUnknownCadenceTakesTheFloor(client: pg.PoolClient): Promise<void> {
  const fixture = await seedFixture(client);
  const at20 = await seedDevice(client, fixture, null, 20);
  const at30 = await seedDevice(client, fixture, null, 30);
  const live = await liveAmong(client, [at20, at30]);
  expect([live.has(at20), live.has(at30)]).toEqual([true, false]);
}

/** C4 — the cap: a very slow device is live at 800 s and offline at 1000 s (window 900 s). */
export async function assertTheCapBoundsTheWindow(client: pg.PoolClient): Promise<void> {
  const fixture = await seedFixture(client);
  const at800 = await seedDevice(client, fixture, 86_400, 800);
  const at1000 = await seedDevice(client, fixture, 86_400, 1000);
  const live = await liveAmong(client, [at800, at1000]);
  expect([live.has(at800), live.has(at1000)]).toEqual([true, false]);
}

/** C5 — `asset_windows` reports each asset's window: 150 s, 25 s, 900 s, and the floor when unknown. */
export async function assertAssetWindowsReportTheWindow(client: pg.PoolClient): Promise<void> {
  const fixture = await seedFixture(client);
  const sixty = await seedDevice(client, fixture, 60, 5);
  const fast = await seedDevice(client, fixture, 2, 5);
  const slow = await seedDevice(client, fixture, 86_400, 5);
  const unknown = await seedDevice(client, fixture, null, 5);
  const result = await client.query<{ asset_id: string; window_seconds: number }>(
    `WITH ${assetWindowsCteSql(assetIdsScopeSql([sixty, fast, slow, unknown]))} SELECT asset_id, window_seconds FROM asset_windows`,
  );
  const byAsset = new Map(result.rows.map((row) => [row.asset_id, Number(row.window_seconds)]));
  expect([byAsset.get(sixty), byAsset.get(fast), byAsset.get(slow), byAsset.get(unknown)]).toEqual([150, 25, 900, 25]);
}

/** C6 — the schema refuses a zero or negative interval (the migration's CHECK). */
export async function assertTheCheckRefusesANonPositiveInterval(client: pg.PoolClient): Promise<void> {
  const fixture = await seedFixture(client);
  await client.query("SAVEPOINT before_bad_interval");
  await expect(seedDevice(client, fixture, 0, 5)).rejects.toThrow(/rtus_expected_interval_seconds_check/);
  await client.query("ROLLBACK TO SAVEPOINT before_bad_interval");
}
