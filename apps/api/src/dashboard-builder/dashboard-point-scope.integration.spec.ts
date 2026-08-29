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
 * not appear, and no PHEWB `assetId`/`pointKey` anywhere in the result. `asset_points`'s own
 * `tenant_isolation` policy is what filters it here — this test alone would still pass with
 * this file's explicit predicate deleted, because the policy masks its absence.
 */
export async function assertTenantPoolExcludesForeignBinding(
  tenantDb: BmsDb,
  eskomOrgId: string,
  widgetId: string,
  legitEskomPointId: string,
  phewbAssetId: string,
  phewbPointKey: string,
): Promise<void> {
  const resolved = await withTenant(tenantDb, eskomOrgId, (tx) =>
    resolveBoundPoints(tx, eskomOrgId, [widgetId]),
  );
  expect(
    resolved.some((point) => point.assetId === phewbAssetId || point.pointKey === phewbPointKey),
    "no PHEWB assetId/pointKey may appear in an ESKOM-scoped read",
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
  phewbPointKey: string,
): Promise<void> {
  const resolved = await resolveBoundPoints(fleetDb, eskomOrgId, [widgetId]);
  expect(
    resolved.some((point) => point.assetId === phewbAssetId || point.pointKey === phewbPointKey),
    "on the BYPASSRLS fleet pool, no PHEWB assetId/pointKey may appear — the explicit " +
      "organization predicate is the only control here, since RLS supplies none",
  ).toBe(false);
  expect(
    resolved.some((point) => point.pointId === legitEskomPointId),
    "the legitimate ESKOM binding must still resolve on the fleet pool too",
  ).toBe(true);
}

/** Positive, both pools: a legitimate same-organization binding resolves with the correct
 * assetId/pointKey/unit — proven independently on each pool. */
export async function assertLegitimateBindingResolvesOnBothPools(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  eskomOrgId: string,
  widgetId: string,
  legitEskomPointId: string,
  expectedAssetId: string,
  expectedPointKey: string,
): Promise<void> {
  const onTenant = await withTenant(tenantDb, eskomOrgId, (tx) =>
    resolveBoundPoints(tx, eskomOrgId, [widgetId]),
  );
  const tenantHit = onTenant.find((point) => point.pointId === legitEskomPointId);
  expect(tenantHit, "the legitimate binding must resolve on the tenant pool").toBeDefined();
  expect(tenantHit?.assetId).toBe(expectedAssetId);
  expect(tenantHit?.pointKey).toBe(expectedPointKey);

  const onFleet = await resolveBoundPoints(fleetDb, eskomOrgId, [widgetId]);
  const fleetHit = onFleet.find((point) => point.pointId === legitEskomPointId);
  expect(fleetHit, "the legitimate binding must resolve on the fleet pool").toBeDefined();
  expect(fleetHit?.assetId).toBe(expectedAssetId);
  expect(fleetHit?.pointKey).toBe(expectedPointKey);
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
