import { BadRequestException, ForbiddenException } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import type { TreeFixture } from "../auth/location-tree.integration.spec";
import { LOCATION_IDS_OUTSIDE_ORGANIZATION, LOCATION_IDS_OUTSIDE_SCOPE, type ReportScopeService } from "./report-scope";

/**
 * `F4.290` (ADR 0099 Amendment 9 E4, "Verification owed") — what the database
 * answers the report routes' site filter, `ReportScopeService` over the real
 * `LocationAssetScopeService` and `AccessControlService`, on the `F2.10` tree
 * fixture (`buildTreeFixture`):
 *
 *     F210-A:  R ── A ── A1 ── A1a        F210-B:  X ── X1
 *               └── B ── B1
 *
 * One asset per node; `grantee` (location_admin) holds A. Every expectation is
 * computed from the ids the fixture inserted. Vitest entry point (and the
 * transaction the fixture lives in): the sibling `.test.ts`.
 */

type Node = keyof TreeFixture["assets"];

function fail(message: string): never {
  throw new Error(message);
}

function expectAssets(actual: readonly string[] | null, fx: TreeFixture, nodes: readonly Node[], what: string): void {
  const expected = nodes.map((n) => fx.assets[n]).sort();
  if (JSON.stringify(actual === null ? null : [...actual].sort()) !== JSON.stringify(expected)) {
    fail(`${what}: ${JSON.stringify(actual)}, expected the assets of ${nodes.join(", ")} ${JSON.stringify(expected)}`);
  }
}

async function refusal(promise: Promise<unknown>, what: string): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  return fail(`${what}: resolved, expected a refusal`);
}

/**
 * The owed case: the location admin of A filters by R. R, B and B1 hold assets
 * inside the subtree and outside the grantee's scope, and are absent; A, A1
 * and A1a are the adjacent positive.
 */
export async function aSiteFilterNeverReadsAnAssetOutsideTheCallersScope(svc: ReportScopeService, fx: TreeFixture): Promise<void> {
  expectAssets(await svc.assetIdsForCaller(fx.grantee, [fx.nodes.R]), fx, ["A", "A1", "A1a"], "grantee filtering by R");
}

/**
 * A site inside the grant narrows the read: the grantee filtering by A1 reads
 * A1 and A1a, not A (its whole readable set) — the filter is applied, not just
 * the scope.
 */
export async function aSiteInsideTheGrantNarrowsTheRead(svc: ReportScopeService, fx: TreeFixture): Promise<void> {
  expectAssets(await svc.assetIdsForCaller(fx.grantee, [fx.nodes.A1]), fx, ["A1", "A1a"], "grantee filtering by A1");
}

/** The global admin reads every organization: a site of organization B is read through its own organization. */
export async function theGlobalAdminFiltersBySiteOfAnyOrganization(svc: ReportScopeService, fx: TreeFixture, admin: JwtPayload): Promise<void> {
  expectAssets(await svc.assetIdsForCaller(admin, [fx.nodes.X]), fx, ["X", "X1"], "admin filtering by X");
}

/** A sibling site of the grantee's A is a 403 with the schedule's sentence. */
export async function aSiblingSiteIsA403(svc: ReportScopeService, fx: TreeFixture): Promise<void> {
  const err = await refusal(svc.assetIdsForCaller(fx.grantee, [fx.nodes.B]), "grantee filtering by B");
  if (!(err instanceof ForbiddenException) || err.message !== LOCATION_IDS_OUTSIDE_SCOPE) fail(`grantee on B: ${err.name} ${err.message}`);
}

/** A site of an organization the grantee does not read is a 400: not found among its organizations. */
export async function aSiteOfAnotherOrganizationIsA400(svc: ReportScopeService, fx: TreeFixture): Promise<void> {
  const err = await refusal(svc.assetIdsForCaller(fx.grantee, [fx.nodes.X]), "grantee filtering by X");
  if (!(err instanceof BadRequestException) || err.message !== LOCATION_IDS_OUTSIDE_ORGANIZATION) fail(`grantee on X: ${err.name} ${err.message}`);
}
