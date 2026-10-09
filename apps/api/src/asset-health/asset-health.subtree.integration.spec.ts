import { randomUUID } from "node:crypto";

import type pg from "pg";

import { createDb } from "@bms/db";

import { createFixtureAssets } from "../testing/integration-fixtures";
import { AssetHealthService } from "./asset-health.service";

/**
 * `F2.10` / ADR 0098 decision 7, Amendment 1 A7 — the health summary's
 * `locationId` filter means the node and every node under it. A filter, not
 * a grouping: the response shape is unchanged.
 *
 * `asset-health.service.spec.ts` cannot see this: its harness passes
 * `locationId: undefined`, so the subtree expansion is SQL this file is the
 * only gate on.
 *
 * **Fixtures.** Each case runs inside one transaction on one fleet
 * connection and rolls it back (`map.integration.spec.ts`'s shape). The tree
 * lives in an organization the case creates — the tree guard's advisory lock
 * is per organization, so a seeded one would block sibling suites:
 *
 *     F210H:  campus ── site ── room        sibling
 *
 * One active asset on each of the four nodes. Expectations are counts of the
 * assets the fixture inserted, never read back from the service.
 */

type Fx = {
  readonly campus: string;
  readonly site: string;
  readonly room: string;
  readonly sibling: string;
  readonly roomAsset: string;
  readonly siblingAsset: string;
};

const WINDOW_MINUTES = 60;

function fail(message: string): never {
  throw new Error(message);
}

async function withRolledBackClient<T>(pool: pg.Pool, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await run(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

async function buildFixture(client: pg.PoolClient): Promise<Fx> {
  const run = randomUUID().slice(0, 8);
  const db = createDb(client as unknown as pg.Pool);
  const org = await client.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
    [`F210H-${run}`, `F2.10 health ${run}`],
  );
  const organizationId = org.rows[0]?.id ?? fail("organization was not inserted");
  const node = async (code: string, parentId: string | null): Promise<string> => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id)
       VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, $5) RETURNING id`,
      [organizationId, `F210H-${run}-${code}`, `f210h-${run}-${code}`, `F2.10 health ${code}`, parentId],
    );
    return rows[0]?.id ?? fail(`location ${code} was not inserted`);
  };
  const campus = await node("campus", null);
  const site = await node("site", campus);
  const room = await node("room", site);
  const sibling = await node("sibling", null);
  const asset = async (locationId: string): Promise<string> =>
    (await createFixtureAssets(db, 1, "F210H", { locationId, organizationId }))[0] ?? fail("asset was not inserted");
  await asset(campus);
  await asset(site);
  const roomAsset = await asset(room);
  const siblingAsset = await asset(sibling);
  return { campus, site, room, sibling, roomAsset, siblingAsset };
}

async function assetCount(
  client: pg.PoolClient,
  assetIds: readonly string[] | null,
  locationId: string,
): Promise<number> {
  const service = new AssetHealthService(createDb(client as unknown as pg.Pool));
  return (await service.summary(assetIds, locationId, WINDOW_MINUTES, new Date())).assetCount;
}

/** A campus filter counts the campus, site and room assets — the whole subtree. */
export async function assertACampusFilterCountsTheWholeSubtree(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const count = await assetCount(client, null, fx.campus);
    if (count !== 3) fail(`summary(null, campus).assetCount = ${count}; expected 3 (campus, site, room)`);
  });
}

/** A site filter counts the site and the room under it, and not the campus above it. */
export async function assertASiteFilterCountsItsOwnSubtreeOnly(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const count = await assetCount(client, null, fx.site);
    if (count !== 2) fail(`summary(null, site).assetCount = ${count}; expected 2 (site, room)`);
  });
}

/** A sibling root's asset is outside the campus subtree; the sibling filter itself does count it (the positive control). */
export async function assertASiblingSubtreeIsExcluded(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const control = await assetCount(client, [fx.siblingAsset], fx.sibling);
    if (control !== 1) fail(`positive control: summary([siblingAsset], sibling).assetCount = ${control}; expected 1`);
    const count = await assetCount(client, [fx.siblingAsset], fx.campus);
    if (count !== 0) fail(`summary([siblingAsset], campus).assetCount = ${count}; expected 0 — the sibling is not under the campus`);
  });
}

/** The subtree intersects the readable set: a caller who reads only the room asset counts 1 under the campus. */
export async function assertTheFilterNarrowsAndNeverWidens(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const count = await assetCount(client, [fx.roomAsset], fx.campus);
    if (count !== 1) fail(`summary([roomAsset], campus).assetCount = ${count}; expected 1 — the filter must not widen the readable set`);
  });
}

/** An id that names no location expands to nothing and answers an empty donut, not an error. */
export async function assertAnUnknownNodeCountsNothing(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    await buildFixture(client);
    const count = await assetCount(client, null, randomUUID());
    if (count !== 0) fail(`summary(null, <unknown id>).assetCount = ${count}; expected 0`);
  });
}
