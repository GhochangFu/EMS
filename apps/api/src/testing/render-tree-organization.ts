import { randomUUID } from "node:crypto";

import { inArray, sql } from "drizzle-orm";

import { assets } from "@bms/db";
import type { BmsDb } from "@bms/db";

/**
 * `F2.10` — organizations the render integration suite creates for itself, so
 * every asset-set claim it makes is exact.
 *
 * **Why not a seeded organization or location.** Other suites commit and
 * delete fixture assets in the seeded ESKOM organization (F3.37's asset-group
 * rows, F3.78, E2.4, ...) while a render runs. An expectation read from a
 * shared organization, before or after the render, can therefore disagree
 * with the render by rows that existed for only one side of it: in CI the
 * whole-organization row saw "15 of 120 are outside it". Nothing but the
 * suite that created it writes to an organization below, so its asset set is
 * the set of ids this module returned.
 *
 * Written as `bms_fleet` (`BYPASSRLS`). The sweep runs after the schedules and
 * their files (a schedule holds an FK to its organization): the assets by this
 * run's ids, the locations leaf-first, the organization last.
 *
 * The asset delete is a drizzle builder write by id — the form
 * `tests/integration-fixture-isolation.test.ts` allows (the rule is about
 * reading `bms.assets`; its raw-SQL pattern also matches a `delete from`).
 */

/** One fixture organization and the rows a case put in it, parents first. */
export type TreeOrganization = {
  readonly organizationId: string;
  readonly locationIds: string[];
  readonly assetIds: string[];
};

/** What the helpers need from the suite's fixtures: the fleet pool and the sweep list. */
export type TreeHost = {
  readonly base: { readonly fleetDb: BmsDb };
  readonly treeOrganizations: TreeOrganization[];
};

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** A committed `F210R-<run>` organization, recorded for the sweep. */
export async function treeOrganization(fx: TreeHost): Promise<TreeOrganization> {
  const code = `F210R-${randomUUID().slice(0, 8)}`;
  const result = await fx.base.fleetDb.execute<{ id: string }>(
    sql`insert into bms.organizations (code, name, currency) values (${code}, ${`F2.10 render ${code}`}, 'INR') returning id::text as id`,
  );
  const organizationId = result.rows[0]?.id;
  check(organizationId !== undefined, `the tree organization ${code} was not created`);
  const tree: TreeOrganization = { organizationId: organizationId as string, locationIds: [], assetIds: [] };
  fx.treeOrganizations.push(tree);
  return tree;
}

/** A location under `parentId` (or a root). */
export async function treeLocation(fx: TreeHost, tree: TreeOrganization, parentId: string | null): Promise<string> {
  const code = `F210R-${randomUUID().slice(0, 8)}`;
  const result = await fx.base.fleetDb.execute<{ id: string }>(sql`
    insert into bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id)
    values (${tree.organizationId}::uuid, ${code}, ${code.toLowerCase()}, ${`F2.10 ${code}`}, 'smoc_campus', 0, 0, ${parentId}::uuid)
    returning id::text as id
  `);
  const id = result.rows[0]?.id;
  check(id !== undefined, `location ${code} was not created`);
  tree.locationIds.push(id as string);
  return id as string;
}

/** One active asset at `locationId`. */
export async function treeAsset(fx: TreeHost, tree: TreeOrganization, locationId: string): Promise<string> {
  const code = `F210R-${randomUUID().slice(0, 8)}`;
  const result = await fx.base.fleetDb.execute<{ id: string }>(sql`
    insert into bms.assets (organization_id, location_id, code, name, site_name, domain)
    values (${tree.organizationId}::uuid, ${locationId}::uuid, ${code}, ${`F2.10 ${code}`}, 'F2.10',
            (select code from bms.asset_domains order by code limit 1))
    returning id::text as id
  `);
  const id = result.rows[0]?.id;
  check(id !== undefined, `asset ${code} was not created`);
  tree.assetIds.push(id as string);
  return id as string;
}

/** Order-free equality of two id lists, with both lists in the message. */
export function sameSet(actual: readonly string[], expected: readonly string[], what: string): void {
  const a = [...actual].sort();
  const e = [...expected].sort();
  check(JSON.stringify(a) === JSON.stringify(e), `${what}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
}

/** Deletes every tree organization's rows; a count that does not match goes into `failures`. */
export async function sweepTreeOrganizations(fleet: BmsDb, trees: readonly TreeOrganization[], failures: string[]): Promise<void> {
  for (const tree of trees) {
    if (tree.assetIds.length > 0) {
      const removedAssets = await fleet.delete(assets).where(inArray(assets.id, tree.assetIds));
      if (removedAssets.rowCount !== tree.assetIds.length) {
        failures.push(`expected the sweep to delete ${tree.assetIds.length} F2.10 tree asset(s), got ${removedAssets.rowCount}`);
      }
    }
    for (const locationId of [...tree.locationIds].reverse()) {
      await fleet.execute(sql`delete from bms.locations where id = ${locationId}::uuid`);
    }
    const removed = await fleet.execute(sql`delete from bms.organizations where id = ${tree.organizationId}::uuid`);
    if (removed.rowCount !== 1) {
      failures.push(`expected the sweep to delete the F2.10 tree organization, got ${removed.rowCount}`);
    }
  }
}
