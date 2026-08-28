import { desc, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { assets, automationRules, ruleExecutions } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";
import type { RuleRow } from "./rules.types";

/**
 * The `rule_executions.trace` projection — **ADR 0046 Amendment 3** (`E8.6`).
 *
 * `evaluateEnabledRules` writes `evaluatedBy: actor.sub`, the evaluating
 * operator's IdP subject, into `trace`. `GET /rules/executions` carries **no
 * role gate at all** — it scopes on `readableAssetIds` — so `operator`,
 * `viewer`, `location_admin` and `asset_group_admin` all read it, an audience
 * strictly wider than the audit log's. The amendment removes the key for every
 * non-`admin` reader.
 *
 * **Redacted in SQL, never in the caller's `.map()`.** The value must not leave
 * Postgres for a reader not entitled to it: a row that crosses the wire can
 * reach a query log or an error dump. A JS-side scrub returns identical bytes,
 * so the response cannot tell you which one you have — which is why
 * `tests/e8.6-trace-evaluator-redaction-guard.test.ts` is static and says so.
 *
 * **Removed, not replaced** (decision 8). Unlike the audit log, where
 * `actorEmail` survives because a ledger must answer *"who changed this"*, a
 * scoped reader here gains nothing in place of the subject: a trace answers
 * *what the rule saw*, and the evaluator is not part of that answer below
 * `admin`.
 *
 * The `jsonb_typeof` guard is the one `audit.service.ts` carries, for the same
 * measured reason: `jsonb - text` raises `cannot delete from scalar` on a
 * string, number or boolean, which would 500 this endpoint **for non-`admin`
 * callers only** and never for the admin who skips the branch. `trace` is
 * unbounded jsonb with no CHECK constraint.
 *
 * It lives here rather than inline in `rules.service.ts` because that file sits
 * at the §4.5 1000-line cap — the hook refused the inline version.
 */
export function traceProjection(redactEvaluatedBy: boolean): SQL<unknown> {
  return redactEvaluatedBy
    ? sql`case when jsonb_typeof(${ruleExecutions.trace}) = 'object'
               then ${ruleExecutions.trace} - 'evaluatedBy'
               else ${ruleExecutions.trace} end`
    : sql`${ruleExecutions.trace}`;
}

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
