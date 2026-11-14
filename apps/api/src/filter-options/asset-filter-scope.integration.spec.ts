import type pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import type { TreeFixture } from "../auth/location-tree.integration.spec";
import type { AssetFilterScopeService, AssetScopeFilter } from "./asset-filter-scope.service";

/**
 * `F4.361` U2 (ADR 0132 decision 5, build notes 1, 3 and 4) —
 * `AssetFilterScopeService.narrow` on the real database, on the `F2.10` tree
 * fixture (`buildTreeFixture`):
 *
 *     F210-A:  R ── A ── A1 ── A1a        F210-B:  X ── X1
 *               └── B ── B1
 *
 * one asset per node; `grantee` holds A, `groupAdmin` holds the group G on A1
 * (member: A1's asset), `foreignOrgAdmin` holds organization F210-B. This file
 * adds **G2**, a second group on A1 with the same member that nobody is
 * granted: `grantee` reads it (A1 is a readable location, build note 1) and
 * `groupAdmin` does not (build note 4 — even though it reads A1's asset).
 *
 * Every expectation is computed from the fixture's ids, never read back from
 * the service. `asset-filter-scope.integration.test.ts` is the Vitest entry
 * point (ADR 0014).
 */

type Node = keyof TreeFixture["assets"];

function fail(message: string): never {
  throw new Error(message);
}

/** G2: a second group on A1, same member, no grant. */
export async function insertUngrantedGroup(db: Pick<pg.Pool, "query">, fx: TreeFixture, run: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bms.asset_groups (organization_id, location_id, code, name) VALUES ($1, $2, $3, $4) RETURNING id`,
    [fx.orgA, fx.nodes.A1, `F4361-${run}-G2`, "F4.361 ungranted group on A1"],
  );
  const id = rows[0]?.id ?? fail("G2 was not inserted");
  await db.query(`INSERT INTO bms.asset_group_members (asset_group_id, asset_id) VALUES ($1, $2)`, [id, fx.assets.A1]);
  return id;
}

export type NarrowFixture = {
  readonly svc: AssetFilterScopeService;
  readonly access: AccessControlService;
  readonly fx: TreeFixture;
  readonly g2: string;
  readonly admin: JwtPayload;
};

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

async function expectAssets(f: NarrowFixture, user: JwtPayload, filter: AssetScopeFilter, nodes: readonly Node[], what: string): Promise<void> {
  const narrowed = await f.svc.narrow(user, filter);
  expect(narrowed, `${what}: a set key must never answer null`).not.toBeNull();
  expect(sorted(narrowed ?? []), what).toEqual(sorted(nodes.map((n) => f.fx.assets[n])));
}

/** `grantee` (location A): organization, location, both groups, a foreign asset, a foreign organization. */
export async function aLocationGranteeNarrowsInsideItsSubtree(f: NarrowFixture): Promise<void> {
  const { fx } = f;
  await expectAssets(f, fx.grantee, { organizationId: fx.orgA }, ["A", "A1", "A1a"], "grantee, organization A");
  await expectAssets(f, fx.grantee, { locationId: fx.nodes.A1 }, ["A1", "A1a"], "grantee, location A1");
  await expectAssets(f, fx.grantee, { locationId: fx.nodes.B }, [], "grantee, sibling location B (P2)");
  await expectAssets(f, fx.grantee, { assetGroupId: fx.groupId }, ["A1"], "grantee, group G on a readable location");
  await expectAssets(f, fx.grantee, { assetGroupId: f.g2 }, ["A1"], "grantee, ungranted group G2 on a readable location (build note 1)");
  await expectAssets(f, fx.grantee, { assetId: fx.assets.A1a }, ["A1a"], "grantee, its own asset A1a");
  await expectAssets(f, fx.grantee, { assetId: fx.assets.B }, [], "grantee, B's asset");
  await expectAssets(f, fx.grantee, { organizationId: fx.orgB }, [], "grantee, organization B");
}

/** `groupAdmin` (G on A1): G is its member; G2, on the same location and member, is `[]` (build note 4). */
export async function anAssetGroupAdminReadsItsGrantedGroupOnly(f: NarrowFixture): Promise<void> {
  const { fx } = f;
  await expectAssets(f, fx.groupAdmin, { assetGroupId: fx.groupId }, ["A1"], "groupAdmin, its group G");
  await expectAssets(f, fx.groupAdmin, { assetGroupId: f.g2 }, [], "groupAdmin, ungranted group G2");
  await expectAssets(f, fx.groupAdmin, { locationId: fx.nodes.A1 }, ["A1"], "groupAdmin, location A1");
  await expectAssets(f, fx.groupAdmin, { organizationId: fx.orgA }, ["A1"], "groupAdmin, organization A");
}

/** `foreignOrgAdmin` (organization B): every organization-A id is `[]`; organization B is X and X1. */
export async function aForeignOrganizationAdminGetsNothingOfOrganizationA(f: NarrowFixture): Promise<void> {
  const { fx } = f;
  await expectAssets(f, fx.foreignOrgAdmin, { organizationId: fx.orgB }, ["X", "X1"], "foreignOrgAdmin, its own organization");
  await expectAssets(f, fx.foreignOrgAdmin, { organizationId: fx.orgA }, [], "foreignOrgAdmin, organization A");
  await expectAssets(f, fx.foreignOrgAdmin, { locationId: fx.nodes.A }, [], "foreignOrgAdmin, location A");
  await expectAssets(f, fx.foreignOrgAdmin, { assetGroupId: fx.groupId }, [], "foreignOrgAdmin, group G");
  await expectAssets(f, fx.foreignOrgAdmin, { assetGroupId: f.g2 }, [], "foreignOrgAdmin, group G2");
  await expectAssets(f, fx.foreignOrgAdmin, { assetId: fx.assets.A }, [], "foreignOrgAdmin, A's asset");
}

/** The global admin: organization A is the six A-side assets; `{}` stays `null`; a group is its member. */
export async function theGlobalAdminNarrowsAnyOrganization(f: NarrowFixture): Promise<void> {
  const { fx } = f;
  expect(await f.svc.narrow(f.admin, {}), "the admin's empty filter").toBeNull();
  await expectAssets(f, f.admin, { organizationId: fx.orgA }, ["R", "A", "A1", "A1a", "B", "B1"], "admin, organization A");
  await expectAssets(f, f.admin, { locationId: fx.nodes.B }, ["B", "B1"], "admin, location B");
  await expectAssets(f, f.admin, { assetGroupId: f.g2 }, ["A1"], "admin, group G2");
}

/** Filters AND together: each key cuts the others' answer. */
export async function combinedFiltersIntersect(f: NarrowFixture): Promise<void> {
  const { fx } = f;
  await expectAssets(
    f,
    fx.grantee,
    { organizationId: fx.orgA, locationId: fx.nodes.A1, assetGroupId: fx.groupId },
    ["A1"],
    "grantee, organization A + location A1 + group G",
  );
  await expectAssets(f, fx.grantee, { locationId: fx.nodes.A1a, assetGroupId: fx.groupId }, [], "grantee, location A1a + group G");
  await expectAssets(f, fx.grantee, { locationId: fx.nodes.A1, assetId: fx.assets.A }, [], "grantee, location A1 + A's asset");
  await expectAssets(f, f.admin, { organizationId: fx.orgB, assetGroupId: fx.groupId }, [], "admin, organization B + group G");
}

/** Every answer of a bounded caller is a subset of its `readableAssetIds`. */
export async function everyAnswerIsInsideTheReadableSet(f: NarrowFixture): Promise<void> {
  const { fx } = f;
  const filters: AssetScopeFilter[] = [
    { organizationId: fx.orgA },
    { organizationId: fx.orgB },
    ...(Object.values(fx.nodes).map((locationId) => ({ locationId })) as AssetScopeFilter[]),
    { assetGroupId: fx.groupId },
    { assetGroupId: f.g2 },
    ...(Object.values(fx.assets).map((assetId) => ({ assetId })) as AssetScopeFilter[]),
  ];
  for (const user of [fx.grantee, fx.grantee2, fx.groupAdmin, fx.foreignOrgAdmin]) {
    const readable = await f.access.readableAssetIds(user);
    if (readable === null) fail(`${user.email} is unrestricted; the fixture expects a bounded reader`);
    const allowed = new Set(readable);
    for (const filter of filters) {
      const narrowed = await f.svc.narrow(user, filter);
      expect(narrowed, `${user.email} ${JSON.stringify(filter)}`).not.toBeNull();
      const outside = (narrowed ?? []).filter((id) => !allowed.has(id));
      expect(outside, `${user.email} ${JSON.stringify(filter)} answered ids outside readableAssetIds`).toEqual([]);
    }
  }
}
