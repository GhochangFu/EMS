import type { AlarmSeverityDto, RuleCategoryDto, RuleListItem } from "@bms/shared";

import { offersNoSeverityOption, severityFromRule } from "../../lib/rule-severity";
import { fieldClass, labelClass } from "../admin/admin-wizard-frame";

/**
 * `F4.278` (ADR 0099 decision 6, Amendment 8) — the field editors of the Rule
 * Engine's wizard (`rule-wizard.tsx`), one per catalog step: Rule, Condition and
 * Action. This file holds the Rule step and the shared helpers; the Condition
 * and Action steps are `rule-condition-step-fields.tsx` and
 * `rule-action-step-fields.tsx` (one exported component per file, AGENTS.md
 * §4.2). The values are the route's own body fields (`ruleDraftBodySchema`),
 * so a copilot `fill_step` lands in the same inputs a person types in.
 */

export type RuleValues = Record<string, unknown>;
export type SetRuleValues = (values: RuleValues) => void;

export const DAY_OPTIONS = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];

/**
 * An edit's starting values, from the rule as listed. The stored severity is
 * narrowed by the shared `severityFromRule` against the vocabulary — never a
 * local substitute (`F4.46`: a substitute gave a severity-less rule one on Save).
 */
export function valuesFromRule(rule: RuleListItem, alarmSeverities: readonly AlarmSeverityDto[]): RuleValues {
  return {
    name: rule.name,
    code: rule.code.toUpperCase(),
    description: rule.description,
    category: rule.category,
    severity: severityFromRule(rule.severity, alarmSeverities),
    ruleType: rule.ruleType,
    assetId: rule.assetId,
    pointKey: rule.pointKey,
    operator: rule.operator,
    thresholdValue: rule.thresholdValue,
    clearHoldSeconds: rule.clearHoldSeconds,
    condition: rule.condition,
    action: rule.action,
  };
}

/** The body text of a string field, or "". */
export function textOf(values: RuleValues, field: string): string {
  const value = values[field];
  return typeof value === "string" ? value : "";
}

/**
 * Review 3 (`F3.10`), kept: a non-numeric, non-blank clear hold is refused at
 * the field. Blank means the 120 s default and is sent as `null`; the 1–86 400 s
 * bound stays the server's, so its message reaches the screen.
 */
export function clearHoldInvalidReason(text: string): string | null {
  const raw = text.trim();
  if (raw === "" || !Number.isNaN(Number(raw))) return null;
  return "Enter the clear hold as a number of seconds, or leave it blank for the default.";
}

/** The values a rule-type switch sets: a threshold watches a point; a time window names days and hours. */
export function valuesForRuleType(values: RuleValues, ruleType: string): RuleValues {
  if (ruleType === "time_window") {
    return {
      ...values,
      ruleType,
      assetId: undefined,
      pointKey: undefined,
      operator: undefined,
      thresholdValue: undefined,
      clearHoldSeconds: undefined,
      condition: { days: WEEKDAYS, startTime: "08:00", endTime: "17:00" },
    };
  }
  return {
    ...values,
    ruleType,
    assetId: "",
    pointKey: "",
    operator: "gt",
    clearHoldSeconds: null,
    condition: { window: "latest" },
  };
}

export function RuleStepFields({
  values,
  setValues,
  ruleCategories,
  alarmSeverities,
}: {
  values: RuleValues;
  setValues: SetRuleValues;
  ruleCategories: readonly RuleCategoryDto[];
  alarmSeverities: readonly AlarmSeverityDto[];
}) {
  const severity = typeof values.severity === "string" ? values.severity : null;
  const ruleType = textOf(values, "ruleType") === "time_window" ? "time_window" : "threshold";
  return (
    <>
      <label className={labelClass}>
        Rule name
        <input
          aria-label="Rule name"
          className={fieldClass}
          value={textOf(values, "name")}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          placeholder="CR Q9 current warning"
        />
      </label>
      <label className={labelClass}>
        Rule code
        <input
          aria-label="Rule code"
          className={fieldClass}
          value={textOf(values, "code")}
          onChange={(e) =>
            setValues({
              ...values,
              code: e.target.value === "" ? undefined : e.target.value.toUpperCase(),
            })
          }
          placeholder="Auto-generated if blank"
        />
      </label>
      <label className={labelClass}>
        Description
        <textarea
          aria-label="Description"
          className={`${fieldClass} min-h-16`}
          value={textOf(values, "description")}
          onChange={(e) =>
            setValues({
              ...values,
              description: e.target.value === "" ? null : e.target.value,
            })
          }
          placeholder="Explain what the operator should review when this rule matches."
        />
      </label>
      <label className={labelClass}>
        Category
        {/* Options from `GET /api/v1/vocabularies`, never a hand-kept copy (§4.8, `F4.44`). */}
        <select
          aria-label="Category"
          className={fieldClass}
          value={textOf(values, "category")}
          onChange={(e) => setValues({ ...values, category: e.target.value })}
        >
          {ruleCategories.map((category) => (
            <option key={category.code} value={category.code}>
              {category.label}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Severity
        {/* `F4.46` / ADR 0032: from the vocabulary; "None" only where none is already the truth. */}
        <select
          aria-label="Severity"
          className={fieldClass}
          value={severity ?? ""}
          onChange={(e) =>
            setValues({
              ...values,
              severity: severityFromRule(e.target.value, alarmSeverities),
            })
          }
        >
          {offersNoSeverityOption(ruleType, severity) && <option value="">None</option>}
          {alarmSeverities.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
