import { expect } from "vitest";
import pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { AssetsAdminService } from "./assets.service";

/**
 * `E7.1b` — the write-path coverage `AssetsAdminService` never had.
 *
 * `assets` gains `organization_id` + a `tenant_isolation` policy + `FORCE` in
 * migration `0047`; until then `withTenant` sets a GUC no policy reads, so a
 * missing wrap would not fail loudly here. What this proves *now* is the funnel
 * logic that must be right before the flip: `create` stamps `organization_id`
 * from the asset's location, and the wrapped lifecycle survives a real,
 * non-owner `bms_tenant` connection. The `WITH CHECK` refusal proof lands with
 * the policy in Task 4 (`assertPolicyRefusesMismatchedOrg`, as in
 * `point-keys.rls.integration.spec.ts`).
 */
type SvcWithFixtures = {
  svc: AssetsAdminService;
  ownerPool: pg.Pool;
  organizationId: string;
  locationId: string;
  domain: string;
};

export async function assertAssetWriteLifecycleSurvivesRealRls(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
): Promise<string> {
  const { svc, ownerPool, organizationId, locationId, domain } = ctx;
  const created = await svc.create(jwt, {
    code: `e7-1b-rls-${Date.now()}`,
    name: "E7.1b RLS write-path check",
    siteName: "E7.1b RLS site",
    locationId,
    rtuId: null,
    domain,
  });
  expect(created.active).toBe(true);

  // The asset DTO exposes `organizationCode`, not the id — assert the stamped
  // column directly on the owner connection. `assets` has no policy yet, so the
  // owner read needs no tenant context.
  const [ownerRow] = (
    await ownerPool.query<{ organization_id: string | null }>(
      "SELECT organization_id FROM bms.assets WHERE id = $1",
      [created.id],
    )
  ).rows;
  expect(ownerRow?.organization_id).toBe(organizationId);

  const fetched = await svc.getById(jwt, created.id);
  expect(fetched.id).toBe(created.id);
  expect(fetched.organizationId).toBe(organizationId);

  const updated = await svc.update(jwt, created.id, { name: "E7.1b RLS renamed" });
  expect(updated.name).toBe("E7.1b RLS renamed");

  const deactivated = await svc.deactivate(jwt, created.id);
  expect(deactivated.active).toBe(false);

  const reactivated = await svc.reactivate(jwt, created.id);
  expect(reactivated.active).toBe(true);
  return created.id;
}

/**
 * The cross-org relocation guard. Only a global admin can even reach it — an
 * org/location admin is refused by `canManageLocation` on the destination
 * first. Moving an asset to a location in another organization is refused
 * outright, so post-`0047` it never becomes a silent zero-row no-op (the
 * UPDATE's `USING` (old org) and `WITH CHECK` (new org) cannot both hold under
 * one `SET LOCAL`).
 */
export async function assertRefusesCrossOrgRelocation(
  ctx: SvcWithFixtures & { foreignLocationId: string },
  adminJwt: JwtPayload,
): Promise<void> {
  const { svc, ownerPool, locationId, domain, foreignLocationId } = ctx;
  const created = await svc.create(adminJwt, {
    code: `e7-1b-move-${Date.now()}`,
    name: "E7.1b relocation guard",
    siteName: "E7.1b move site",
    locationId,
    rtuId: null,
    domain,
  });
  try {
    await expect(
      svc.update(adminJwt, created.id, { locationId: foreignLocationId }),
    ).rejects.toThrow(/another organization/i);
  } finally {
    await ownerPool.query("DELETE FROM bms.assets WHERE id = $1", [created.id]);
  }
}

/**
 * `F3.74` (ADR 0088) — `rating` and `tripCause` on the asset write path. A create carrying both
 * reads them back; on update `undefined` keeps the stored value and an explicit `null` clears it.
 * Two `it`s own the two halves, so a `??` in place of the `undefined` test reddens the update claim.
 */
export async function assertCreateStoresRatingAndTripCause(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
  track: (id: string) => void,
): Promise<void> {
  const { svc, locationId, domain } = ctx;
  const created = await svc.create(jwt, {
    code: `f3-74-rating-${Date.now()}`,
    name: "F3.74 rating",
    siteName: "F3.74 site",
    locationId,
    rtuId: null,
    domain,
    rating: "630A",
    tripCause: "overload",
  });
  // Tracked before any assertion, so a failing claim still leaves no row behind.
  track(created.id);
  expect(created.rating).toBe("630A");
  expect(created.tripCause).toBe("overload");
  const fetched = (await svc.list(jwt, locationId)).items.find((a) => a.id === created.id);
  expect(fetched?.rating).toBe("630A");
  expect(fetched?.tripCause).toBe("overload");
}

export async function assertUpdateKeepsOmittedAndClearsNull(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
  track: (id: string) => void,
): Promise<void> {
  const { svc, locationId, domain } = ctx;
  const created = await svc.create(jwt, {
    code: `f3-74-clear-${Date.now()}`,
    name: "F3.74 clear",
    siteName: "F3.74 site",
    locationId,
    rtuId: null,
    domain,
    rating: "400A",
    tripCause: "earth fault",
  });
  track(created.id);
  const renamed = await svc.update(jwt, created.id, { name: "F3.74 clear renamed" });
  expect(renamed.rating).toBe("400A");
  expect(renamed.tripCause).toBe("earth fault");
  const cleared = await svc.update(jwt, created.id, { tripCause: null });
  expect(cleared.tripCause).toBeNull();
  expect(cleared.rating).toBe("400A");
  const refetched = (await svc.list(jwt, locationId)).items.find((a) => a.id === created.id);
  expect(refetched?.tripCause).toBeNull();
  expect(refetched?.rating).toBe("400A");
}
