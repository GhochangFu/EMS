import { expect } from "vitest";
import pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "./access-control.service";

/**
 * `E7.1b` (ADR 0043 Amendment 3 ruling 3, plan Task 5) — a multi-organization
 * actor is scoped to the bounded UNION of its orgs, resolved on `fleetDb`.
 *
 * No seeded user holds more than one org, so the `.test.ts` sibling creates a
 * two-org actor (one `bms.users` row + two `user_organization_access` grants,
 * reusing the two seeded organizations — no new location, which would re-open
 * the seed-breaker E7.1a closed). The claim is not a refusal: the actor sees
 * both orgs' assets and nothing more, and — the discriminator from a global
 * admin — as an EXPLICIT bounded list, not the `null` "everything" scope.
 *
 * `AccessControlService.scopeFromSource("organization")` reads all of the
 * actor's `user_organization_access` grants via `directOrganizationIds` and
 * filters assets by the active locations of that whole set (Amendment 2/3, all
 * on `fleetDb`). This proves that set-based path returns the union for >1 org,
 * rather than silently collapsing to one org or falling through to global.
 */

/**
 * The two-org actor's read scope equals exactly the union of both orgs' assets
 * (computed the way the service does — assets in each org's active locations),
 * is not the global `null`, and its `kind` is not `"global"`.
 */
export async function assertTwoOrgActorScopeIsBoundedUnion(
  svc: AccessControlService,
  fleetPool: pg.Pool,
  jwt: JwtPayload,
  orgAId: string,
  orgBId: string,
): Promise<void> {
  // Expected assets, computed the same way scopeFromSource("organization") does:
  // assets whose location is an active location of the org.
  const assetsInOrg = async (orgId: string): Promise<string[]> => {
    const { rows } = await fleetPool.query<{ id: string }>(
      `SELECT a.id FROM bms.assets a
         JOIN bms.locations l ON a.location_id = l.id
        WHERE l.organization_id = $1 AND l.active = true`,
      [orgId],
    );
    return rows.map((r) => r.id);
  };
  const idsA = await assetsInOrg(orgAId);
  const idsB = await assetsInOrg(orgBId);
  // Both orgs must actually contribute, or the union claim is vacuous.
  expect(idsA.length).toBeGreaterThan(0);
  expect(idsB.length).toBeGreaterThan(0);
  const expected = new Set([...idsA, ...idsB]);

  const { scope } = await svc.currentUser(jwt);
  // Not the global bypass — a two-org actor is scoped, not fleet-wide.
  expect(scope.kind).not.toBe("global");

  const got = new Set(scope.assetIds);
  expect(got.size).toBe(expected.size);
  for (const id of expected) {
    expect(got.has(id)).toBe(true);
  }
  // A representative from each org is present — proves the union is of BOTH, not
  // one grant silently winning.
  expect(got.has(idsA[0] as string)).toBe(true);
  expect(got.has(idsB[0] as string)).toBe(true);

  // readableAssetIds is an explicit bounded list, NOT the global admin's null.
  const readable = await svc.readableAssetIds(jwt);
  expect(readable).not.toBeNull();
  expect(new Set(readable as string[]).size).toBe(expected.size);
}
