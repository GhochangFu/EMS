import { randomUUID } from "node:crypto";

import { asc, eq, ne, sql } from "drizzle-orm";

import { alarms, assetGroupMembers, assetGroups, assetRoles, assets, locations } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { assetRoleSummaryResponseSchema } from "@bms/shared";
import type { AssetRoleSummaryItem, AssetRoleSummaryResponse } from "@bms/shared";

import { intersectReadable } from "../auth/asset-scope";
import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";
import type { FixtureLocation } from "../testing/integration-fixtures";
import { withRollback } from "../testing/with-rollback";
import { AssetRoleSummaryService } from "./asset-role-summary.service";

/**
 * `F3.28` (ADR 0074, plan task 3.2) — `AssetRoleSummaryService.summarize`
 * against a real database. Assertions live here; the sibling `.test.ts` is
 * the Vitest entry point (ADR 0014) and owns the pool.
 *
 * **Rollback-isolated.** Every case builds its whole scene inside one
 * `withRollback` transaction and ends with `tx.rollback()`, so nothing it
 * writes survives — assets (`createFixtureAssets`), groups, memberships,
 * three prefixed roles in the global `bms.asset_roles`, alarms and samples.
 * The service is constructed over that transaction for both pools, so its
 * `withReadScope` / `withTenant` transactions nest as savepoints and read the
 * uncommitted scene, and `now()` is the transaction's start time in the
 * fixture inserts and in the service alike — the 27 s sample is 27 s old to
 * the query, not "27 s plus however long the run took".
 *
 * The connection is `bms_fleet` (`BYPASSRLS`), so on this path the `inArray`
 * scope predicate on `members` is the only thing that keeps the foreign
 * organization's asset out — which is what the foreign-asset case measures.
 *
 * **The scene** (roles ordered by `sort_order` 1, 2, 3 with codes in the
 * reverse order, so an ORDER BY on `code` alone would flip them):
 *
 * | asset   | memberships                          | active alarms       | samples          |
 * |---------|--------------------------------------|---------------------|------------------|
 * | own[0]  | `roleA` in g1 and g2, `roleB` in g3   | warning, critical   | two, 1 s and 2 s |
 * | own[1]  | `roleA` in g1                         | warning             | one, 27 s        |
 * | own[2]  | `roleR` (retired) in g1               | info (+ cleared critical) | none       |
 * | own[3]  | g1, no role                           | critical            | one, 1 s         |
 * | foreign | `roleA` in a foreign-org group        | critical            | one, 1 s         |
 *
 * Every case above reads with `groups = null` (unrestricted). The security-L1
 * group cases, the inactive-asset cases and the quiet-role cases add their own
 * rows and roles **inside their own case**, after `buildScene`, so the shared
 * scene (and the exact role list `assertOnlyHeldRolesInSortOrder` pins) is
 * unchanged, and each mutation reddens only the case that owns its claim.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

interface Scene {
  readonly tx: Tx;
  readonly run: string;
  readonly location: FixtureLocation;
  readonly groups: { readonly g1: string; readonly g2: string; readonly g3: string };
  readonly own: readonly string[];
  readonly foreign: string;
  readonly roleA: string;
  readonly roleB: string;
  readonly roleR: string;
  readonly service: AssetRoleSummaryService;
}

type Tx = Parameters<Parameters<BmsDb["transaction"]>[0]>[0];

async function buildScene(tx: Tx): Promise<Scene> {
  const txDb = tx as unknown as BmsDb;
  const run = randomUUID().replace(/-/g, "").slice(0, 12);
  const location = await fixtureLocation(txDb);
  const [foreignLocation] = await tx
    .select({ id: locations.id, organizationId: locations.organizationId })
    .from(locations)
    .where(ne(locations.organizationId, location.organizationId))
    // F4.53: the oldest row, so a transient location another suite commits is never adopted.
    .orderBy(asc(locations.createdAt), asc(locations.id))
    .limit(1);
  assert(foreignLocation !== undefined, "control: the seed holds a location in a second organization");
  const foreignOrg = foreignLocation?.organizationId as string;

  const own = await createFixtureAssets(txDb, 4, "F328RS", location);
  const [foreign] = await createFixtureAssets(txDb, 1, "F328RS", {
    locationId: foreignLocation?.id as string,
    organizationId: foreignOrg,
  });
  assert(own.length === 4 && foreign !== undefined, "createFixtureAssets returns the requested ids");

  // Codes sort c < b < a in reverse of sort_order 1, 2, 3.
  const roleA = `F328RS-${run}-c`;
  const roleB = `F328RS-${run}-b`;
  const roleR = `F328RS-${run}-a`;
  await tx.insert(assetRoles).values([
    { code: roleA, label: `F328RS ${run} MCCs`, sortOrder: 1, active: true },
    { code: roleB, label: `F328RS ${run} Chillers`, sortOrder: 2, active: true },
    { code: roleR, label: `F328RS ${run} Retired`, sortOrder: 3, active: false },
  ]);

  const groups = await tx
    .insert(assetGroups)
    .values([
      ...[1, 2, 3].map((i) => ({
        organizationId: location.organizationId,
        locationId: location.locationId,
        code: `F328RS-${run}-G${i}`,
        name: `F328RS ${run} group ${i}`,
      })),
      {
        organizationId: foreignOrg,
        locationId: foreignLocation?.id as string,
        code: `F328RS-${run}-GF`,
        name: `F328RS ${run} foreign group`,
      },
    ])
    .returning({ id: assetGroups.id });
  const [g1, g2, g3, gF] = groups.map((g) => g.id) as [string, string, string, string];
  const [a0, a1, a2, a3] = own as [string, string, string, string];

  await tx.insert(assetGroupMembers).values([
    { assetGroupId: g1, assetId: a0, role: roleA },
    { assetGroupId: g2, assetId: a0, role: roleA },
    { assetGroupId: g3, assetId: a0, role: roleB },
    { assetGroupId: g1, assetId: a1, role: roleA },
    { assetGroupId: g1, assetId: a2, role: roleR },
    { assetGroupId: g1, assetId: a3, role: null },
    { assetGroupId: gF, assetId: foreign as string, role: roleA },
  ]);

  const org = location.organizationId;
  await tx.insert(alarms).values([
    { organizationId: org, assetId: a0, severity: "warning", message: `F328RS ${run} a0 warning` },
    { organizationId: org, assetId: a0, severity: "critical", message: `F328RS ${run} a0 critical` },
    { organizationId: org, assetId: a1, severity: "warning", message: `F328RS ${run} a1 warning` },
    { organizationId: org, assetId: a2, severity: "info", message: `F328RS ${run} a2 info` },
    {
      organizationId: org,
      assetId: a2,
      severity: "critical",
      message: `F328RS ${run} a2 cleared critical`,
      clearedAt: sql`now()`,
    },
    { organizationId: org, assetId: a3, severity: "critical", message: `F328RS ${run} a3 critical` },
    { organizationId: foreignOrg, assetId: foreign as string, severity: "critical", message: `F328RS ${run} foreign` },
  ]);

  // Relative to the transaction's now(), which the service's query shares.
  await tx.execute(sql`
    INSERT INTO telemetry.point_values (time, asset_id, point_key, value) VALUES
      (now() - make_interval(secs => 1), ${a0}, 'kw', 1),
      (now() - make_interval(secs => 2), ${a0}, 'kw', 1),
      (now() - make_interval(secs => 27), ${a1}, 'kw', 1),
      (now() - make_interval(secs => 1), ${a3}, 'kw', 1),
      (now() - make_interval(secs => 1), ${foreign as string}, 'kw', 1)
  `);

  return {
    tx,
    run,
    location,
    groups: { g1, g2, g3 },
    own,
    foreign: foreign as string,
    roleA,
    roleB,
    roleR,
    service: new AssetRoleSummaryService(txDb, txDb),
  };
}

/** The caller's scope as the controller builds it: the own assets readable, the foreign one requested too. */
async function summarizeAsCaller(scene: Scene): Promise<AssetRoleSummaryResponse> {
  return scene.service.summarize(intersectReadable(scene.own, [...scene.own, scene.foreign]), null);
}

function item(response: AssetRoleSummaryResponse, code: string): AssetRoleSummaryItem {
  const found = response.items.find((i) => i.code === code);
  assert(found !== undefined, `expected a row for role ${code}, got ${JSON.stringify(response.items)}`);
  return found as AssetRoleSummaryItem;
}

async function withScene(db: BmsDb, check: (scene: Scene) => Promise<void>): Promise<void> {
  await withRollback(db, async (tx) => {
    await check(await buildScene(tx));
    tx.rollback();
  });
}

/** An asset holding the same role in two groups counts once. */
export async function assertSameRoleInTwoGroupsCountsOnce(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const roleA = item(await summarizeAsCaller(scene), scene.roleA);
    assert(roleA.count === 2, `roleA holds own[0] (two groups) and own[1]: expected count 2, got ${roleA.count}`);
  });
}

/** An asset holding two roles counts under each. */
export async function assertTwoRolesCountUnderEach(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const roleB = item(await summarizeAsCaller(scene), scene.roleB);
    assert(roleB.count === 1, `own[0] also holds roleB: expected count 1, got ${roleB.count}`);
  });
}

/** The worst severity is the highest rank, not the highest code — `warning` sorts after `critical`. */
export async function assertWorstIsByRank(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const roleA = item(await summarizeAsCaller(scene), scene.roleA);
    assert(
      roleA.worstSeverity?.code === "critical",
      `roleA's worst active severity must be critical, got ${JSON.stringify(roleA.worstSeverity)}`,
    );
  });
}

/** `worstCount` counts only the assets at the worst severity (OQ4): own[0] critical, own[1] warning. */
export async function assertWorstCountIsAssetsAtTheWorst(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const roleA = item(await summarizeAsCaller(scene), scene.roleA);
    assert(roleA.worstCount === 1, `roleA has one asset at critical: expected worstCount 1, got ${roleA.worstCount}`);
  });
}

/** A cleared alarm is not active: own[2]'s cleared critical must not outrank its active info. */
export async function assertClearedAlarmDoesNotCount(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const roleR = item(await summarizeAsCaller(scene), scene.roleR);
    assert(
      roleR.worstSeverity?.code === "info",
      `a cleared critical must not count: expected info, got ${JSON.stringify(roleR.worstSeverity)}`,
    );
  });
}

/** own[1]'s newest sample is 27 s old — past the 25 s bound — so roleA has one offline asset. */
export async function assertOfflineCountIsOne(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const roleA = item(await summarizeAsCaller(scene), scene.roleA);
    assert(roleA.offlineCount === 1, `roleA: expected offlineCount 1, got ${roleA.offlineCount}`);
  });
}

/** A retired role that an asset still holds is included (plan decision 7). */
export async function assertRetiredRoleIsIncluded(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const roleR = item(await summarizeAsCaller(scene), scene.roleR);
    assert(roleR.count === 1, `the retired role holds own[2]: expected count 1, got ${roleR.count}`);
  });
}

/** Exactly the three roles held in scope, in `sort_order` — own[3]'s role-less membership adds no row. */
export async function assertOnlyHeldRolesInSortOrder(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const codes = (await summarizeAsCaller(scene)).items.map((i) => i.code);
    assert(
      JSON.stringify(codes) === JSON.stringify([scene.roleA, scene.roleB, scene.roleR]),
      `expected [roleA, roleB, roleR] by sort_order, got ${JSON.stringify(codes)}`,
    );
  });
}

/** own[3] is role-less, live and critical: no role's count or worstCount includes it. */
export async function assertNoRoleAssetIsAbsent(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const response = await summarizeAsCaller(scene);
    const total = response.items.reduce((sum, i) => sum + i.count, 0);
    assert(total === 4, `roleA 2 + roleB 1 + roleR 1 = 4 memberships counted, got ${total}`);
  });
}

/**
 * The foreign asset — same role, critical, live — is dropped: requested, but
 * outside the readable set, so `intersectReadable` removes it and the scope
 * predicate keeps its membership out of the fleet-pool read.
 */
export async function assertForeignAssetIsDropped(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const roleA = item(await summarizeAsCaller(scene), scene.roleA);
    assert(
      roleA.count === 2 && roleA.worstCount === 1 && roleA.offlineCount === 1,
      `the foreign asset must not count in roleA: got ${JSON.stringify(roleA)}`,
    );
  });
}

/** An empty scope answers `{ items: [] }`; the own scope, in the same scene, does not (positive control). */
export async function assertEmptyScopeIsEmptyItems(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const control = await scene.service.summarize([...scene.own], null);
    assert(control.items.length > 0, "control: the own scope must return rows in this scene");
    const empty = await scene.service.summarize(intersectReadable(scene.own, [scene.foreign]), null);
    assert(
      JSON.stringify(empty) === JSON.stringify({ items: [] }),
      `an empty intersection must answer { items: [] }, got ${JSON.stringify(empty)}`,
    );
  });
}

/** The response parses under the shared contract (ADR 0030). */
export async function assertResponseMatchesTheContract(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const parsed = assetRoleSummaryResponseSchema.safeParse(await summarizeAsCaller(scene));
    assert(parsed.success, `the response must parse: ${parsed.success ? "" : parsed.error.message}`);
  });
}

// ---------------------------------------------------------------------------
// Security L1, code-review items 3 and 5 — each case adds its own rows
// ---------------------------------------------------------------------------

/** Inserts one active role, sorted after the scene's three, and returns its code. */
async function addRole(scene: Scene, suffix: string): Promise<string> {
  const code = `F328RS-${scene.run}-${suffix}`;
  await scene.tx
    .insert(assetRoles)
    .values({ code, label: `F328RS ${scene.run} ${suffix}`, sortOrder: 9, active: true });
  return code;
}

/** Adds a live (1 s old) sample for each asset. */
async function addLiveSamples(scene: Scene, assetIds: readonly string[]): Promise<void> {
  for (const assetId of assetIds) {
    await scene.tx.execute(sql`
      INSERT INTO telemetry.point_values (time, asset_id, point_key, value)
      VALUES (now() - make_interval(secs => 1), ${assetId}, 'kw', 1)
    `);
  }
}

/**
 * Security L1, group axis: own[0] holds roleA in g1 and g2 and roleB only in
 * g3. A caller who can read g1 and g2 but not g3 sees roleA (the positive
 * control: the same asset's readable membership) and no roleB row.
 */
export async function assertUnreadableGroupMembershipIsNotCounted(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const response = await scene.service.summarize([...scene.own], {
      groupIds: [scene.groups.g1, scene.groups.g2],
    });
    const roleA = item(response, scene.roleA);
    assert(roleA.count === 2, `control: roleA in readable g1/g2 must count own[0] and own[1], got ${roleA.count}`);
    const roleB = response.items.find((i) => i.code === scene.roleB);
    assert(
      roleB === undefined,
      `own[0] holds roleB only in g3, which the caller cannot read: expected no roleB row, got ${JSON.stringify(roleB)}`,
    );
  });
}

/**
 * Security L1, location axis: a location-scoped caller reads the groups sited
 * at its locations. A readable asset holding `roleL` only in a group sited at
 * a second location of the same organization is not counted under `roleL`;
 * its `roleA` membership in g1 (at the readable location) is (the control).
 */
export async function assertGroupAtUnreadableLocationIsNotCounted(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const { tx, run, location } = scene;
    const [otherLocation] = await tx
      .insert(locations)
      .values({
        organizationId: location.organizationId,
        code: `F328RS-${run}-L2`,
        slug: `f328rs-${run}-l2`,
        name: `F328RS ${run} second location`,
        type: "rsmoc",
        latitude: 0,
        longitude: 0,
      })
      .returning({ id: locations.id });
    const [gX] = await tx
      .insert(assetGroups)
      .values({
        organizationId: location.organizationId,
        locationId: otherLocation?.id as string,
        code: `F328RS-${run}-GX`,
        name: `F328RS ${run} group at the second location`,
      })
      .returning({ id: assetGroups.id });
    const [a4] = (await createFixtureAssets(tx as unknown as BmsDb, 1, "F328RS", location)) as [string];
    const roleL = await addRole(scene, "L");
    await tx.insert(assetGroupMembers).values([
      { assetGroupId: gX?.id as string, assetId: a4, role: roleL },
      { assetGroupId: scene.groups.g1, assetId: a4, role: scene.roleA },
    ]);

    const response = await scene.service.summarize([...scene.own, a4], {
      locationIds: [location.locationId],
    });
    const roleA = item(response, scene.roleA);
    assert(roleA.count === 3, `control: roleA in g1 must count own[0], own[1] and the new asset, got ${roleA.count}`);
    const row = response.items.find((i) => i.code === roleL);
    assert(
      row === undefined,
      `roleL is held only in a group at an unreadable location: expected no roleL row, got ${JSON.stringify(row)}`,
    );
  });
}

/**
 * Two assets under a new role in g1: one active and live, one inactive with
 * no sample. Returns the role's row — `item()` failing here means the active
 * sibling (the positive control) was not counted either.
 */
async function inactiveRow(scene: Scene): Promise<AssetRoleSummaryItem> {
  const [live, retired] = (await createFixtureAssets(
    scene.tx as unknown as BmsDb,
    2,
    "F328RS",
    scene.location,
  )) as [string, string];
  const [check] = await scene.tx
    .update(assets)
    .set({ active: false })
    .where(eq(assets.id, retired))
    .returning({ active: assets.active });
  assert(check?.active === false, "control: the retired asset is inactive");
  const roleI = await addRole(scene, "I");
  await scene.tx.insert(assetGroupMembers).values([
    { assetGroupId: scene.groups.g1, assetId: live, role: roleI },
    { assetGroupId: scene.groups.g1, assetId: retired, role: roleI },
  ]);
  await addLiveSamples(scene, [live]);
  return item(await scene.service.summarize([...scene.own, live, retired], null), roleI);
}

/** Code-review item 3: an inactive asset is absent from `count`; its active sibling is counted (control). */
export async function assertInactiveAssetIsNotCounted(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const roleI = await inactiveRow(scene);
    assert(roleI.count === 1, `only the active sibling counts: expected count 1, got ${roleI.count}`);
  });
}

/** Code-review item 3: an inactive asset with no sample is not offline; the live sibling keeps the row (control). */
export async function assertInactiveAssetIsNotOffline(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const roleI = await inactiveRow(scene);
    assert(
      roleI.offlineCount === 0,
      `the inactive asset must not count as offline: expected offlineCount 0, got ${roleI.offlineCount}`,
    );
  });
}

/** Code-review item 5: a role whose only asset is live with no active alarm. */
async function quietRow(scene: Scene): Promise<AssetRoleSummaryItem> {
  const [quiet] = (await createFixtureAssets(scene.tx as unknown as BmsDb, 1, "F328RS", scene.location)) as [string];
  const roleQ = await addRole(scene, "Q");
  await scene.tx.insert(assetGroupMembers).values({ assetGroupId: scene.groups.g1, assetId: quiet, role: roleQ });
  await addLiveSamples(scene, [quiet]);
  return item(await scene.service.summarize([...scene.own, quiet], null), roleQ);
}

/** A role with no active alarm still has a row, and its `worstSeverity` is `null`. */
export async function assertQuietRoleHasNullWorstSeverity(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const roleQ = await quietRow(scene);
    assert(
      roleQ.worstSeverity === null,
      `a quiet role's worstSeverity must be null, got ${JSON.stringify(roleQ.worstSeverity)}`,
    );
  });
}

/** A role with no active alarm still has a row, and its `worstCount` is 0. */
export async function assertQuietRoleHasZeroWorstCount(db: BmsDb): Promise<void> {
  await withScene(db, async (scene) => {
    const roleQ = await quietRow(scene);
    assert(roleQ.worstCount === 0, `a quiet role's worstCount must be 0, got ${roleQ.worstCount}`);
  });
}
