import { desc, eq } from "drizzle-orm";

import { assets, automationRules } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";
import type { RuleRow } from "./rules.types";

/**
 * The `automation_rules ⋈ assets` list projection, shared by `selectRuleRows`
 * (all rows) and `selectRuleRowById` (one row). The rule's own org and its
 * asset's org both ride the LEFT JOIN; the asset columns are null exactly when
 * the rule targets no asset.
 */
const ruleRowColumns = {
  id: automationRules.id,
  code: automationRules.code,
  name: automationRules.name,
  description: automationRules.description,
  category: automationRules.category,
  ruleType: automationRules.ruleType,
  source: automationRules.source,
  enabled: automationRules.enabled,
  organizationId: automationRules.organizationId,
  assetOrganizationId: assets.organizationId,
  assetId: automationRules.assetId,
  assetCode: assets.code,
  assetName: assets.name,
  siteName: assets.siteName,
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
} as const;

/**
 * `E7.1b` §4.5 extraction — the `automation_rules ⋈ assets` projection and the
 * asset-scope post-filter, lifted out of `RulesService` so the read-routing
 * changes fit under the 1000-line cap. Both are pure over the passed handle.
 *
 * `selectRuleRows` takes a `BmsTx`, so `listRules` runs it inside
 * `withReadScope` (a single-organization actor under `withTenant`, the 0047
 * FORCE policy scoping the read — decision 1; an admin or multi-organization
 * actor on `fleetDb` — decisions 2/3), while the cross-org sweep and the
 * pre-write current-row read wrap it in `fleetDb.transaction`. `selectRuleRowById`
 * serves the E7.1c post-write read-back on the write's own tenant transaction.
 */
export async function selectRuleRows(db: BmsTx): Promise<RuleRow[]> {
  return db
    .select(ruleRowColumns)
    .from(automationRules)
    .leftJoin(assets, eq(automationRules.assetId, assets.id))
    .orderBy(desc(automationRules.enabled), automationRules.category, automationRules.name);
}

/**
 * `E7.1c` — the single-row read for a post-write read-back. Called on the write's
 * own `withTenant` transaction (not `fleetDb`): the just-written rule is in
 * `current_org`, so the `0047` FORCE policy resolves it under the org GUC rather
 * than the unconditional fleet pool (ADR 0043 decision 1). Returns `undefined`
 * if no such rule is visible — the caller turns that into a `NotFoundException`.
 *
 * Decision-1 consequence for a **diverged** rule (its `organization_id` differs
 * from its asset's org — reachable only when a global admin re-targets a rule's
 * `asset_id` across organizations, the latent divergence `updateRule` leaves as a
 * known state): the LEFT JOIN to the FORCE-policied `assets` resolves the asset
 * only when it is in `current_org`, so a foreign-org asset yields null
 * `assetCode`/`assetName`/`siteName`/`assetDomain` in the write-response — the
 * same nulls the single-org LIST path already returns for it, not the populated
 * fields the pre-E7.1c fleet read-back gave. Refusing the cross-org re-target
 * belongs to the org-identity policy (E7.1c decision 7 / the human), not here.
 */
export async function selectRuleRowById(db: BmsTx, id: string): Promise<RuleRow | undefined> {
  const [row] = await db
    .select(ruleRowColumns)
    .from(automationRules)
    .leftJoin(assets, eq(automationRules.assetId, assets.id))
    .where(eq(automationRules.id, id))
    .limit(1);
  return row;
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
