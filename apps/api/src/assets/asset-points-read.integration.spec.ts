import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import type { BmsDb } from "@bms/db";
// `@bms/shared`, not `@bms/shared/contracts`: apps/api compiles with
// moduleResolution "node" and ignores the exports map (ADR 0030 Amendment 2).
import { assetPointPickerRowSchema } from "@bms/shared";

import { pickAssetPointPickerRow } from "../admin/asset-points/asset-point-row";
import { AssetPointsAdminService } from "../admin/asset-points/asset-points.service";
import { AssetGroupsAdminService } from "../admin/asset-groups/asset-groups.service";
import { LocationsAdminService } from "../admin/locations/locations.service";
import type { MasterDataAuditService } from "../admin/master-data-audit.service";
import type { VocabulariesService } from "../vocabularies/vocabularies.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { AccessControlService } from "../auth/access-control.service";
import { registerFixturePointKeys, resolveSeededAssetByCode } from "../testing/integration-fixtures";
import { AssetsService } from "./assets.service";

/**
 * `F3.63` (ADR 0047 Amendment 6 §Q1 point 3) — `AssetsService.listPoints`
 * against the seeded `asset_group_admin`, with **every expectation computed
 * by independent SQL through the pool**, never read back from the service.
 * Assertions live here; `asset-points-read.integration.test.ts` owns the
 * database lifecycle (§4.6/ADR 0014).
 *
 * Read-only against seed data, with one exception:
 * {@link assertListPointsReturnsTheActivePointsOfTheAsset} commits one
 * inactive point when the seed has none, and deletes it in `finally` — the
 * service reads on the same `pg.Pool`, so a rollback cannot isolate it.
 *
 * Three cases are not about the new read but are the positive controls that
 * the master-data gate did not move: `AssetPointsAdminService.list`,
 * `LocationsAdminService.list` and `AssetGroupsAdminService.list` still refuse
 * the role. Without them, "the role can read points" would be true of a
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

/** The audit service is never reached: every admin `list` below throws before its first read. */
const NO_AUDIT = {} as unknown as MasterDataAuditService;

/**
 * The fixture asset every case below reads — a member of the seeded `hvac`
 * group `wc-hvac-admin@bms.local` holds (`packages/db/src/demo-users-seed.ts`,
 * `asset-groups-seed.spec.ts`), with two active points in the seed. **Named,
 * not positional** (`tests/integration-fixture-isolation.test.ts`): an
 * `ORDER BY … LIMIT 1` over `bms.assets` returns whatever sorts first, which
 * is another suite's committed fixture as often as it is the seed. A seed
 * rename makes `resolveSeededAssetByCode` fail by name; rename this constant
 * to match, never widen it back to a positional read.
 */
const FIXTURE_ASSET_CODE = "CR-HVAC-1";

/**
 * Resolves {@link FIXTURE_ASSET_CODE} and holds the control that it IS in one
 * of the role's groups — by the grant tables, keyed on the resolved id, not by
 * position and not by reading `bms.assets` again. Without this control a seed
 * change that moved the asset out of the group would turn every "the role can
 * read its own asset" case below into a test of nothing.
 */
async function ownAssetId(pool: pg.Pool): Promise<string> {
  const id = await resolveSeededAssetByCode(pool, FIXTURE_ASSET_CODE);
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM bms.asset_group_members agm
       JOIN bms.user_asset_group_access uaga ON uaga.asset_group_id = agm.asset_group_id
       JOIN bms.users u ON u.id = uaga.user_id
      WHERE agm.asset_id = $1 AND u.email = $2`,
    [id, SEEDED.assetGroupAdmin],
  );
  assert(
    Number(rows[0]?.n ?? 0) > 0,
    `${FIXTURE_ASSET_CODE} (${id}) is in no group of ${SEEDED.assetGroupAdmin} — the seed moved; pick another member`,
  );
  const active = await countPoints(pool, id, true);
  assert(active > 0, `${FIXTURE_ASSET_CODE} has no active point in the seed — run pnpm db:seed`);
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
 * The read returns exactly the asset's active points — and an inactive point
 * is NOT among them. The seed carries no inactive point on the fixture asset,
 * so with the count alone `active = true` and no predicate are the same number
 * (review: mutation M9 survived). When the SQL count of inactive points is 0
 * the case commits one inactive point with a per-run `point_key`, asserts
 * against it, and deletes it in `finally` whatever happened. Committed rather
 * than rolled back because the service reads on the same pool: a row inside
 * an open transaction is invisible to the service's connection.
 */
export async function assertListPointsReturnsTheActivePointsOfTheAsset(pools: Pools): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool);
  const inactiveKey = `f363_inactive_${randomUUID()}`;
  const inactiveId = randomUUID();
  let unregisterKey: (() => Promise<void>) | undefined;
  let inserted = false;
  try {
    if ((await countPoints(pools.pool, id, false)) === 0) {
      // `asset_points.point_key` references `bms.point_keys(code)` (F3.39).
      unregisterKey = await registerFixturePointKeys(pools.pool, [inactiveKey]);
      await pools.pool.query(
        `INSERT INTO bms.asset_points (id, organization_id, asset_id, point_key, source_data_key, source_kind, active)
         SELECT $1::uuid, a.organization_id, a.id, $3::text, $3::text, 'unmapped', false
           FROM bms.assets a WHERE a.id = $2`,
        [inactiveId, id, inactiveKey],
      );
      inserted = true;
    }
    const activeCount = await countPoints(pools.pool, id, true);
    const inactiveCount = await countPoints(pools.pool, id, false);
    assert(inactiveCount > 0, `the fixture asset must have an inactive point for this case to distinguish the predicate`);
    const { items } = await assets.listPoints(id);
    assert(items.length === activeCount, `listPoints(${id}) returned ${items.length} items, SQL counts ${activeCount} active`);
    assert(
      !items.some((item) => item.pointKey === inactiveKey),
      `listPoints(${id}) returned the inactive point ${inactiveKey}`,
    );
  } finally {
    if (inserted) {
      await pools.pool.query(`DELETE FROM bms.asset_points WHERE id = $1`, [inactiveId]);
    }
    if (unregisterKey) {
      await unregisterKey();
    }
  }
}

export async function assertEveryItemBelongsToTheAsset(pools: Pools): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool);
  const { items } = await assets.listPoints(id);
  assert(items.length > 0, "the fixture asset must have at least one active point (SQL said so)");
  const foreign = items.filter((item) => item.assetId !== id);
  assert(foreign.length === 0, `listPoints(${id}) returned ${foreign.length} item(s) of another asset`);
}

/** Every item parses under the five-field picker schema — the positive control beside the key set. */
export async function assertEveryItemParsesUnderThePickerDto(pools: Pools): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool);
  const { items } = await assets.listPoints(id);
  assert(items.length > 0, "the fixture asset must have at least one active point (SQL said so)");
  for (const item of items) {
    const parsed = assetPointPickerRowSchema.safeParse(item);
    assert(parsed.success, `item ${item.id} fails assetPointPickerRowSchema: ${parsed.success ? "" : parsed.error.message}`);
  }
}

/**
 * The key set is EXACTLY the five picker fields (review, Security Medium): a
 * Zod parse admits extra keys, so `safeParse` above cannot see
 * `sourceDataKey` or `sensorCode` riding along. `Object.keys`, sorted, equal
 * — with `pointKey` named in the failure so a wrong key set reads as such.
 */
export async function assertNoItemCarriesAnAdminOnlyField(pools: Pools): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool);
  const { items } = await assets.listPoints(id);
  assert(items.length > 0, "the fixture asset must have at least one active point (SQL said so)");
  const expected = ["assetId", "assetName", "id", "pointKey", "unit"];
  for (const item of items) {
    const keys = Object.keys(item).sort();
    assert(keys.includes("pointKey"), `item ${item.id} has no pointKey — the positive control failed: ${keys.join(",")}`);
    assert(
      JSON.stringify(keys) === JSON.stringify(expected),
      `item ${item.id} carries keys [${keys.join(", ")}], expected exactly [${expected.join(", ")}]` +
        ` — sourceDataKey/sensorCode/scaling must not leave through the non-admin route`,
    );
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
 * The one shape every master-data refusal below takes. Only `ForbiddenException`
 * **with the master-data message** counts: a dropped connection or a TypeError
 * would otherwise score as "correctly denied", and so would a scope refusal —
 * each admin list has several guards of one class, and a widened
 * `isMasterDataRole` still reaches the later ones. The message is the pin.
 */
async function assertRefusedAsNotMasterData(label: string, run: () => Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    caught = err;
  }
  const described = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught ?? "a success");
  assert(
    caught instanceof ForbiddenException && caught.message.startsWith("Master data administration requires"),
    `${label} for the role: expected the master-data ForbiddenException, got ${described}`,
  );
}

/**
 * The positive control that the master-data gate did not move: the admin
 * point list still refuses `asset_group_admin` on the very asset the new read
 * serves. `list` throws before any tenant read, so the tenant handle and the
 * audit service are never touched.
 */
export async function assertAdminListStillRefusesTheRole(pools: Pools): Promise<void> {
  const { access } = services(pools);
  const admin = new AssetPointsAdminService(pools.fleetDb, pools.fleetDb, access, NO_AUDIT);
  const id = await ownAssetId(pools.pool);
  await assertRefusedAsNotMasterData("admin point list", () =>
    admin.list(jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin"), id),
  );
}

/** `GET /admin/locations` stays refused for the role (review, Security Low — pinned by message). */
export async function assertAdminLocationsListStillRefusesTheRole(pools: Pools): Promise<void> {
  const { access } = services(pools);
  const admin = new LocationsAdminService(pools.fleetDb, pools.fleetDb, access, NO_AUDIT);
  await assertRefusedAsNotMasterData("admin location list", () =>
    admin.list(jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin")),
  );
}

/** `GET /admin/asset-groups` stays refused for the role — the list Amendment 6 replaces with
 * `/auth/me`'s `scope.assetGroups` for it (review, Security Low — pinned by message). */
export async function assertAdminAssetGroupsListStillRefusesTheRole(pools: Pools): Promise<void> {
  const { access } = services(pools);
  const admin = new AssetGroupsAdminService(
    pools.fleetDb,
    pools.fleetDb,
    access,
    NO_AUDIT,
    {} as unknown as VocabulariesService,
  );
  await assertRefusedAsNotMasterData("admin asset-group list", () =>
    admin.list(jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin")),
  );
}

/**
 * `mapAssetPointRow` is the admin service's own projection: the admin list for
 * the same asset, active only, narrowed by `pickAssetPointPickerRow`,
 * deep-equals the new read. This is what makes the extraction safe — a picked
 * field that diverges in either read reddens. The unpicked fields are the
 * subject of {@link assertNoItemCarriesAnAdminOnlyField}.
 */
export async function assertListPointsEqualsTheAdminProjection(pools: Pools): Promise<void> {
  const { access, assets } = services(pools);
  const admin = new AssetPointsAdminService(pools.fleetDb, pools.fleetDb, access, NO_AUDIT);
  const id = await ownAssetId(pools.pool);
  const { items: adminItems } = await admin.list(jwtFor(SEEDED.globalAdmin, "admin"), id, undefined, true);
  const { items } = await assets.listPoints(id);
  assert(adminItems.length > 0, "the admin list must return the fixture asset's points (SQL said it has some)");
  const left = JSON.stringify(adminItems.map(pickAssetPointPickerRow));
  const right = JSON.stringify(items);
  assert(left === right, `listPoints diverges from the picked admin projection:\n admin: ${left}\n read:  ${right}`);
}

/**
 * The five picked values, read back from SQL — not from the admin projection.
 * {@link assertListPointsEqualsTheAdminProjection} applies the same pick to
 * both sides, so a wrong field INSIDE the pick (`assetName: dto.assetCode`)
 * is invisible to it, and the key-set case sees names, not values. This case
 * builds the expected rows from `bms.asset_points ⋈ bms.assets` and
 * deep-equals the read. Mutation: swap `assetName` for the code in
 * `pickAssetPointPickerRow` ⇒ red.
 */
export async function assertPickedValuesMatchSql(pools: Pools): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool);
  const { rows } = await pools.pool.query<{
    id: string;
    asset_id: string;
    asset_name: string;
    point_key: string;
    unit: string | null;
  }>(
    `SELECT p.id, p.asset_id, a.name AS asset_name, p.point_key, p.unit
       FROM bms.asset_points p JOIN bms.assets a ON a.id = p.asset_id
      WHERE p.asset_id = $1 AND p.active
      ORDER BY p.point_key`,
    [id],
  );
  assert(rows.length > 0, "the fixture asset has no active point in SQL");
  const expected = rows.map((row) => ({
    id: row.id,
    assetId: row.asset_id,
    assetName: row.asset_name,
    pointKey: row.point_key,
    unit: row.unit,
  }));
  const { items } = await assets.listPoints(id);
  const left = JSON.stringify(expected);
  const right = JSON.stringify(items);
  assert(left === right, `listPoints diverges from SQL:
 sql:  ${left}
 read: ${right}`);
}

/**
 * Amendment 6 — `organizationId` travels with each group in `/auth/me`'s
 * `scope.assetGroups`, and it is the GROUP's organization, read back from
 * `bms.asset_groups` by id. Moved here from `assertAssetGroupScope`
 * (`access-control.integration.spec.ts`, review), where it was the seventh
 * claim behind six throws of one `it()`. Mutation: map `organizationId:
 * row.locationId` in `scopeForUser`'s `asset_group` branch ⇒ red.
 */
export async function assertEveryScopeGroupCarriesItsOwnOrganizationId(pools: Pools): Promise<void> {
  const { access } = services(pools);
  const { scope } = await access.currentUser(jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin"));
  assert(scope.kind === "asset_group", `expected the asset_group scope, got ${scope.kind}`);
  assert(scope.assetGroups.length > 0, "the role holds no group — the fixture cannot prove the claim");
  for (const group of scope.assetGroups) {
    const { rows } = await pools.pool.query<{ organization_id: string }>(
      `SELECT organization_id FROM bms.asset_groups WHERE id = $1`,
      [group.id],
    );
    const stored = rows[0]?.organization_id;
    assert(stored !== undefined, `scope group ${group.id} has no bms.asset_groups row`);
    assert(
      group.organizationId === stored,
      `scope group ${group.id} (${group.code}) carries organizationId ${group.organizationId}, bms.asset_groups says ${stored}`,
    );
  }
}
