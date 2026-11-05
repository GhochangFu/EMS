import { and, eq } from "drizzle-orm";

import { assetPoints, assets, locations, rtus } from "@bms/db";
import { assetLabel } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";

/**
 * `F4.316` PR 7 (ADR 0111 decision 5, ruling Q4) — the resolver's `asset`
 * target read, kept out of `copilot-target-resolver.ts` for the AGENTS.md §4.5
 * line cap (the `copilot-calc-point-targets.ts` shape).
 */

/** An `asset` target as the resolver's `Found` holds it. */
export type AssetTarget = {
  organizationId: string;
  /** The asset label — `<code> · <RTU>`, else `<code> · <location>` — so a card names the asset by it (Q4). */
  name: string;
  /** The pinned template version, or `null` (`F4.311`, Amendment 11 G2). */
  templateId: string | null;
  /** The asset's point keys now, the refs a formula may name. */
  pointKeys: string[];
};

/**
 * The asset `id` of `organizationId`, read on the caller's tenant transaction with the explicit
 * organization filter; the RTU and the location are LEFT JOINs that add no predicate, so an asset
 * with no RTU is still found (and named by its location). `null` when the asset is not there.
 */
export async function readAssetTarget(tx: BmsTx, id: string, organizationId: string): Promise<AssetTarget | null> {
  const [row] = await tx
    .select({ code: assets.code, rtuName: rtus.displayName, locationName: locations.name, templateId: assets.templateId })
    .from(assets)
    .leftJoin(rtus, eq(rtus.id, assets.rtuId))
    .leftJoin(locations, eq(locations.id, assets.locationId))
    .where(and(eq(assets.id, id), eq(assets.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  const points = await tx
    .select({ pointKey: assetPoints.pointKey })
    .from(assetPoints)
    .where(and(eq(assetPoints.assetId, id), eq(assetPoints.organizationId, organizationId)));
  return {
    organizationId,
    name: assetLabel({ code: row.code, rtuName: row.rtuName, locationName: row.locationName }),
    templateId: row.templateId,
    pointKeys: points.map((point) => point.pointKey),
  };
}
