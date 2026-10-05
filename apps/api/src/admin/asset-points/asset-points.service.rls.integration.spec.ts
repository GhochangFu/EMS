import { ConflictException } from "@nestjs/common";
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
  /**
   * `F4.211` — two active catalog keys no other case maps onto
   * `mappingAssetId`, so the duplicate-key cases own every row they write.
   */
  freeKeys: readonly [string, string];
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

function expectConflict(err: unknown, expected: string): void {
  expect(
    err instanceof ConflictException && err.message === expected,
    `F4.211: expected ConflictException "${expected}"; got ` +
      `${(err as Error | null)?.constructor?.name} (code ${(err as { code?: unknown } | null)?.code}, ` +
      `constraint ${(err as { constraint?: unknown } | null)?.constraint}) "${(err as Error | null)?.message}"`,
  ).toBe(true);
}

/** Deletes the rows a duplicate-key case wrote on `mappingAssetId`, audit rows first. */
async function removeMappedKeys(ctx: RlsFixtures, keys: readonly string[]): Promise<void> {
  await ctx.ownerPool.query(
    `DELETE FROM bms.audit_log WHERE entity_id IN
       (SELECT id FROM bms.asset_points WHERE asset_id = $1 AND point_key = ANY($2))`,
    [ctx.mappingAssetId, keys],
  );
  await ctx.ownerPool.query(
    "DELETE FROM bms.asset_points WHERE asset_id = $1 AND point_key = ANY($2)",
    [ctx.mappingAssetId, keys],
  );
}

/**
 * `F4.211` — a second mapping of one key onto one asset is a 409 naming the
 * key (`asset_points_asset_id_point_key_unique`), not pg's `23505` as a 500.
 * The source keys differ, so only the point-key index can fire.
 */
export async function assertCreateADuplicatePointKeyIsA409(
  ctx: RlsFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const [key] = ctx.freeKeys;
  try {
    await ctx.pointsSvc.create(jwt, {
      assetId: ctx.mappingAssetId,
      pointKey: key,
      sourceDataKey: `F4211/${key}/A`,
    });
    const err = await ctx.pointsSvc
      .create(jwt, { assetId: ctx.mappingAssetId, pointKey: key, sourceDataKey: `F4211/${key}/B` })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expectConflict(err, `Point "${key}" is already mapped on this asset`);
  } finally {
    await removeMappedKeys(ctx, [key]);
  }
}

/**
 * `F4.211` — an update to a source key another point on the asset reads is a
 * 409 naming the source key (`asset_points_asset_source_key_idx`). The point
 * keys differ, so only the source-key index can fire; with the create case
 * above, a swapped constraint mapping reddens both.
 */
export async function assertUpdateToATakenSourceKeyIsA409(
  ctx: RlsFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const [firstKey, secondKey] = ctx.freeKeys;
  try {
    const first = await ctx.pointsSvc.create(jwt, {
      assetId: ctx.mappingAssetId,
      pointKey: firstKey,
      sourceDataKey: `F4211/${firstKey}/SRC`,
    });
    const second = await ctx.pointsSvc.create(jwt, {
      assetId: ctx.mappingAssetId,
      pointKey: secondKey,
      sourceDataKey: `F4211/${secondKey}/SRC`,
    });
    const err = await ctx.pointsSvc
      .update(jwt, second.id, { sourceDataKey: first.sourceDataKey })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expectConflict(
      err,
      `Source key "${first.sourceDataKey}" is already used by another point on this asset`,
    );
  } finally {
    await removeMappedKeys(ctx, [firstKey, secondKey]);
  }
}
