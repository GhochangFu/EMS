import { expect } from "vitest";
import pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { RtusAdminService } from "./rtus.service";

/**
 * `E7.1b` — the write-path coverage `RtusAdminService` never had.
 *
 * `rtus` gains `organization_id` + a `tenant_isolation` policy + `FORCE` in
 * migration `0047`; until then `withTenant` sets a GUC no policy reads. What
 * this proves now is the funnel logic: `create` stamps `organization_id` from
 * the RTU's location, and the wrapped lifecycle survives a real, non-owner
 * `bms_tenant` connection. An RTU never relocates (its `location_id` is not
 * updatable), so there is no cross-org move to test. The `WITH CHECK` refusal
 * proof lands with the policy in Task 4.
 */
type SvcWithFixtures = {
  svc: RtusAdminService;
  ownerPool: pg.Pool;
  organizationId: string;
  locationId: string;
};

export async function assertRtuWriteLifecycleSurvivesRealRls(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
): Promise<string> {
  const { svc, ownerPool, organizationId, locationId } = ctx;
  const created = await svc.create(jwt, {
    locationId,
    code: `e7.1b-rtu-${Date.now()}`,
    displayName: "E7.1b RLS RTU",
    sourceType: "catalog",
  });
  expect(created.active).toBe(true);

  // The DTO exposes `organizationCode`, not the id — assert the stamped column
  // directly on the owner connection (`rtus` has no policy yet).
  const [ownerRow] = (
    await ownerPool.query<{ organization_id: string | null }>(
      "SELECT organization_id FROM bms.rtus WHERE id = $1",
      [created.id],
    )
  ).rows;
  expect(ownerRow?.organization_id).toBe(organizationId);

  const updated = await svc.update(jwt, created.id, {
    displayName: "E7.1b RLS RTU renamed",
  });
  expect(updated.displayName).toBe("E7.1b RLS RTU renamed");

  const deactivated = await svc.deactivate(jwt, created.id);
  expect(deactivated.active).toBe(false);

  const reactivated = await svc.reactivate(jwt, created.id);
  expect(reactivated.active).toBe(true);
  return created.id;
}
