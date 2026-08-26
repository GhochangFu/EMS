import { expect } from "vitest";
import pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { AssetPointCalcOverrideService } from "./asset-point-calc-override.service";
import type { AssetPointsAdminService } from "./asset-points.service";

/**
 * `E7.1b` — the org-stamping proof the two `asset_points` writers never had
 * against real, non-owner roles.
 *
 * `asset_points`, `assets` and `template_points` gain `organization_id` + a
 * `tenant_isolation` policy + `FORCE` in migration `0047`; until then
 * `withTenant` sets a GUC no policy reads. What this proves now is the funnel
 * logic: both writers derive `organization_id` from the asset and stamp it, and
 * the wrapped writes survive a real `bms_tenant` connection. The `WITH CHECK`
 * refusal proof lands with the policy in Task 4.
 *
 * Two writers, two assertions:
 * - `AssetPointsAdminService.create` — the telemetry-mapping path — stamps the
 *   org and its lifecycle (update/deactivate/reactivate) survives real RLS.
 * - `AssetPointCalcOverrideService.setOverride` — the ONLY place a write creates
 *   an `asset_points` row outside `AssetPointsAdminService` — stamps the org on
 *   the row it eagerly creates (decision 7). This is the assertion most likely
 *   to catch a missed `organization_id` in that second insert.
 */
export type RlsFixtures = {
  pointsSvc: AssetPointsAdminService;
  overrideSvc: AssetPointCalcOverrideService;
  ownerPool: pg.Pool;
  organizationId: string;
  /** A hand-created asset in the org, for the mapping path. */
  mappingAssetId: string;
  /** An active catalog point key in the org, mappable onto `mappingAssetId`. */
  catalogPointKey: string;
  /** A templated asset in the org whose template declares `derivedKey`. */
  templatedAssetId: string;
  /** A derived template point on that asset, for the override path. */
  derivedKey: string;
};

async function orgOfPoint(ownerPool: pg.Pool, assetPointId: string): Promise<string | null> {
  const [row] = (
    await ownerPool.query<{ organization_id: string | null }>(
      "SELECT organization_id FROM bms.asset_points WHERE id = $1",
      [assetPointId],
    )
  ).rows;
  return row?.organization_id ?? null;
}

/**
 * The mapping writer stamps the org derived from the asset (`asset_id → assets`,
 * the `0046` path — never from the point request), and the wrapped
 * create/update/deactivate/reactivate lifecycle survives a real `bms_tenant`
 * connection.
 */
export async function assertMappingCreateStampsOrgUnderRealRls(
  ctx: RlsFixtures,
  jwt: JwtPayload,
): Promise<string> {
  const { pointsSvc, ownerPool, organizationId, mappingAssetId, catalogPointKey } = ctx;

  const created = await pointsSvc.create(jwt, {
    assetId: mappingAssetId,
    pointKey: catalogPointKey,
    sourceDataKey: `E71B/${catalogPointKey}/RAW`,
  });
  expect(created.active).toBe(true);

  // The DTO exposes `organizationCode`, not the id — assert the stamped column
  // directly on the owner connection (`asset_points` has no policy yet).
  expect(await orgOfPoint(ownerPool, created.id)).toBe(organizationId);

  const updated = await pointsSvc.update(jwt, created.id, { sensorCode: "E71B-SENSOR" });
  expect(updated.sensorCode).toBe("E71B-SENSOR");
  // The org is fixed for the life of the row: it never appears in an update
  // body, and the update must not disturb it.
  expect(await orgOfPoint(ownerPool, created.id)).toBe(organizationId);

  const deactivated = await pointsSvc.deactivate(jwt, created.id);
  expect(deactivated.active).toBe(false);

  const reactivated = await pointsSvc.reactivate(jwt, created.id);
  expect(reactivated.active).toBe(true);
  return created.id;
}

/**
 * `setOverride` on a derived point that has no `asset_points` row yet eagerly
 * creates one (decision 7) and stamps it with the asset's org — the second
 * insert path that would otherwise write a NULL org and fail the `0047` policy.
 */
export async function assertOverrideEagerCreateStampsOrgUnderRealRls(
  ctx: RlsFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { overrideSvc, ownerPool, organizationId, templatedAssetId, derivedKey } = ctx;

  await overrideSvc.setOverride(jwt, templatedAssetId, derivedKey, {
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: 45,
    maxInputAgeSeconds: null,
  });

  const [row] = (
    await ownerPool.query<{ organization_id: string | null; source_kind: string }>(
      "SELECT organization_id, source_kind FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2",
      [templatedAssetId, derivedKey],
    )
  ).rows;
  expect(row?.source_kind).toBe("computed");
  expect(row?.organization_id).toBe(organizationId);
}
