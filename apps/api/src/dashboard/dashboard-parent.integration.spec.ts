import { randomUUID } from "node:crypto";

import type pg from "pg";

import { createDb } from "@bms/db";
import type { LocationKpiSummary } from "@bms/shared";

import { scopeFromSource } from "../auth/access-scope-sources";
import { DashboardService } from "./dashboard.service";
import { seedAsset, seedLocation, seedSite, type Site } from "./dashboard-freshness.integration.spec";
import { parentIdByLocation } from "./location-parent";

/**
 * `F4.240` (ADR 0139 decision 12, plan Task 1 Step 4, D10) — `parentId` on the location KPI
 * item, against a real database. The pure pass-through is `location-parent.spec.ts`; this file
 * holds the facts it rests on: the map built from a real `scopeFromSource` scope, and the
 * service writing it (or `null`) on both routes.
 *
 * **Fixture.** One fixture organization per case (`seedSite`), inside the caller's rolled-back
 * transaction (`inRolledBackTransaction`): a parent location with no asset over two children
 * with one asset each. The parent carries the RTU `seedSite` writes; no case reads `rtuCount`.
 *
 * **Scopes are real.** Each map comes from `scopeFromSource` on a Drizzle handle over the same
 * transaction client, so the `parentId` the service writes is the one `withVisibleParents`
 * decided for `/auth/me` — the dashboard re-decides nothing (plan D10).
 *
 * **Connection.** The superuser's (the sibling `.integration.test`), not `bms_fleet`: P2 inserts
 * a `bms.users` row for its grantee, and `bms_fleet` holds no `INSERT` on that table (migration
 * `0039`). The service reads the same rows either way — both bypass row security.
 *
 * Every read is scoped to the fixture's own location or asset ids, so the fleet's rows cannot
 * move a number.
 */

const NO_TARIFFS = { resolveForAssets: async () => new Map<string, number>() };
// This suite reads no location card's health figure.
const NO_HEALTH = { scoresByLocation: async () => new Map<string, number | null>() };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function service(client: pg.PoolClient): DashboardService {
  return new DashboardService(client as unknown as pg.Pool, NO_TARIFFS, NO_HEALTH);
}

interface Tree {
  readonly parent: Site;
  readonly children: readonly [Site, Site];
  readonly childAssets: readonly [string, string];
  readonly ids: readonly string[];
}

/** A parent with no asset over two active children with one asset each, in one fixture organization. */
async function seedTree(client: pg.PoolClient): Promise<Tree> {
  const parent = await seedSite(client);
  const first = await seedLocation(client, parent);
  const second = await seedLocation(client, parent);
  await client.query(`UPDATE bms.locations SET parent_id = $1 WHERE id = ANY($2::uuid[])`, [
    parent.locationId,
    [first.locationId, second.locationId],
  ]);
  const childAssets = [await seedAsset(client, first, "Child I"), await seedAsset(client, second, "Child II")] as const;
  return {
    parent,
    children: [first, second],
    childAssets,
    ids: [parent.locationId, first.locationId, second.locationId],
  };
}

async function globalParentMap(client: pg.PoolClient): Promise<Map<string, string | null>> {
  // The global branch reads no grant row, so the user id is never read.
  const scope = await scopeFromSource(createDb(client as unknown as pg.Pool), { id: randomUUID(), role: "admin" }, "global");
  return parentIdByLocation(scope);
}

function byId(items: readonly LocationKpiSummary[]): Map<string, LocationKpiSummary> {
  return new Map(items.map((item) => [item.id, item]));
}

/** P1 — global scope: each child's `parentId` is the parent's id; the parent's is `null`. */
export async function assertGlobalScopeNamesEachChildsParent(client: pg.PoolClient): Promise<void> {
  const tree = await seedTree(client);
  const { items } = await service(client).locationKpis({
    locationIds: [...tree.ids],
    assetIds: null,
    partial: false,
    parentIdByLocation: await globalParentMap(client),
  });
  const cards = byId(items);
  assert(items.length === 3, `expected the parent and both children, got ${items.length} item(s)`);
  for (const child of tree.children) {
    const got = cards.get(child.locationId)?.parentId;
    assert(got === tree.parent.locationId, `child ${child.locationId}: parentId = ${String(got)}, expected the parent ${tree.parent.locationId}`);
  }
  const root = cards.get(tree.parent.locationId)?.parentId;
  assert(root === null, `the parent is a root: parentId = ${String(root)}, expected null`);
}

/**
 * P2 — a location grant on one child only: the parent is outside the caller's scope, so the
 * child's `parentId` is `null` and the parent's id appears nowhere in the response (ADR 0139
 * *Security*: "the new contract field leaks no id").
 */
export async function assertALocationGrantHidesAnUnreadableParent(client: pg.PoolClient): Promise<void> {
  const tree = await seedTree(client);
  const [granted] = tree.children;
  const tag = randomUUID().slice(0, 8);
  const user = await client.query<{ id: string }>(
    `INSERT INTO bms.users (organization_id, email, password_hash, display_name, role)
     VALUES ($1, $2, 'not-a-usable-hash', 'F4.240 grantee', 'location_admin') RETURNING id`,
    [tree.parent.organizationId, `f4240-grantee-${tag}@integration.invalid`],
  );
  const userId = user.rows[0]?.id;
  assert(userId !== undefined, "failed to insert the F4.240 grantee");
  await client.query(`INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)`, [
    userId,
    granted.locationId,
  ]);

  const scope = await scopeFromSource(
    createDb(client as unknown as pg.Pool),
    { id: userId as string, role: "location_admin" },
    "location",
  );
  const scopeIds = scope.locations.map((location) => location.id);
  assert(
    scopeIds.length === 1 && scopeIds[0] === granted.locationId,
    `the grantee's scope must be exactly the granted child, got ${JSON.stringify(scopeIds)}`,
  );
  // The controller's own arguments for a location scope.
  const { items } = await service(client).locationKpis({
    locationIds: scopeIds,
    assetIds: scope.assetIds,
    partial: false,
    parentIdByLocation: parentIdByLocation(scope),
  });
  assert(items.length === 1 && items[0]?.id === granted.locationId, `expected only the granted child, got ${JSON.stringify(items.map((i) => i.id))}`);
  assert(items[0]?.parentId === null, `the granted child's parentId = ${String(items[0]?.parentId)}, expected null (its parent is unreadable)`);
  const wire = JSON.stringify(items);
  assert(!wire.includes(tree.parent.locationId), `the response carries the unreadable parent's id ${tree.parent.locationId}: ${wire}`);
}

/** P3 — the detail route: `locationDashboard` narrows `locationIds` to the one location and still names its parent. */
export async function assertTheLocationDashboardNamesTheParent(client: pg.PoolClient): Promise<void> {
  const tree = await seedTree(client);
  const [child] = tree.children;
  const payload = await service(client).locationDashboard(child.locationId, {
    locationIds: null,
    assetIds: null,
    partial: false,
    parentIdByLocation: await globalParentMap(client),
  });
  assert(payload !== null, "the child's location dashboard must resolve");
  assert(
    payload?.parentId === tree.parent.locationId,
    `locationDashboard(child).parentId = ${String(payload?.parentId)}, expected the parent ${tree.parent.locationId}`,
  );
}

/** P4 — fail closed: `locationKpis` with no map writes `null` on every item, the child's included. */
export async function assertNoMapIsNullEverywhere(client: pg.PoolClient): Promise<void> {
  const tree = await seedTree(client);
  const { items } = await service(client).locationKpis({ locationIds: [...tree.ids], assetIds: null });
  assert(items.length === 3, `expected three items, got ${items.length}`);
  const notNull = items.filter((item) => item.parentId !== null);
  assert(notNull.length === 0, `with no map every parentId must be null, got ${notNull.map((i) => `${i.id}=${String(i.parentId)}`).join(", ")}`);
}

/**
 * P5 — a pin for ADR 0139 decision 16: the estate's `sitesTotal` counts the distinct location of
 * an in-scope asset, so an asset-less parent over two children reads 2, not 3. No code changes
 * for it (plan section 2.4); this fails if the count ever starts counting locations.
 */
export async function assertSitesTotalSkipsAnAssetlessParent(client: pg.PoolClient): Promise<void> {
  const tree = await seedTree(client);
  const kpis = await service(client).kpis([...tree.childAssets]);
  assert(kpis.sitesTotal === 2, `kpis(child assets).sitesTotal = ${kpis.sitesTotal}, expected 2 (the parent holds no asset)`);
}
