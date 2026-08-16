import type {
  AssetDomain,
  AutomationRuleAction,
  AutomationRuleCategory,
  AutomationRuleCondition,
  AutomationRuleLifecycleStatus,
  AutomationRuleOperator,
  AutomationRuleType,
  RuleListItem,
} from "@bms/shared";

import type { RuleDraftBody, RuleUpdateBody } from "./rules.schema";
import type { RuleRow } from "./rules.types";

/**
 * Pure coercion between the `automation_rules` row shape, the wire DTOs, and
 * the API response.
 *
 * `condition` and `action` are `jsonb`, so the database hands them back as
 * `unknown`. Everything here narrows that without touching the database, which
 * is the whole reason it lives outside `RulesService`.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows a stored `condition` blob.
 *
 * Falls back to `{ window: "latest" }` rather than throwing: a rule row that
 * predates a schema change should still list and evaluate rather than break the
 * whole rules page.
 */
export function asCondition(value: unknown): AutomationRuleCondition {
  if (isRecord(value) && value.window === "latest") {
    return {
      window: "latest",
      unit: typeof value.unit === "string" ? value.unit : undefined,
    };
  }
  if (
    isRecord(value) &&
    Array.isArray(value.days) &&
    typeof value.startTime === "string" &&
    typeof value.endTime === "string"
  ) {
    return {
      days: value.days.filter((item): item is string => typeof item === "string"),
      startTime: value.startTime,
      endTime: value.endTime,
    };
  }
  return { window: "latest" };
}

/** Narrows a stored `action` blob, defaulting to the inert trace-only action. */
export function asAction(value: unknown): AutomationRuleAction {
  if (
    isRecord(value) &&
    (value.type === "notify" || value.type === "review" || value.type === "trace_only") &&
    typeof value.target === "string"
  ) {
    return { type: value.type, target: value.target };
  }
  return { type: "trace_only", target: "Operations" };
}

/** Narrows a stored execution `trace` blob; arrays and scalars become `null`. */
export function asTrace(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** Projects a joined rule row into the API list shape. */
export function mapRuleRow(row: RuleRow): RuleListItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category as AutomationRuleCategory,
    ruleType: row.ruleType as AutomationRuleType,
    // `phe_alarm_seed` belongs in this cast: migration 0022 writes it on 48
    // rows and `ruleListItemSchema` declares it. Omitting it asserted a type
    // the data has always contradicted — harmless only because a cast is not a
    // check and the response schema accepted the real value anyway. ADR 0031
    // makes `source = 'phe_alarm_seed'` migration 0029's filter key, so the
    // value is load-bearing rather than incidental.
    source: row.source as "operator_rule" | "simulator_threshold" | "phe_alarm_seed",
    enabled: row.enabled,
    assetId: row.assetId,
    assetCode: row.assetCode,
    assetName: row.assetName,
    siteName: row.siteName,
    assetDomain: row.assetDomain as AssetDomain | null,
    pointKey: row.pointKey,
    operator: row.operator as AutomationRuleOperator | null,
    thresholdValue: row.thresholdValue,
    severity: row.severity,
    lifecycleStatus: row.lifecycleStatus as AutomationRuleLifecycleStatus,
    condition: asCondition(row.condition),
    action: asAction(row.action),
    lastEvaluatedAt: row.lastEvaluatedAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    duplicatedFromRuleId: row.duplicatedFromRuleId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Rebuilds the draft body a stored rule would have been created from.
 *
 * **The cast used to be narrowing a value that genuinely did not fit.**
 * Migration 0022 wrote `category = 'electrical'` on the PHE pilot's 48 rules,
 * which no operator could author, and neither caller (`mergeRuleDraft`,
 * `validateRuleDraft`) re-parses the category — they check duplicate codes and
 * asset existence only. So an update to a PHE rule carried `electrical`
 * straight back to the row, which was the right behaviour: editing a threshold
 * must not silently reclassify a rule.
 *
 * ADR 0031 removed the mismatch at the source. `electrical` is a plant domain,
 * it lives on the asset, migration `0029` moved those rows to `safety`, and
 * `automation_rules_category_check` bounds the column to the same four values
 * this type accepts. **The cast still stands because Drizzle types the column
 * `varchar`** — it is narrowing `string`, not narrowing a real union, and the
 * database is what guarantees it. The absence of re-parsing therefore stopped
 * being load-bearing; it is now merely harmless.
 */
export function ruleBodyFromRow(row: RuleRow): RuleDraftBody {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category as AutomationRuleCategory,
    ruleType: row.ruleType as AutomationRuleType,
    assetId: row.assetId,
    pointKey: row.pointKey,
    operator: row.operator as AutomationRuleOperator | null,
    thresholdValue: row.thresholdValue,
    severity: row.severity as "info" | "warning" | "critical" | null,
    condition: asCondition(row.condition),
    action: asAction(row.action),
  };
}

/**
 * Applies a partial update over the stored rule.
 *
 * The per-field `=== undefined` checks are deliberate and not redundant with the
 * spread: an explicit `null` clears the field, while an absent key keeps the
 * current value. A plain spread would treat both the same way.
 */
export function mergeRuleDraft(row: RuleRow, dto: RuleUpdateBody): RuleDraftBody {
  const current = ruleBodyFromRow(row);
  return {
    ...current,
    ...dto,
    description: dto.description === undefined ? current.description : dto.description,
    assetId: dto.assetId === undefined ? current.assetId : dto.assetId,
    pointKey: dto.pointKey === undefined ? current.pointKey : dto.pointKey,
    operator: dto.operator === undefined ? current.operator : dto.operator,
    thresholdValue:
      dto.thresholdValue === undefined ? current.thresholdValue : dto.thresholdValue,
    severity: dto.severity === undefined ? current.severity : dto.severity,
    condition: dto.condition === undefined ? current.condition : dto.condition,
    action: dto.action === undefined ? current.action : dto.action,
  };
}
