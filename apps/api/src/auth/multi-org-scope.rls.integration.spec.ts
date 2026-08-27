import { expect } from "vitest";

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
 * The two-org actor's read scope is the UNION of both orgs: a fixture asset
 * placed in each org's active location is in scope.
 *
 * `repAssetAId` / `repAssetBId` are THIS run's own committed assets (the
 * `.test.ts` sibling creates one per org), so no concurrent suite can add or
 * remove them — the union is proven without any global-total over `bms.assets`,
 * which is shared and mutated by other suites (the F4.65 / F4.66 anti-pattern),
 * and without the residual race a min-`ORDER BY id` seeded pick would carry.
 */
export async function assertTwoOrgActorScopeIsBoundedUnion(
  svc: AccessControlService,
  jwt: JwtPayload,
  repAssetAId: string,
  repAssetBId: string,
): Promise<void> {
  const { scope } = await svc.currentUser(jwt);

  // Sanity controls, NOT the union discriminator: an `organization_admin` role
  // never resolves to the global bypass (`scopeFromSource("organization")` never
  // returns kind "global", and `readableAssetIds` is null only for role
  // "admin"), so these confirm the fixture actor resolved as a scoped non-admin.
  // They cannot catch a union bug — the two representatives below do.
  expect(scope.kind).not.toBe("global");
  const readable = await svc.readableAssetIds(jwt);
  expect(readable).not.toBeNull();

  // The discriminator: this run's own asset in EACH org's active location is in
  // scope, so the scope is the union of both grants. A collapse to one org drops
  // one representative. Airtight under parallelism — these ids are this run's.
  const got = new Set(scope.assetIds);
  expect(got.has(repAssetAId)).toBe(true);
  expect(got.has(repAssetBId)).toBe(true);
}
