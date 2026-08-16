import type {
  AutomationRuleAction,
  AutomationRuleCategory,
  AutomationRuleCondition,
  AutomationRuleOperator,
  AutomationRuleType,
  RuleExecutionStatus,
} from "@bms/shared";

/**
 * Shared row and value shapes for the rules module.
 *
 * These were private to `rules.service.ts` until the §4.5 split; they are
 * exported now only because the extracted pure helpers need them. Nothing
 * outside `src/rules/` should import them.
 */

/** One `bms.automation_rules` row joined to its asset, as the service reads it. */
export type RuleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  ruleType: string;
  source: string;
  enabled: boolean;
  assetId: string | null;
  assetCode: string | null;
  assetName: string | null;
  siteName: string | null;
  /**
   * `string`, because this describes what the *driver* hands back: Drizzle
   * types the column `varchar`.
   *
   * What bounds the value is `assets_domain_fk` (migration `0029`), a foreign
   * key into `bms.asset_domains` — an **open** set that a domain pack extends
   * with an `INSERT`, not a fixed list. `AssetDomain` is itself a `string`
   * since ADR 0031 Amendment 1, so nothing here is narrowing a union.
   */
  assetDomain: string | null;
  pointKey: string | null;
  operator: string | null;
  thresholdValue: number | null;
  severity: string | null;
  condition: unknown;
  action: unknown;
  lastEvaluatedAt: Date | null;
  lifecycleStatus: string;
  publishedAt: Date | null;
  archivedAt: Date | null;
  duplicatedFromRuleId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Outcome of evaluating one rule, before it is written to `rule_executions`. */
export type EvaluationResult = {
  status: RuleExecutionStatus;
  matched: boolean;
  observedValue: number | null;
  message: string;
  trace: Record<string, unknown>;
};

/** A validated draft, ready to be inserted or updated. */
export type RuleDraftValues = {
  code?: string;
  name: string;
  description: string | null;
  category: AutomationRuleCategory;
  ruleType: AutomationRuleType;
  assetId: string | null;
  pointKey: string | null;
  operator: AutomationRuleOperator | null;
  thresholdValue: number | null;
  severity: string | null;
  condition: AutomationRuleCondition;
  action: AutomationRuleAction;
};
