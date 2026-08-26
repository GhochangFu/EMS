import { expect } from "vitest";
import pg from "pg";

import { assets, createDb, locations } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { withTenant } from "../../database/tenant-context";
import type { LocationsAdminService } from "./locations.service";

/**
 * `F4.16` Task 8 — the write-path coverage `locations.service.ts` had none of.
 *
 * Every other RLS-adjacent service on this branch either has its own
 * integration suite exercising it against real, non-owner roles, or — for the
 * three `asset-templates` suites — was rewired onto real roles by this same
 * task. `LocationsAdminService` had neither: zero test files of any kind. A
 * `withTenant(` wrapper silently deleted from `create`/`update`/`deactivate`/
 * `reactivate` would ship undetected, exactly the class of regression Task 6.6
 * found and fixed for ~20 other services.
 *
 * **`assertRefusesOutOfScopeOrganization` does not prove RLS, and does not
 * claim to** — code-reviewer found the original version of this file claimed
 * it under an RLS-framed rationale while `canManageOrganization`'s app-level
 * check throws before `withTenant` is ever reached, so the assertion is
 * invariant under `withTenant` being deleted outright (mutation-tested: it
 * still passes with the wrapper gone). It is a legitimate, worth-keeping
 * authorization test — just not an RLS one. `assertPolicyRefusesMismatchedOrg`
 * below is what actually exercises the `WITH CHECK` clause.
 */
type SvcWithFixtures = {
  svc: LocationsAdminService;
  tenantPool: pg.Pool;
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
    code: `F4.16-RLS-${Date.now()}`,
    slug: `f4-16-rls-${Date.now()}`,
    name: "F4.16 RLS write-path check",
    type: "rsmoc",
    latitude: 0,
    longitude: 0,
  });
  expect(created.organizationId).toBe(organizationId);
  expect(created.active).toBe(true);

  // Written on the tenant connection under a real SET LOCAL — if withTenant
  // were silently missing, this insert would fail here with a row-level
  // security policy violation rather than merely being unscoped.
  const [ownerRow] = (
    await ownerPool.query<{ organization_id: string }>(
      "SELECT organization_id FROM bms.locations WHERE id = $1",
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
 * App-layer authorization, not RLS — `canManageOrganization` refuses before
 * `withTenant` is ever called. Kept because it is a real guarantee the
 * service must have; renamed and re-scoped so it no longer overclaims what it
 * proves.
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
      code: `F4.16-RLS-DENY-${Date.now()}`,
      slug: `f4-16-rls-deny-${Date.now()}`,
      name: "must never be created",
      type: "rsmoc",
      latitude: 0,
      longitude: 0,
    }),
  ).rejects.toThrow(/access scope/i);
}

/**
 * The deactivate guard counts active RTUs and assets to refuse deactivating a
 * location that still has either. `E7.1b` moved those two counts inside
 * `withTenant(existing.organizationId, …)`: on the bare tenant pool with no
 * `SET LOCAL`, the 0047 FORCE policy on `assets`/`rtus` returns 0, the guard
 * never fires, and a location with live assets is deactivated anyway. The
 * existing lifecycle test deactivates an *empty* location, so it passes with the
 * guard blind; this seeds an active asset and proves the guard sees it.
 */
export async function assertDeactivateGuardSeesActiveAssetsUnderRls(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { svc, tenantPool, ownerPool, organizationId } = ctx;

  const { rows: domRows } = await ownerPool.query<{ code: string }>(
    "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
  );
  if (!domRows[0]) {
    throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
  }
  const domain = domRows[0].code;

  const suffix = Date.now();
  const location = await svc.create(jwt, {
    organizationId,
    code: `E71B-LOC-GUARD-${suffix}`,
    slug: `e71b-loc-guard-${suffix}`,
    name: "E7.1b deactivate-guard location",
    type: "rsmoc",
    latitude: 0,
    longitude: 0,
  });

  const tenantDb = createDb(tenantPool);
  let assetId = "";
  try {
    await withTenant(tenantDb, organizationId, async (tx) => {
      const [asset] = await tx
        .insert(assets)
        .values({
          organizationId,
          code: `E71B-AS-GUARD-${suffix}`,
          name: "E7.1b deactivate-guard asset",
          siteName: "E7.1b Site",
          locationId: location.id,
          domain,
          active: true,
        })
        .returning({ id: assets.id });
      assetId = asset.id;
    });

    await expect(
      svc.deactivate(jwt, location.id),
      "a location with an active asset must not deactivate — the guard counts inside the org GUC",
    ).rejects.toThrow(/active RTUs or assets/i);
  } finally {
    if (assetId) {
      await ownerPool.query("DELETE FROM bms.assets WHERE id = $1", [assetId]);
    }
    await ownerPool.query("DELETE FROM bms.locations WHERE id = $1", [location.id]);
  }
}

/**
 * The actual `WITH CHECK` proof: a `SET LOCAL app.current_organization`
 * correctly naming organization A, writing a row that claims organization B.
 * `LocationsAdminService` never constructs this shape itself (the id it
 * passes to `withTenant` and the row's own `organizationId` always come from
 * the same source), so no code path through the service can trigger it — this
 * is the database policy's own defence for the case application logic never
 * produces, exercised directly against the real `bms_tenant` role.
 */
export async function assertPolicyRefusesMismatchedOrg(
  tenantDb: BmsDb,
  organizationId: string,
  otherOrganizationId: string,
): Promise<void> {
  await expect(
    withTenant(tenantDb, organizationId, (tx) =>
      tx.insert(locations).values({
        organizationId: otherOrganizationId,
        code: `F4.16-RLS-CHECK-${Date.now()}`,
        slug: `f4-16-rls-check-${Date.now()}`,
        name: "must never be written — WITH CHECK should refuse it",
        type: "rsmoc",
        latitude: 0,
        longitude: 0,
        active: true,
      }),
    ),
  ).rejects.toThrow(/row-level security/i);
}
