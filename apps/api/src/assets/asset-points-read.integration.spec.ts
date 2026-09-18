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
import { registerFixturePointKeys } from "../testing/integration-fixtures";
import { AssetsService } from "./assets.service";

/**
 * `F3.63` (ADR 0047 Amendment 6 §Q1 point 3) — `AssetsService.listPoints`
 * against the seeded `asset_group_admin`, with **every expectation computed
 * by independent SQL through the pool**, never read back from the service.
 * Assertions live here; `asset-points-read.integration.test.ts` owns the
 * database lifecycle (§4.6/ADR 0014).
 *
 * **The suite owns its fixture, and the fixture is committed.** An earlier
 * draft read the seeded `CR-HVAC-1` and wrote an inactive point onto it —
 * the row `access-control.asset-dashboard.integration.spec.ts` also claims,
 * which `tests/integration-fixture-sharing.test.ts` refuses: a seeded row has
 * no owner, so two suites that both name it have no protocol for who may
 * write to it. So {@link createFixture} commits, under a per-run `f363-`
 * prefix, two assets of its own at the location of the `hvac` group the role
 * holds: asset A, a member of that group with one active and one inactive
 * point, and asset B, at the same location and in no group at all. Nothing
 * here names a seeded asset, and nothing here writes a seeded row.
 *
 * Committed rather than `createFixtureAssets()` inside a rollback, because
 * `AssetsService` and `AccessControlService` read on their own pool: a row
 * inside this suite's open transaction is invisible to the connection the
 * service checks out. The insert runs on the gate's `bms_fleet` pool — the
 * pool the service itself reads on, and the one role with `BYPASSRLS`, so it
 * writes `bms.assets` (FORCEd `tenant_isolation`) without a tenant GUC. The
 * `A11` case of the sibling spec inserts on the same handle. Every row is
 * deleted by id in {@link dropFixture}, children first, with the counts
 * asserted so a leak is loud rather than the next suite's FK failure.
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

/** The rows this suite committed, and what it needs to delete them again. */
export interface Fixture {
  /** Asset A — a member of the role's `hvac` group; one active point, one inactive. */
  readonly assetAId: string;
  /** Asset B — same location, same organization, in no group. */
  readonly assetBId: string;
  readonly groupId: string;
  readonly organizationId: string;
  readonly activeKey: string;
  readonly inactiveKey: string;
  readonly pointIds: readonly string[];
  readonly membershipIds: readonly string[];
  readonly assetIds: readonly string[];
  readonly unregisterKeys?: () => Promise<void>;
}

/** The `hvac` group `wc-hvac-admin@bms.local` holds, resolved by email and code — never by position. */
async function roleGroup(pool: pg.Pool): Promise<{ id: string; locationId: string; organizationId: string }> {
  const { rows } = await pool.query<{ id: string; location_id: string; organization_id: string }>(
    `SELECT ag.id, ag.location_id, ag.organization_id
       FROM bms.asset_groups ag
       JOIN bms.user_asset_group_access uaga ON uaga.asset_group_id = ag.id
       JOIN bms.users u ON u.id = uaga.user_id
      WHERE u.email = $1 AND ag.code = 'hvac'`,
    [SEEDED.assetGroupAdmin],
  );
  assert(rows.length === 1, `${SEEDED.assetGroupAdmin} holds ${rows.length} group(s) coded hvac, expected exactly one — run pnpm db:seed`);
  const [row] = rows;
  assert(row.location_id !== null, "the hvac group has no location_id — the fixture assets need one");
  return { id: row.id, locationId: row.location_id, organizationId: row.organization_id };
}

/**
 * Commits the fixture on the fleet pool. A failure part-way drops whatever
 * landed and rethrows, so a broken `beforeAll` leaves no row behind either.
 */
export async function createFixture(pools: Pools): Promise<Fixture> {
  const { pool } = pools;
  const prefix = `f363-${randomUUID().slice(0, 8)}`;
  const partial = {
    pointIds: [] as string[],
    membershipIds: [] as string[],
    assetIds: [] as string[],
    unregisterKeys: undefined as (() => Promise<void>) | undefined,
  };
  try {
    const group = await roleGroup(pool);
    const activeKey = `${prefix}_active`;
    const inactiveKey = `${prefix}_inactive`;
    // `asset_points.point_key` references `bms.point_keys(code)` (F3.39).
    partial.unregisterKeys = await registerFixturePointKeys(pool, [activeKey, inactiveKey]);

    const insertAsset = async (suffix: string, name: string): Promise<string> => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
         VALUES ($1, $2, $3, $4, 'F3.63 point-read fixture', 'hvac')
         RETURNING id`,
        [group.organizationId, group.locationId, `${prefix}-${suffix}`, name],
      );
      const id = rows[0]?.id;
      assert(id !== undefined, `INSERT of fixture asset ${prefix}-${suffix} returned no id`);
      partial.assetIds.push(id);
      return id;
    };
    const assetAId = await insertAsset("a", "F3.63 fixture asset A (in the hvac group)");
    const assetBId = await insertAsset("b", "F3.63 fixture asset B (in no group)");

    const { rows: members } = await pool.query<{ id: string }>(
      `INSERT INTO bms.asset_group_members (asset_group_id, asset_id) VALUES ($1, $2) RETURNING id`,
      [group.id, assetAId],
    );
    partial.membershipIds.push(...members.map((m) => m.id));

    // `unit` is a real string on the active point so the SQL-to-read value
    // comparison below is load-bearing on that field, not NULL against NULL.
    const { rows: points } = await pool.query<{ id: string }>(
      `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, source_kind, unit, active)
       VALUES ($1, $2, $3, $3, 'unmapped', 'kW', true),
              ($1, $2, $4, $4, 'unmapped', NULL, false)
       RETURNING id`,
      [group.organizationId, assetAId, activeKey, inactiveKey],
    );
    partial.pointIds.push(...points.map((p) => p.id));
    assert(partial.pointIds.length === 2, `expected 2 fixture points, inserted ${partial.pointIds.length}`);

    return {
      assetAId,
      assetBId,
      groupId: group.id,
      organizationId: group.organizationId,
      activeKey,
      inactiveKey,
      pointIds: partial.pointIds,
      membershipIds: partial.membershipIds,
      assetIds: partial.assetIds,
      unregisterKeys: partial.unregisterKeys,
    };
  } catch (err) {
    await dropFixture(pools, { ...partial, assetAId: "", assetBId: "", groupId: "", organizationId: "", activeKey: "", inactiveKey: "" }).catch(
      () => undefined,
    );
    throw err;
  }
}

/**
 * Deletes what {@link createFixture} committed — children before parents,
 * point keys last (`asset_points.point_key` references them) — and asserts
 * each count, so a row that went missing or a row left behind both fail here
 * rather than in another suite's FK.
 */
export async function dropFixture(pools: Pools, fx: Fixture): Promise<void> {
  const { pool } = pools;
  // Every delete runs before any count is judged: a short count on the first
  // table must not leave the two below it in place (a leaked fixture breaks
  // another suite's cleanup on an FK), and the message must name the count,
  // not the FK error the key unregistration would then hit.
  const short: string[] = [];
  const deleteAll = async (table: string, ids: readonly string[]): Promise<void> => {
    if (ids.length === 0) {
      return;
    }
    const { rowCount } = await pool.query(`DELETE FROM bms.${table} WHERE id = ANY($1::uuid[])`, [ids]);
    if (rowCount !== ids.length) {
      short.push(`bms.${table}: deleted ${String(rowCount)} fixture row(s), expected ${ids.length}`);
    }
  };
  try {
    await deleteAll("asset_points", fx.pointIds);
    await deleteAll("asset_group_members", fx.membershipIds);
    await deleteAll("assets", fx.assetIds);
  } finally {
    if (fx.unregisterKeys) {
      await fx.unregisterKeys();
    }
  }
  assert(short.length === 0, short.join("\n"));
}

/**
 * The control that asset A IS in one of the role's groups — by the grant
 * tables, keyed on A's id by SQL, not by trusting the insert. Without it, a
 * membership insert that landed on the wrong group would turn every "the role
 * can read its own asset" case below into a test of nothing.
 */
async function ownAssetId(pool: pg.Pool, fx: Fixture): Promise<string> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM bms.asset_group_members agm
       JOIN bms.user_asset_group_access uaga ON uaga.asset_group_id = agm.asset_group_id
       JOIN bms.users u ON u.id = uaga.user_id
      WHERE agm.asset_id = $1 AND u.email = $2`,
    [fx.assetAId, SEEDED.assetGroupAdmin],
  );
  assert(Number(rows[0]?.n ?? 0) > 0, `fixture asset A (${fx.assetAId}) is in no group of ${SEEDED.assetGroupAdmin}`);
  return fx.assetAId;
}

async function countPoints(pool: pg.Pool, assetId: string, active: boolean): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms.asset_points WHERE asset_id = $1 AND active = $2`,
    [assetId, active],
  );
  return Number(rows[0]?.n ?? 0);
}

/** The guard admits the role on its own asset — the positive control for the refusal below. */
export async function assertRoleCanReadItsOwnAsset(pools: Pools, fx: Fixture): Promise<void> {
  const { access } = services(pools);
  const id = await ownAssetId(pools.pool, fx);
  const allowed = await access.canReadAsset(jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin"), id);
  assert(allowed, `canReadAsset refused the role's own asset ${id}`);
}

/**
 * The read returns exactly the asset's active points — and the committed
 * inactive point is NOT among them. With the count alone `active = true` and
 * no predicate are the same number on an asset with no inactive row (review:
 * mutation M9 survived), which is why the fixture carries one. The absence
 * claim comes first so the failure names the predicate, then the exact count.
 * Mutation: drop `eq(assetPoints.active, true)` in `listPoints` ⇒ red.
 */
export async function assertListPointsReturnsTheActivePointsOfTheAsset(pools: Pools, fx: Fixture): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool, fx);
  assert((await countPoints(pools.pool, id, false)) === 1, "fixture asset A must carry exactly one inactive point");
  assert((await countPoints(pools.pool, id, true)) === 1, "fixture asset A must carry exactly one active point");
  const { items } = await assets.listPoints(id);
  assert(
    !items.some((item) => item.pointKey === fx.inactiveKey),
    `listPoints(${id}) returned the inactive point ${fx.inactiveKey}`,
  );
  assert(items.length === 1, `listPoints(${id}) returned ${items.length} items, SQL counts 1 active`);
  assert(items[0]?.pointKey === fx.activeKey, `listPoints(${id}) returned ${String(items[0]?.pointKey)}, expected ${fx.activeKey}`);
}

export async function assertEveryItemBelongsToTheAsset(pools: Pools, fx: Fixture): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool, fx);
  const { items } = await assets.listPoints(id);
  assert(items.length > 0, "the fixture asset must have at least one active point");
  const foreign = items.filter((item) => item.assetId !== id);
  assert(foreign.length === 0, `listPoints(${id}) returned ${foreign.length} item(s) of another asset`);
}

/** Every item parses under the five-field picker schema — the positive control beside the key set. */
export async function assertEveryItemParsesUnderThePickerDto(pools: Pools, fx: Fixture): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool, fx);
  const { items } = await assets.listPoints(id);
  assert(items.length > 0, "the fixture asset must have at least one active point");
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
export async function assertNoItemCarriesAnAdminOnlyField(pools: Pools, fx: Fixture): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool, fx);
  const { items } = await assets.listPoints(id);
  assert(items.length > 0, "the fixture asset must have at least one active point");
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

/**
 * Asset B — same location and organization as A, in no group: the guard says
 * no. The positive control on A runs first, so a broken fixture reads as a
 * failed control rather than as a proved refusal. B's absence from every
 * group of the role is asserted by SQL, not assumed from the insert.
 */
export async function assertRoleCannotReadAnAssetOutsideItsGroups(pools: Pools, fx: Fixture): Promise<void> {
  const { access } = services(pools);
  const own = await ownAssetId(pools.pool, fx);
  const jwt = jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin");
  assert(await access.canReadAsset(jwt, own), `positive control: canReadAsset refused the role's own asset ${own}`);
  const { rows } = await pools.pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM bms.asset_group_members agm
       JOIN bms.user_asset_group_access uaga ON uaga.asset_group_id = agm.asset_group_id
       JOIN bms.users u ON u.id = uaga.user_id
      WHERE agm.asset_id = $1 AND u.email = $2`,
    [fx.assetBId, SEEDED.assetGroupAdmin],
  );
  assert(Number(rows[0]?.n ?? 0) === 0, `fixture asset B (${fx.assetBId}) is in a group of ${SEEDED.assetGroupAdmin} — the fixture cannot prove a refusal`);
  const allowed = await access.canReadAsset(jwt, fx.assetBId);
  assert(!allowed, `canReadAsset admitted ${fx.assetBId}, which is in none of the role's groups`);
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
export async function assertAdminListStillRefusesTheRole(pools: Pools, fx: Fixture): Promise<void> {
  const { access } = services(pools);
  const admin = new AssetPointsAdminService(pools.fleetDb, pools.fleetDb, access, NO_AUDIT);
  const id = await ownAssetId(pools.pool, fx);
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
export async function assertListPointsEqualsTheAdminProjection(pools: Pools, fx: Fixture): Promise<void> {
  const { access, assets } = services(pools);
  const admin = new AssetPointsAdminService(pools.fleetDb, pools.fleetDb, access, NO_AUDIT);
  const id = await ownAssetId(pools.pool, fx);
  const { items: adminItems } = await admin.list(jwtFor(SEEDED.globalAdmin, "admin"), id, undefined, true);
  const { items } = await assets.listPoints(id);
  assert(adminItems.length > 0, "the admin list must return the fixture asset's points");
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
export async function assertPickedValuesMatchSql(pools: Pools, fx: Fixture): Promise<void> {
  const { assets } = services(pools);
  const id = await ownAssetId(pools.pool, fx);
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
