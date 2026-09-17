import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import type { BmsDb } from "@bms/db";
// `@bms/shared`, not `@bms/shared/contracts`: apps/api compiles with
// moduleResolution "node" and ignores the exports map (ADR 0030 Amendment 2).
import { adminAssetPointDtoSchema } from "@bms/shared";

import { AssetPointsAdminService } from "../admin/asset-points/asset-points.service";
import type { MasterDataAuditService } from "../admin/master-data-audit.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { AccessControlService } from "../auth/access-control.service";
import { AssetsService } from "./assets.service";

/**
 * `F3.63` (ADR 0047 Amendment 6 §Q1 point 3) — `AssetsService.listPoints`
 * against the seeded `asset_group_admin`, with **every expectation computed
 * by independent SQL through the pool**, never read back from the service.
 * Assertions live here; `asset-points-read.integration.test.ts` owns the
 * database lifecycle (§4.6/ADR 0014).
 *
 * Read-only against seed data: nothing here writes, so no rollback is needed.
 *
 * The one case that is not about the new read is the positive control that
 * the master-data gate did not move: `AssetPointsAdminService.list` still
 * refuses the role. Without it, "the role can read points" would be true of a
 * widened admin route as much as of the new one, and Amendment 6 opens the
 * read **beside** the master-data boundary, not through it.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export type Pools = { pool: pg.Pool; authDb: BmsDb; fleetDb: BmsDb };

function services({ authDb, fleetDb }: Pools) {
  const access = new AccessControlService(authDb, fleetDb);
  return { access, assets: new AssetsService(fleetDb) };
}

/**
 * One asset in a group the seeded `asset_group_admin` holds, with at least one
 * active point — the fixture every case below reads. `ORDER BY a.code` so the
 * pick is stable across runs.
 */
async function ownAssetId(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT a.id FROM bms.assets a
       JOIN bms.asset_group_members agm ON agm.asset_id = a.id
       JOIN bms.user_asset_group_access uaga ON uaga.asset_group_id = agm.asset_group_id
       JOIN bms.users u ON u.id = uaga.user_id
      WHERE u.email = $1
        AND EXISTS (SELECT 1 FROM bms.asset_points p WHERE p.asset_id = a.id AND p.active)
      ORDER BY a.code
      LIMIT 1`,
    [SEEDED.assetGroupAdmin],
  );
  const id = rows[0]?.id;
  assert(id !== undefined, `no asset with an active point in any group of ${SEEDED.assetGroupAdmin} — run pnpm db:seed`);
  return id;
}

async function countPoints(pool: pg.Pool, assetId: string, active: boolean): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms.asset_points WHERE asset_id = $1 AND active = $2`,
    [assetId, active],
  );
  return Number(rows[0]?.n ?? 0);
}

/** The guard admits the role on its own asset — the positive control for the refusal below. */
export async function assertRoleCanReadItsOwnAsset(pools: Pools): Promise<void> {
  const { access } = services(pools);
  const id = await ownAssetId(pools.pool);
  const allowed = await access.canReadAsset(jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin"), id);
  assert(allowed, `canReadAsset refused the role's own asset ${id}`);
}

/**
 * The read returns exactly the asset's active points. When the seed carries
 * no inactive point for the asset, the count cannot tell `active = true`
 * from no predicate; the case then holds the equality only, and says so.
 */
export async function assertListPointsReturnsTheActivePointsOfTheAsset(pools: Pools): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool);
  const expected = await countPoints(pools.pool, id, true);
  const inactive = await countPoints(pools.pool, id, false);
  const { items } = await assets.listPoints(id);
  assert(
    items.length === expected,
    `listPoints(${id}) returned ${items.length} items, SQL counts ${expected} active` +
      (inactive === 0 ? " (the seed has no inactive point on this asset, so the active predicate is not distinguished here)" : ""),
  );
}

export async function assertEveryItemBelongsToTheAsset(pools: Pools): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool);
  const { items } = await assets.listPoints(id);
  assert(items.length > 0, "the fixture asset must have at least one active point (SQL said so)");
  const foreign = items.filter((item) => item.assetId !== id);
  assert(foreign.length === 0, `listPoints(${id}) returned ${foreign.length} item(s) of another asset`);
}

export async function assertEveryItemParsesUnderTheAdminDto(pools: Pools): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool);
  const { items } = await assets.listPoints(id);
  assert(items.length > 0, "the fixture asset must have at least one active point (SQL said so)");
  for (const item of items) {
    const parsed = adminAssetPointDtoSchema.safeParse(item);
    assert(parsed.success, `item ${item.id} fails adminAssetPointDtoSchema: ${parsed.success ? "" : parsed.error.message}`);
  }
}

/** An asset of the same organization that is in none of the role's groups: the guard says no. */
export async function assertRoleCannotReadAnAssetOutsideItsGroups(pools: Pools): Promise<void> {
  const { access } = services(pools);
  const { rows } = await pools.pool.query<{ id: string }>(
    `SELECT a.id FROM bms.assets a
       JOIN bms.locations l ON l.id = a.location_id
       JOIN bms.organizations o ON o.id = l.organization_id
      WHERE o.code = 'ESKOM'
        AND NOT EXISTS (
          SELECT 1 FROM bms.asset_group_members agm
            JOIN bms.user_asset_group_access uaga ON uaga.asset_group_id = agm.asset_group_id
            JOIN bms.users u ON u.id = uaga.user_id
           WHERE agm.asset_id = a.id AND u.email = $1)
      ORDER BY a.code
      LIMIT 1`,
    [SEEDED.assetGroupAdmin],
  );
  const outside = rows[0]?.id;
  assert(outside !== undefined, "no ESKOM asset outside the role's groups — the fixture cannot prove a refusal");
  const allowed = await access.canReadAsset(jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin"), outside);
  assert(!allowed, `canReadAsset admitted ${outside}, which is in none of the role's groups`);
}

/** An unknown id is the service's 404, reached by any caller the guard admits. */
export async function assertUnknownAssetIsNotFound(pools: Pools): Promise<void> {
  const { assets } = services(pools);
  let caught: unknown;
  try {
    await assets.listPoints(randomUUID());
  } catch (err) {
    caught = err;
  }
  assert(
    caught instanceof NotFoundException,
    `listPoints on an unknown id: expected NotFoundException, got ${caught instanceof Error ? caught.name : String(caught)}`,
  );
}

/**
 * The positive control that the master-data gate did not move: the admin list
 * still refuses `asset_group_admin` on the very asset the new read serves.
 * Only `ForbiddenException` **with the master-data message** counts: a
 * dropped connection or a TypeError would otherwise score as "correctly
 * denied", and so would `canManageAsset`'s scope refusal — the admin list has
 * three guards of one class, and a widened `isMasterDataRole` still reaches
 * the third. `list` throws before any tenant read, so the tenant handle and
 * the audit service are never touched.
 */
export async function assertAdminListStillRefusesTheRole(pools: Pools): Promise<void> {
  const { access } = services(pools);
  const admin = new AssetPointsAdminService(pools.fleetDb, pools.fleetDb, access, {} as unknown as MasterDataAuditService);
  const id = await ownAssetId(pools.pool);
  let caught: unknown;
  try {
    await admin.list(jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin"), id);
  } catch (err) {
    caught = err;
  }
  const described = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught ?? "a success");
  assert(
    caught instanceof ForbiddenException && caught.message.startsWith("Master data administration requires"),
    `admin list for the role: expected the master-data ForbiddenException, got ${described}`,
  );
}

/**
 * `mapAssetPointRow` is the admin service's own projection: the admin list
 * for the same asset, active only, deep-equals the new read. This is what
 * makes the extraction safe — a field that diverges in either read reddens.
 */
export async function assertListPointsEqualsTheAdminProjection(pools: Pools): Promise<void> {
  const { access, assets } = services(pools);
  const admin = new AssetPointsAdminService(pools.fleetDb, pools.fleetDb, access, {} as unknown as MasterDataAuditService);
  const id = await ownAssetId(pools.pool);
  const { items: adminItems } = await admin.list(jwtFor(SEEDED.globalAdmin, "admin"), id, undefined, true);
  const { items } = await assets.listPoints(id);
  assert(adminItems.length > 0, "the admin list must return the fixture asset's points (SQL said it has some)");
  const left = JSON.stringify(adminItems);
  const right = JSON.stringify(items);
  assert(left === right, `listPoints diverges from the admin projection:\n admin: ${left}\n read:  ${right}`);
}
