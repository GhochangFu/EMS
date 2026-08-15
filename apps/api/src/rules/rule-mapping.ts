import type {
  AuthorableRuleCategory,
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
    source: row.source as "operator_rule" | "simulator_threshold",
    enabled: row.enabled,
    assetId: row.assetId,
    assetCode: row.assetCode,
    assetName: row.assetName,
    siteName: row.siteName,
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
 * **A seeded rule has no honest draft body, and this preserves that rather
 * than papering over it.** Migration 0022 writes `category = 'electrical'` for
 * the PHE pilot's 48 rules, which is *not* authorable — no operator could have
 * created them — so the cast below is narrowing a value that genuinely does not
 * fit the authorable set.
 *
 * It is kept as a cast, and behaviour is unchanged, because that behaviour was
 * checked rather than assumed: the two callers (`mergeRuleDraft` and
 * `validateRuleDraft`) do business validation — duplicate codes, asset
 * existence — and **never re-parse the category**. So an update to a PHE rule
 * carries `electrical` straight back to the row, which is what should happen:
 * editing a rule's threshold must not silently reclassify it.
 *
 * Widening `RuleDraftBody` instead would be the wrong fix — it would let the
 * rule builder offer `electrical`, which `F4.43` deliberately does not. See
 * ADR 0030 Amendment 3.
 */
export function ruleBodyFromRow(row: RuleRow): RuleDraftBody {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category as AuthorableRuleCategory,
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
