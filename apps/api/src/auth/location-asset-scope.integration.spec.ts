import type pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { TreeFixture } from "./location-tree.integration.spec";
import type { LocationAssetScope, LocationAssetScopeService } from "./location-asset-scope.service";
import { jwtFor, rememberSubject } from "../testing/seeded-subjects";

/**
 * `F4.291` (ADR 0099 Amendment 9 E5, "Verification owed") — what the database
 * answers `LocationAssetScopeService` on the `F2.10` tree fixture
 * (`buildTreeFixture`, reused so the trees are the ones the closure tripwire
 * already proves):
 *
 *     F210-A:  R ── A ── A1 ── A1a        F210-B:  X ── X1
 *               └── B ── B1
 *
 * One asset per node. `grantee` (location_admin) holds A; `groupAdmin`
 * (asset_group_admin) holds a group on A1 whose one member is A1's asset. A
 * global admin is inserted here. Every expectation is computed from the ids
 * the fixture inserted, never read back from the service. Vitest entry point
 * (and the transaction the fixture lives in): the sibling `.test.ts`.
 */

type Node = keyof TreeFixture["assets"];

function fail(message: string): never {
  throw new Error(message);
}

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

function assetIdsOf(answer: LocationAssetScope, what: string): readonly string[] {
  if (!answer.ok) fail(`${what}: refused with ${answer.reason}, expected asset ids`);
  return answer.assetIds;
}

function expectAssets(answer: LocationAssetScope, fx: TreeFixture, nodes: readonly Node[], what: string): void {
  const actual = assetIdsOf(answer, what);
  const expected = sorted(nodes.map((n) => fx.assets[n]));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${what}: ${JSON.stringify(actual)}, expected the assets of ${nodes.join(", ")} sorted ${JSON.stringify(expected)}`);
  }
}

/**
 * A global admin user, inserted in the suite's transaction. Its
 * organization_id is NULL: users_role_organization_check (migration 0098)
 * ties role 'admin' to no organization.
 */
export async function insertGlobalAdmin(db: Pick<pg.Pool, "query">, run: string): Promise<JwtPayload> {
  const email = `f4291-admin-${run}@integration.invalid`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bms.users (organization_id, email, password_hash, display_name, role)
     VALUES (NULL, $1, 'not-a-usable-hash', 'F4.291 admin', 'admin') RETURNING id`,
    [email],
  );
  rememberSubject(email, rows[0]?.id ?? fail("admin user was not inserted"));
  return jwtFor(email, "admin");
}

/** (i) The global admin on R reads all six assets of organization A, sorted by id. */
export async function aGlobalAdminReadsTheWholeSubtree(svc: LocationAssetScopeService, fx: TreeFixture, admin: JwtPayload): Promise<void> {
  const answer = await svc.readableAssetIdsInLocations(admin, [fx.orgA], [fx.nodes.R]);
  expectAssets(answer, fx, ["R", "A", "A1", "A1a", "B", "B1"], "admin on R");
}

/**
 * (ii) The owed verification: the location admin of A asks for R. R, B and B1
 * hold assets inside the subtree and outside the grantee's scope, and are
 * absent; the adjacent positive is A, A1 and A1a, present.
 */
export async function anAssetOutsideTheCallersScopeIsAbsent(svc: LocationAssetScopeService, fx: TreeFixture): Promise<void> {
  const answer = await svc.readableAssetIdsInLocations(fx.grantee, [fx.orgA], [fx.nodes.R]);
  expectAssets(answer, fx, ["A", "A1", "A1a"], "grantee on R");
  for (const outside of ["R", "B", "B1"] as const) {
    if (assetIdsOf(answer, "grantee on R").includes(fx.assets[outside])) fail(`grantee on R returned ${outside}'s asset, outside the grant`);
  }
}

/** (iii) X lies in organization B: with candidates [A] it is `not_found`; with [A, B] the admin reads X and X1. */
export async function aLocationOfAnotherOrganizationIsNotFound(svc: LocationAssetScopeService, fx: TreeFixture, admin: JwtPayload): Promise<void> {
  const refused = await svc.readableAssetIdsInLocations(admin, [fx.orgA], [fx.nodes.X]);
  if (refused.ok || refused.reason !== "not_found") fail(`X with candidates [A]: ${JSON.stringify(refused)}, expected not_found`);
  expectAssets(await svc.readableAssetIdsInLocations(admin, [fx.orgA, fx.orgB], [fx.nodes.X]), fx, ["X", "X1"], "admin on X");
}

/** (iv) A1 reads its own subtree only: A1 and A1a, not A or R above it. */
export async function aDescendantReadsItsOwnSubtreeOnly(svc: LocationAssetScopeService, fx: TreeFixture, admin: JwtPayload): Promise<void> {
  expectAssets(await svc.readableAssetIdsInLocations(admin, [fx.orgA], [fx.nodes.A1]), fx, ["A1", "A1a"], "admin on A1");
}

/** (v) B is a sibling of the grantee's A: `outside_grant`. The adjacent positive: A answers. */
export async function aSiblingSiteIsOutsideTheGrant(svc: LocationAssetScopeService, fx: TreeFixture): Promise<void> {
  const refused = await svc.readableAssetIdsInLocations(fx.grantee, [fx.orgA], [fx.nodes.B]);
  if (refused.ok || refused.reason !== "outside_grant") fail(`grantee on B: ${JSON.stringify(refused)}, expected outside_grant`);
  expectAssets(await svc.readableAssetIdsInLocations(fx.grantee, [fx.orgA], [fx.nodes.A]), fx, ["A", "A1", "A1a"], "grantee on A");
}

/** (vi) The asset-group admin on A reads its group's one asset (A1's), not A's or A1a's. */
export async function anAssetGroupAdminReadsItsGroupOnly(svc: LocationAssetScopeService, fx: TreeFixture): Promise<void> {
  expectAssets(await svc.readableAssetIdsInLocations(fx.groupAdmin, [fx.orgA], [fx.nodes.A]), fx, ["A1"], "group admin on A");
}
