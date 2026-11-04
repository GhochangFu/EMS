import { and, eq, inArray, isNull } from "drizzle-orm";

import { assetPoints, assets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { CALC_POINT_BATCH_MAX_ASSETS, type JwtPayload } from "@bms/shared";
import type { CatalogTarget } from "@bms/shared/copilot";

import type { AccessControlService } from "../auth/access-control.service";
import { withTenant } from "../database/tenant-context";

/**
 * `F4.311` PR 3 (ADR 0099 Amendment 11 G2, G3) — the reads behind the
 * resolver's calc-point targets, kept out of `copilot-target-resolver.ts` for
 * the AGENTS.md §4.5 line cap (the `copilot-rule-targets.ts` shape).
 */

/**
 * G3 — the assets of a `calcPointBatch` target. The ids must be a non-empty
 * array of at most `CALC_POINT_BATCH_MAX_ASSETS` strings with none twice (the
 * route refuses a repeated id); a body that is not is refused before any read.
 * The assets are read under `withTenant`, with an explicit organization filter
 * **and `template_id IS NULL`**, in each allowed organization in turn: the
 * first that holds any of them must hold all of them, or the batch is refused
 * (`null`) — the route refuses a pinned asset and a second organization too.
 *
 * `pointKeys` is the keys **every** listed asset has, the refs the batch's one
 * formula may name on all of them. The gate is {@link mayWriteCalcPointBatch}.
 */
export async function findCalcPointBatch(
  tenantDb: BmsDb,
  ids: unknown,
  allowed: readonly string[],
): Promise<{ organizationId: string; assetIds: string[]; pointKeys: string[] } | null> {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > CALC_POINT_BATCH_MAX_ASSETS) return null;
  if (ids.some((id) => typeof id !== "string")) return null;
  const assetIds = ids as string[];
  if (new Set(assetIds).size !== assetIds.length) return null;
  for (const organizationId of allowed) {
    const read = await withTenant(tenantDb, organizationId, async (tx) => {
      const found = await tx
        .select({ id: assets.id })
        .from(assets)
        .where(and(inArray(assets.id, assetIds), eq(assets.organizationId, organizationId), isNull(assets.templateId)));
      if (found.length !== assetIds.length) return { found: found.length, points: [] };
      const points = await tx
        .select({ assetId: assetPoints.assetId, pointKey: assetPoints.pointKey })
        .from(assetPoints)
        .where(and(inArray(assetPoints.assetId, assetIds), eq(assetPoints.organizationId, organizationId)));
      return { found: found.length, points };
    });
    if (read.found === 0) continue;
    if (read.found !== assetIds.length) return null;
    return { organizationId, assetIds, pointKeys: sharedPointKeys(assetIds, read.points) };
  }
  return null;
}

/** The point keys every one of `assetIds` has, in first-seen order. */
function sharedPointKeys(assetIds: readonly string[], points: readonly { assetId: string; pointKey: string }[]): string[] {
  const holders = new Map<string, Set<string>>();
  for (const point of points) {
    const set = holders.get(point.pointKey) ?? new Set<string>();
    set.add(point.assetId);
    holders.set(point.pointKey, set);
  }
  return [...holders].filter(([, set]) => set.size === assetIds.length).map(([key]) => key);
}

/** G3's gate, the batch route's own: `requireMasterDataUser` (a throw is a refusal), then `canManageAsset` on each. */
export async function mayWriteCalcPointBatch(
  access: Pick<AccessControlService, "requireMasterDataUser" | "canManageAsset">,
  user: JwtPayload,
  assetIds: readonly string[],
): Promise<boolean> {
  await access.requireMasterDataUser(user);
  for (const assetId of assetIds) if (!(await access.canManageAsset(user, assetId))) return false;
  return true;
}

/**
 * G2 — whether an `asset` target admits an asset with this `template_id`:
 * `pinned` needs one (an override), `none` needs none (a standalone point);
 * a target without `template`, and any other target kind, admits every row.
 */
export function assetKindAdmits(target: CatalogTarget, templateId: string | null | undefined): boolean {
  if (target.kind !== "asset" || target.template === undefined) return true;
  return target.template === "pinned" ? typeof templateId === "string" : templateId === null;
}
