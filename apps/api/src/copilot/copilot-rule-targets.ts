import { and, eq, inArray } from "drizzle-orm";

import { assets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { RULE_BATCH_MAX_ROWS } from "@bms/shared";

import { withTenant } from "../database/tenant-context";

/**
 * `F4.289` (ADR 0099 Amendment 9 E3) — the read behind the resolver's
 * `ruleBatch` target, kept out of `copilot-target-resolver.ts` for the
 * AGENTS.md §4.5 line cap (the `copilot-operations-targets.ts` shape).
 *
 * The rows must be a non-empty array of at most `RULE_BATCH_MAX_ROWS` objects,
 * each with a string `assetId`; a body that is not is refused before any read.
 * The distinct assets are read under `withTenant`, with an explicit
 * organization filter, in each allowed organization in turn: the first that
 * holds any of them must hold all of them, or the batch is refused (`null`) —
 * the route refuses a batch on two organizations' assets too. The gate (the
 * `configuration` role class, every asset in the read scope) stays in the
 * resolver.
 */
export async function findRuleBatch(
  tenantDb: BmsDb,
  rows: unknown,
  allowed: readonly string[],
): Promise<{ organizationId: string; assetIds: string[] } | null> {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > RULE_BATCH_MAX_ROWS) return null;
  const ids = rows.map((row) => (typeof row === "object" && row !== null ? (row as { assetId?: unknown }).assetId : undefined));
  if (ids.some((id) => typeof id !== "string")) return null;
  const assetIds = [...new Set(ids as string[])];
  for (const organizationId of allowed) {
    const found = await withTenant(tenantDb, organizationId, (tx) =>
      tx
        .select({ id: assets.id })
        .from(assets)
        .where(and(inArray(assets.id, assetIds), eq(assets.organizationId, organizationId))),
    );
    if (found.length === 0) continue;
    return found.length === assetIds.length ? { organizationId, assetIds } : null;
  }
  return null;
}
