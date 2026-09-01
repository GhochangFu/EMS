import { and, eq } from "drizzle-orm";

import { assets, locations, pointKeys } from "@bms/db";
import type { BmsDb } from "@bms/db";

export type ResolveCatalogPointKeyResult =
  | { readonly ok: true; readonly unit: string | null; readonly organizationId: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Checks that a point key exists in the fleet-wide catalog and is active — the
 * invariant `AssetPointsAdminService.create`/`update` held privately before
 * this extraction.
 *
 * **`F3.39` — the rejection message changed, and it is the only message this
 * row moves.** It said "the organization catalog"; migration `0057` merged
 * `bms.point_keys` to one fleet-wide list, so that phrase named a thing that
 * no longer exists and would have sent an operator looking for a per-tenant
 * catalog screen. `resolve-catalog-point-key.spec.ts` moves with it.
 *
 * **Non-throwing, deliberately.** The original threw `BadRequestException`,
 * fine for a single mapped-point request. `F1.9` (bulk import) needs to
 * report a bad point key against its own row and keep validating the rest of
 * the file rather than aborting on the first one — see the plan's "row-level,
 * not all-or-nothing". `AssetPointsAdminService` maps `ok:false` back to the
 * same `BadRequestException` it threw before, with the message unchanged, so
 * neither existing test's expected message needs to change.
 */
export async function resolveCatalogPointKey(
  db: BmsDb,
  assetId: string,
  pointKey: string,
): Promise<ResolveCatalogPointKeyResult> {
  const [assetRow] = await db
    .select({ organizationId: locations.organizationId })
    .from(assets)
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!assetRow?.organizationId) {
    return {
      ok: false,
      reason: "Asset must belong to a location with an organization before mapping point keys",
    };
  }

  // `F3.39` / ADR 0051 decision 2: the catalog is fleet-wide, so the lookup is
  // by code alone. The asset's organization is still read above — the caller
  // needs it, and an asset with no organization still cannot map a point.
  //
  // The message keeps saying "the catalog" rather than "the organization
  // catalog", which is now the only accurate description of it.
  const [catalogRow] = await db
    .select({ unit: pointKeys.unit })
    .from(pointKeys)
    .where(and(eq(pointKeys.code, pointKey), eq(pointKeys.active, true)))
    .limit(1);
  if (!catalogRow) {
    return {
      ok: false,
      reason: "Point key must exist in the catalog and be active",
    };
  }

  return { ok: true, unit: catalogRow.unit, organizationId: assetRow.organizationId };
}
