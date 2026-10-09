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
 *
 * Owner ruling P2 (2026-10-09): the filter carries the caller's readable
 * location ids, and a scoped caller whose list lacks the node gets the empty
 * summary — `null` below is the unrestricted admin.
 */

type Fx = {
  readonly organizationId: string;
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
  return buildTree(client, db, organizationId, run);
}

async function buildTree(
  client: pg.PoolClient,
  db: ReturnType<typeof createDb>,
  organizationId: string,
  run: string,
): Promise<Fx> {
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
  return { organizationId, campus, site, room, sibling, roomAsset, siblingAsset };
}

/** `reader` null is the unrestricted admin; else the caller's readable locations and organizations. */
async function assetCount(
  client: pg.PoolClient,
  assetIds: readonly string[] | null,
  locationId: string,
  reader: { readonly locations: readonly string[]; readonly organizations: readonly string[] } | null,
): Promise<number> {
  const service = new AssetHealthService(createDb(client as unknown as pg.Pool));
  const location = {
    id: locationId,
    readableLocationIds: reader?.locations ?? null,
    readableOrganizationIds: reader?.organizations ?? null,
  };
  return (await service.summary(assetIds, location, WINDOW_MINUTES, new Date())).assetCount;
}

/** A campus filter counts the campus, site and room assets — the whole subtree. */
export async function assertACampusFilterCountsTheWholeSubtree(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const count = await assetCount(client, null, fx.campus, null);
    if (count !== 3) fail(`summary(null, campus).assetCount = ${count}; expected 3 (campus, site, room)`);
  });
}

/** A site filter counts the site and the room under it, and not the campus above it. */
export async function assertASiteFilterCountsItsOwnSubtreeOnly(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const count = await assetCount(client, null, fx.site, null);
    if (count !== 2) fail(`summary(null, site).assetCount = ${count}; expected 2 (site, room)`);
  });
}

/** A sibling root's asset is outside the campus subtree; the sibling filter itself does count it (the positive control). */
export async function assertASiblingSubtreeIsExcluded(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const control = await assetCount(client, [fx.siblingAsset], fx.sibling, null);
    if (control !== 1) fail(`positive control: summary([siblingAsset], sibling).assetCount = ${control}; expected 1`);
    const count = await assetCount(client, [fx.siblingAsset], fx.campus, null);
    if (count !== 0) fail(`summary([siblingAsset], campus).assetCount = ${count}; expected 0 — the sibling is not under the campus`);
  });
}

/**
 * The subtree intersects the readable set: a caller who reads the campus node
 * but only the room asset counts 1 under the campus — the filter never widens
 * the readable assets.
 */
export async function assertTheFilterNarrowsAndNeverWidens(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const count = await assetCount(client, [fx.roomAsset], fx.campus, {
      locations: [fx.campus, fx.site, fx.room],
      organizations: [fx.organizationId],
    });
    if (count !== 1) fail(`summary([roomAsset], campus).assetCount = ${count}; expected 1 — the filter must not widen the readable set`);
  });
}

/**
 * Owner ruling P2, the map's P8 case for health: a caller who reads only the
 * room gets the empty summary for the campus above it (an unreadable
 * ancestor) and for another organization's node, never the room's asset. The
 * foreign node's asset is in the caller's asset list on purpose, so the
 * intersection alone would count it: only the readable-location check
 * answers empty. Positive control first: the room itself counts 1.
 */
export async function assertAnUnreadableAncestorOrForeignNodeIsEmpty(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const run = randomUUID().slice(0, 8);
    const other = await client.query<{ id: string }>(
      `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
      [`F210H-${run}`, `F2.10 health other ${run}`],
    );
    const foreign = await buildTree(
      client,
      createDb(client as unknown as pg.Pool),
      other.rows[0]?.id ?? fail("the second organization was not inserted"),
      run,
    );
    const readable = { locations: [fx.room], organizations: [fx.organizationId] };
    const assetIds = [fx.roomAsset, foreign.roomAsset];

    const control = await assetCount(client, assetIds, fx.room, readable);
    if (control !== 1) fail(`positive control: summary([roomAsset, foreignRoomAsset], room).assetCount = ${control}; expected 1`);
    const ancestor = await assetCount(client, assetIds, fx.campus, readable);
    if (ancestor !== 0) {
      fail(`summary(.., campus) for a room-only reader = ${ancestor}; expected 0 — an unreadable ancestor must answer empty`);
    }
    const foreignCount = await assetCount(client, assetIds, foreign.room, readable);
    if (foreignCount !== 0) {
      fail(`summary(.., foreign room) for a room-only reader = ${foreignCount}; expected 0 — another organization's node must answer empty`);
    }
  });
}

/**
 * Owner ruling P3: a node id passed with an organization bound that does not
 * hold it starts no walk. A reader who reads the foreign tree's room but whose
 * organization bound is only the fixture's own organization counts nothing
 * there; the same reader with the foreign organization in the bound counts 1
 * (the positive control). The readable-location check passes in both, so only
 * the anchor's organization predicate decides.
 */
export async function assertAForeignAnchorOutsideTheBoundCountsNothing(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const foreign = await buildFixture(client);
    const assetIds = [foreign.roomAsset];
    const control = await assetCount(client, assetIds, foreign.room, {
      locations: [foreign.room],
      organizations: [foreign.organizationId],
    });
    if (control !== 1) fail(`positive control: the foreign room under its own organization = ${control}; expected 1`);
    const count = await assetCount(client, assetIds, foreign.room, {
      locations: [foreign.room],
      organizations: [fx.organizationId],
    });
    if (count !== 0) fail(`the foreign room under another organization's bound = ${count}; expected 0 — the anchor must filter on the bound`);
  });
}

/** An id that names no location expands to nothing and answers an empty donut, not an error. */
export async function assertAnUnknownNodeCountsNothing(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    await buildFixture(client);
    const count = await assetCount(client, null, randomUUID(), null);
    if (count !== 0) fail(`summary(null, <unknown id>).assetCount = ${count}; expected 0`);
  });
}
