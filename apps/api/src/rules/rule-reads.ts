import { desc, eq } from "drizzle-orm";

import { assets, automationRules } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";
import type { RuleRow } from "./rules.types";

/**
 * `E7.1b` §4.5 extraction — the `automation_rules ⋈ assets` projection and the
 * asset-scope post-filter, lifted out of `RulesService` so the read-routing
 * changes fit under the 1000-line cap. Both are pure over the passed handle.
 *
 * `selectRuleRows` takes a `BmsTx`, so `listRules` runs it inside
 * `withReadScope` (a single-organization actor under `withTenant`, the 0047
 * FORCE policy scoping the read — decision 1; an admin or multi-organization
 * actor on `fleetDb` — decisions 2/3), while the cross-org sweep and the
 * write-path read-back wrap it in `fleetDb.transaction`.
 */
export async function selectRuleRows(db: BmsTx): Promise<RuleRow[]> {
  return db
    .select({
      id: automationRules.id,
      code: automationRules.code,
      name: automationRules.name,
      description: automationRules.description,
      category: automationRules.category,
      ruleType: automationRules.ruleType,
      source: automationRules.source,
      enabled: automationRules.enabled,
      // E7.1b: the rule's own org and its asset's org, both off the leftJoin.
      organizationId: automationRules.organizationId,
      assetOrganizationId: assets.organizationId,
      assetId: automationRules.assetId,
      assetCode: assets.code,
      assetName: assets.name,
      siteName: assets.siteName,
      // ADR 0031's second axis. It rides the LEFT JOIN that was already here
      // for `assetCode`/`assetName`/`siteName` — no extra query, no extra
      // round trip, and null exactly when the rule targets no asset.
      assetDomain: assets.domain,
      pointKey: automationRules.pointKey,
      operator: automationRules.operator,
      thresholdValue: automationRules.thresholdValue,
      severity: automationRules.severity,
      condition: automationRules.condition,
      action: automationRules.action,
      lastEvaluatedAt: automationRules.lastEvaluatedAt,
      lifecycleStatus: automationRules.lifecycleStatus,
      publishedAt: automationRules.publishedAt,
      archivedAt: automationRules.archivedAt,
      duplicatedFromRuleId: automationRules.duplicatedFromRuleId,
      createdAt: automationRules.createdAt,
      updatedAt: automationRules.updatedAt,
    })
    .from(automationRules)
    .leftJoin(assets, eq(automationRules.assetId, assets.id))
    .orderBy(desc(automationRules.enabled), automationRules.category, automationRules.name);
}

/**
 * Narrows rule rows to the caller's readable assets. `null`/`undefined` is the
 * unrestricted admin sentinel. Under `withReadScope` this is the sub-org
 * narrowing on top of the RLS backstop (a location-scoped operator sees only
 * their assets' rules within their org); on the fleet path it is the isolation
 * control itself.
 */
export function filterRuleRowsByAssetIds(
  rows: RuleRow[],
  assetIds?: string[] | null,
): RuleRow[] {
  if (assetIds === null || assetIds === undefined) {
    return rows;
  }
  return rows.filter((row) => row.assetId !== null && assetIds.includes(row.assetId));
}
