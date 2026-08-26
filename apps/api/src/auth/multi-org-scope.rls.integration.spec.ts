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
 * The two-org actor's read scope is the UNION of both orgs (a representative
 * seeded asset from each is in scope), is an explicit bounded list, and its
 * `kind` is not `"global"`.
 *
 * Deliberately NOT an exact count over `bms.assets`: that table is shared, and
 * concurrent integration suites add and drop per-run fixture assets in these
 * same seeded orgs, so any global-total assertion over it is a race (F4.65 /
 * F4.66 — the anti-pattern the plan names). The union is proven by a stable
 * representative from each org instead — a seeded asset in an active location,
 * chosen deterministically (`ORDER BY id`), which no concurrent suite deletes.
 */
export async function assertTwoOrgActorScopeIsBoundedUnion(
  svc: AccessControlService,
  fleetPool: pg.Pool,
  jwt: JwtPayload,
  orgAId: string,
  orgBId: string,
): Promise<void> {
  const representativeAsset = async (orgId: string): Promise<string | null> => {
    const { rows } = await fleetPool.query<{ id: string }>(
      `SELECT a.id FROM bms.assets a
         JOIN bms.locations l ON a.location_id = l.id
        WHERE l.organization_id = $1 AND l.active = true
        ORDER BY a.id LIMIT 1`,
      [orgId],
    );
    return rows[0]?.id ?? null;
  };
  const repA = await representativeAsset(orgAId);
  const repB = await representativeAsset(orgBId);
  // Both orgs must actually contribute a seeded asset, or the union is vacuous.
  expect(repA).not.toBeNull();
  expect(repB).not.toBeNull();

  const { scope } = await svc.currentUser(jwt);
  // Not the global bypass — a two-org actor is scoped, not fleet-wide.
  expect(scope.kind).not.toBe("global");

  const got = new Set(scope.assetIds);
  // The union is of BOTH orgs: a representative from each is present. A single
  // grant silently winning would drop one of these — stable under concurrent
  // fixtures, unlike an exact total.
  expect(got.has(repA as string)).toBe(true);
  expect(got.has(repB as string)).toBe(true);

  // readableAssetIds is an explicit bounded list, NOT the global admin's null
  // "everything" scope — the discriminator between a scoped multi-org actor and
  // a fleet-wide admin.
  const readable = await svc.readableAssetIds(jwt);
  expect(readable).not.toBeNull();
}
