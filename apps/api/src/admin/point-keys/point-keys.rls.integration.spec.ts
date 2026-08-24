import { expect } from "vitest";
import pg from "pg";

import { pointKeys } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { withTenant } from "../../database/tenant-context";
import type { PointKeysAdminService } from "./point-keys.service";

/**
 * `F4.16` Task 8 — the write-path coverage `point-keys.service.ts` had none
 * of. See `locations.rls.integration.spec.ts` for the full rationale
 * (including why `assertRefusesOutOfScopeOrganization` is not an RLS proof
 * and `assertPolicyRefusesMismatchedOrg` is); this is the same shape against
 * the other zero-coverage RLS write path.
 */
type SvcWithFixtures = {
  svc: PointKeysAdminService;
  ownerPool: pg.Pool;
  organizationId: string;
};

export async function assertWriteLifecycleSurvivesRealRls(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
): Promise<string> {
  const { svc, ownerPool, organizationId } = ctx;
  const created = await svc.create(jwt, {
    organizationId,
    code: `f4.16-rls-${Date.now()}`,
    name: "F4.16 RLS write-path check",
  });
  expect(created.organizationId).toBe(organizationId);
  expect(created.active).toBe(true);

  // Written on the tenant connection under a real SET LOCAL — if withTenant
  // were silently missing, this insert would fail here with a row-level
  // security policy violation rather than merely being unscoped.
  const [ownerRow] = (
    await ownerPool.query<{ organization_id: string }>(
      "SELECT organization_id FROM bms.point_keys WHERE id = $1",
      [created.id],
    )
  ).rows;
  expect(ownerRow?.organization_id).toBe(organizationId);

  const fetched = await svc.getById(jwt, created.id);
  expect(fetched.name).toBe("F4.16 RLS write-path check");

  const updated = await svc.update(jwt, created.id, { name: "F4.16 RLS write-path renamed" });
  expect(updated.name).toBe("F4.16 RLS write-path renamed");

  const deactivated = await svc.deactivate(jwt, created.id);
  expect(deactivated.active).toBe(false);

  const reactivated = await svc.reactivate(jwt, created.id);
  expect(reactivated.active).toBe(true);
  return created.id;
}

/**
 * App-layer authorization, not RLS — `canManagePointKey` refuses before
 * `withTenant` is ever called.
 */
export async function assertRefusesOutOfScopeOrganization(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { svc, ownerPool, organizationId } = ctx;
  const { rows } = await ownerPool.query<{ id: string }>(
    "SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1",
    [organizationId],
  );
  if (!rows[0]) {
    throw new Error("F4.16: need a second organization to prove cross-org refusal.");
  }
  await expect(
    svc.create(jwt, {
      organizationId: rows[0].id,
      code: `f4.16-rls-deny-${Date.now()}`,
      name: "must never be created",
    }),
  ).rejects.toThrow(/access scope/i);
}

/**
 * The actual `WITH CHECK` proof, exercised directly against the real
 * `bms_tenant` role rather than through the service — `PointKeysAdminService`
 * never constructs a mismatched GUC/row-organization pair itself.
 */
export async function assertPolicyRefusesMismatchedOrg(
  tenantDb: BmsDb,
  organizationId: string,
  otherOrganizationId: string,
): Promise<void> {
  await expect(
    withTenant(tenantDb, organizationId, (tx) =>
      tx.insert(pointKeys).values({
        organizationId: otherOrganizationId,
        code: `f4.16-rls-check-${Date.now()}`,
        name: "must never be written — WITH CHECK should refuse it",
        active: true,
      }),
    ),
  ).rejects.toThrow(/row-level security/i);
}
