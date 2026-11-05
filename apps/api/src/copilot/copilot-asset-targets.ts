import { and, eq } from "drizzle-orm";

import { assetGroupMembers, assetGroups, assetPoints, assets, type BmsDb, locations, rtus } from "@bms/db";
import { assetLabel } from "@bms/shared";

import { type BmsTx, withTenant } from "../database/tenant-context";

/**
 * `F4.316` PR 7 (ADR 0111 decision 5, ruling Q4) — the resolver's reads that
 * name an asset on a card, kept out of `copilot-target-resolver.ts` for the
 * AGENTS.md §4.5 line cap (the `copilot-calc-point-targets.ts` shape). Every
 * one names the asset by its label — `<code> · <RTU>`, else
 * `<code> · <location>` — through the same two LEFT JOINs, which add no
 * predicate: each read keeps its tenant transaction and organization filter.
 */

/** An `asset` target as the resolver's `Found` holds it. */
export type AssetTarget = {
  organizationId: string;
  /** The asset label, so a card names the asset by it (Q4). */
  name: string;
  /** The pinned template version, or `null` (`F4.311`, Amendment 11 G2). */
  templateId: string | null;
  /** The asset's point keys now, the refs a formula may name. */
  pointKeys: string[];
};

/** The label columns: the asset's code, its RTU's display name and its location's name. */
const LABEL_COLUMNS = { code: assets.code, rtuName: rtus.displayName, locationName: locations.name } as const;

const labelOf = (row: { code: string; rtuName: string | null; locationName: string | null }): string =>
  assetLabel({ code: row.code, rtuName: row.rtuName, locationName: row.locationName });

/**
 * The asset `id` of `organizationId`, read on the caller's tenant transaction with the explicit
 * organization filter; an asset with no RTU is still found (and named by its location). `null`
 * when the asset is not there.
 */
export async function readAssetTarget(tx: BmsTx, id: string, organizationId: string): Promise<AssetTarget | null> {
  const [row] = await tx
    .select({ ...LABEL_COLUMNS, templateId: assets.templateId })
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
  return { organizationId, name: labelOf(row), templateId: row.templateId, pointKeys: points.map((point) => point.pointKey) };
}

/**
 * `F4.278` / `F4.281` / `F4.284`: the asset a rule, maintenance schedule or work-order create
 * names, in the first allowed organization that has it — its organization and its label.
 */
export async function findConfigurationAsset(
  tenantDb: BmsDb,
  assetId: string,
  allowed: readonly string[],
): Promise<{ organizationId: string; name: string; assetId: string } | null> {
  for (const organizationId of allowed) {
    const [row] = await withTenant(tenantDb, organizationId, (tx) =>
      tx
        .select(LABEL_COLUMNS)
        .from(assets)
        .leftJoin(rtus, eq(rtus.id, assets.rtuId))
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .where(and(eq(assets.id, assetId), eq(assets.organizationId, organizationId)))
        .limit(1),
    );
    if (row) return { organizationId, name: labelOf(row), assetId };
  }
  return null;
}

/**
 * An asset-group membership `id` of `organizationId` (a membership has no organization column;
 * its group's is the row's), named `<asset label> in <group>`, with the group's site.
 */
export async function readAssetGroupMemberTarget(
  tx: BmsTx,
  id: string,
  organizationId: string,
): Promise<{ organizationId: string; name: string; locationId: string } | null> {
  const [row] = await tx
    .select({ ...LABEL_COLUMNS, group: assetGroups.name, locationId: assetGroups.locationId })
    .from(assetGroupMembers)
    .innerJoin(assetGroups, eq(assetGroups.id, assetGroupMembers.assetGroupId))
    .innerJoin(assets, eq(assets.id, assetGroupMembers.assetId))
    .leftJoin(rtus, eq(rtus.id, assets.rtuId))
    .leftJoin(locations, eq(locations.id, assets.locationId))
    .where(and(eq(assetGroupMembers.id, id), eq(assetGroups.organizationId, organizationId)))
    .limit(1);
  return row ? { organizationId, name: `${labelOf(row)} in ${row.group}`, locationId: row.locationId } : null;
}
