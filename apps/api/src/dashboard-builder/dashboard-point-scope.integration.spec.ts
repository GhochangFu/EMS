import { expect } from "vitest";

import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";

import { withTenant } from "../database/tenant-context";
import { assertBoundPointsInOrganization, resolveBoundPoints } from "./dashboard-point-scope";

/**
 * `F3.1b` Task 5 — the bound-point organization guard. Assertions live here;
 * `dashboard-point-scope.integration.test.ts` is the Vitest entry point (ADR 0014) and owns
 * fixture construction and cleanup.
 *
 * **The construction is the whole point of this file.** `F3.1a`'s policy now refuses a
 * cross-organization binding through the normal write path — `assertCrossOrgBindingWasWritten`
 * below is what stops a test that tries to create one the normal way and asserts "the read
 * returns nothing" from passing because the row could not be created, not because the read
 * filtered it (the same false green `F3.1a`'s own review found). Every negative assertion here
 * runs against a binding manufactured with the policy bypassed — inserted through the
 * SUPERUSER connection, which the test file's fixture setup proves landed on disk BEFORE any
 * of the read assertions below run.
 */

/** Confirms the manufactured cross-organization row genuinely exists on disk, via a THIRD,
 * ordinary connection — not the one that inserted it. A silent no-op insert would make every
 * assertion below vacuous. */
export async function assertCrossOrgBindingWasWritten(
  fleetDb: BmsDb,
  widgetId: string,
  phewbPointId: string,
): Promise<void> {
  const rows = await fleetDb.execute(
    sql`SELECT point_id FROM bms.dashboard_widget_points WHERE widget_id = ${widgetId} AND point_id = ${phewbPointId}`,
  );
  expect(
    rows.rows.length,
    "the manufactured cross-organization binding does not exist on disk — every assertion " +
      "below would be vacuous. The policy-bypassed insert did not land.",
  ).toBe(1);
}

/**
 * Negative, TENANT pool: reading as ESKOM through `withTenant`, the foreign PHEWB binding must
 * not appear — neither its `pointId` nor its `assetId` anywhere in the result. `asset_points`'s own
 * `tenant_isolation` policy is what filters it here — this test alone would still pass with
 * this file's explicit predicate deleted, because the policy masks its absence.
 */
export async function assertTenantPoolExcludesForeignBinding(
  tenantDb: BmsDb,
  eskomOrgId: string,
  widgetId: string,
  legitEskomPointId: string,
  phewbAssetId: string,
  phewbPointId: string,
): Promise<void> {
  const resolved = await withTenant(tenantDb, eskomOrgId, (tx) =>
    resolveBoundPoints(tx, eskomOrgId, [widgetId]),
  );
  expect(
    // `pointId`/`assetId`, never `pointKey`: a point key is a per-asset name, not an
    // organization-scoped identity. The oldest ESKOM point and the oldest PHEWB point are picked
    // by `created_at, id`, and rows seeded in one transaction share `created_at`, so the pick
    // varies with the seed's uuids — and when both picks carry `kw`, the LEGITIMATE binding
    // matched a `pointKey` clause here and reddened a docs-only PR (#484, 2026-09-18).
    resolved.some((point) => point.pointId === phewbPointId || point.assetId === phewbAssetId),
    "no PHEWB pointId/assetId may appear in an ESKOM-scoped read",
  ).toBe(false);
  expect(
    resolved.some((point) => point.pointId === legitEskomPointId),
    "the legitimate ESKOM binding must still resolve — a guard that refuses everything is its own defect",
  ).toBe(true);
}

/**
 * Negative, FLEET pool — the assertion that fails if the explicit organization predicate is
 * dropped, and the only one that does. `bms_fleet` holds `BYPASSRLS`, so `asset_points`' own
 * policy filters NOTHING on this connection; the predicate inside `resolveBoundPoints` is the
 * only thing standing between this call and a foreign `assetId` leaving the module.
 */
export async function assertFleetPoolExcludesForeignBinding(
  fleetDb: BmsDb,
  eskomOrgId: string,
  widgetId: string,
  legitEskomPointId: string,
  phewbAssetId: string,
  phewbPointId: string,
): Promise<void> {
  const resolved = await resolveBoundPoints(fleetDb, eskomOrgId, [widgetId]);
  expect(
    // Same identity rule as the tenant case above — see its comment.
    resolved.some((point) => point.pointId === phewbPointId || point.assetId === phewbAssetId),
    "on the BYPASSRLS fleet pool, no PHEWB pointId/assetId may appear — the explicit " +
      "organization predicate is the only control here, since RLS supplies none",
  ).toBe(false);
  expect(
    resolved.some((point) => point.pointId === legitEskomPointId),
    "the legitimate ESKOM binding must still resolve on the fleet pool too",
  ).toBe(true);
}

/** Positive, both pools: a legitimate same-organization binding resolves with the correct
 * assetId/assetCode/pointKey — proven independently on each pool. `assetCode` (ADR 0069) rides
 * the same `bms.assets` join and the same predicate, so the label is proven where the id is. */
export async function assertLegitimateBindingResolvesOnBothPools(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  eskomOrgId: string,
  widgetId: string,
  legitEskomPointId: string,
  expectedAssetId: string,
  expectedPointKey: string,
  expectedAssetCode: string,
): Promise<void> {
  const onTenant = await withTenant(tenantDb, eskomOrgId, (tx) =>
    resolveBoundPoints(tx, eskomOrgId, [widgetId]),
  );
  const tenantHit = onTenant.find((point) => point.pointId === legitEskomPointId);
  expect(tenantHit, "the legitimate binding must resolve on the tenant pool").toBeDefined();
  expect(tenantHit?.assetId).toBe(expectedAssetId);
  expect(tenantHit?.pointKey).toBe(expectedPointKey);
  expect(tenantHit?.assetCode, "ADR 0069 — the joined assets.code on the tenant pool").toBe(expectedAssetCode);

  const onFleet = await resolveBoundPoints(fleetDb, eskomOrgId, [widgetId]);
  const fleetHit = onFleet.find((point) => point.pointId === legitEskomPointId);
  expect(fleetHit, "the legitimate binding must resolve on the fleet pool").toBeDefined();
  expect(fleetHit?.assetId).toBe(expectedAssetId);
  expect(fleetHit?.pointKey).toBe(expectedPointKey);
  expect(fleetHit?.assetCode, "ADR 0069 — the joined assets.code on the fleet pool").toBe(expectedAssetCode);
}

/**
 * Write direction: a foreign `pointId` is refused with a 400 naming a count and NO foreign id
 * (§9.6); a same-organization one is accepted. Run inside a real `withTenant` transaction, the
 * same shape the PUT :id/widgets handler uses.
 */
export async function assertWriteGuardRefusesForeignPointOnly(
  tenantDb: BmsDb,
  eskomOrgId: string,
  legitEskomPointId: string,
  phewbPointId: string,
): Promise<void> {
  await withTenant(tenantDb, eskomOrgId, async (tx) => {
    await expect(
      assertBoundPointsInOrganization(tx, eskomOrgId, [legitEskomPointId, phewbPointId]),
    ).rejects.toMatchObject({ status: 400 });

    try {
      await assertBoundPointsInOrganization(tx, eskomOrgId, [phewbPointId]);
      throw new Error("expected assertBoundPointsInOrganization to refuse a foreign pointId");
    } catch (err) {
      const message = String((err as { message?: unknown }).message ?? err);
      expect(message).not.toContain(phewbPointId);
    }

    await expect(
      assertBoundPointsInOrganization(tx, eskomOrgId, [legitEskomPointId]),
    ).resolves.toBeUndefined();
  });
}
