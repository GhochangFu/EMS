import { automationRuleOperatorSchema } from "@bms/shared/contracts";
import type { AutomationRuleOperator, TemplateAlarm } from "@bms/shared";

import type { PointGridProblem } from "./template-points-grid";

/**
 * The Alarms tab's form rules (`F2.5`, ADR 0038 Unit 9e).
 *
 * **This is class-level authoring, not a rule builder.** Nothing here creates a
 * `bms.automation_rules` row, and nothing should read as though it might: a
 * rule needs `ruleType`, `condition` and `action`, which a template does not
 * carry. `rule-builder-panel.tsx` was read for the form idiom this repository
 * uses — the five operator labels below are its wording, so the same comparison
 * does not get two names in one product — and nothing is imported from it.
 *
 * ## Three optional fields, one nested, and none of them may be `null`
 *
 * `templateAlarmSchema` and `alarmPhilosophySchema` are both `.strict()`, and
 * every optional field is `.optional()` rather than `.nullish()`:
 *
 * ```
 * category:   categorySchema.optional()
 * philosophy: alarmPhilosophySchema.optional()
 *   cause / impact / action: z.string().max(2000).optional()
 *   skill:                   skillSchema.optional()
 * ```
 *
 * So an unset field is an **absent key**, exactly as in Unit 9d. `philosophy`
 * adds a second level: when all four of its fields are empty the object itself
 * is omitted, because `philosophy: {}` is a stored object claiming knowledge
 * was recorded when none was.
 *
 * ## `thresholdValue` is where zero and empty must not be confused
 *
 * It is `z.number().finite()`. `Number("")` is `0`, and `0` is a perfectly
 * good threshold — so an empty box cannot be allowed to become one. The row
 * keeps the raw text and `parseThreshold` returns `null` for anything that is
 * not a finite number, which `alarmFormErrors` reports as missing.
 *
 * ## `operator` and `thresholdValue` are a paired optional group (ADR 0019
 * Amendment 2)
 *
 * `templateAlarmSchema` no longer requires either: both absent is an alarm
 * PHILOSOPHY row (a meaning whose limit is set per site at commissioning),
 * both present is a site-independent proto-rule, and one without the other
 * is refused. `row.operator` is `string`, not `AutomationRuleOperator`, for
 * exactly this reason — `""` is the row's "not set" state, matching
 * `row.thresholdValue`'s empty string, and the `<select>` in `alarms-tab.tsx`
 * offers an explicit empty option so an author can express it. `alarmFormErrors`
 * accepts the pair empty, refuses a half-pair in the server's own words, and
 * `buildAlarmPayload` omits both keys rather than sending a guessed value for
 * either.
 */

/** `contentEnvelopeSchema` caps every section at 200 entries. */
export const MAX_ALARM_ENTRIES = 200;

const LIMITS = { code: 64, message: 500, philosophy: 2000 } as const;

/**
 * ADR 0019 Amendment 2 decision 1's wording, matched here so the client
 * refuses a half-pair in the server's own words rather than a paraphrase —
 * `templateAlarmSchema`'s `superRefine` in `asset-templates-content.schema.ts`
 * is the other half of this sentence.
 */
const HALF_PAIR_MESSAGE =
  "An operator with no number, or a number with no comparator, is half a rule — " +
  "set both, or clear both.";

/**
 * The five comparisons, worded as `rule-builder-panel.tsx` words them.
 *
 * Keyed by the operator union rather than listed loosely, so an operator added
 * to `automationRuleOperatorSchema` fails to compile here instead of rendering
 * as a blank option.
 */
export const OPERATOR_LABELS: Record<AutomationRuleOperator, string> = {
  gt: "above",
  gte: "at least",
  lt: "below",
  lte: "at most",
  eq: "equals",
};

export const ALARM_OPERATORS = automationRuleOperatorSchema.options;

/**
 * One editable alarm.
 *
 * `thresholdValue` is text because an empty box and a zero must stay
 * distinguishable. Every optional field is `""` when unset, and
 * `buildAlarmPayload` turns that into an absent key.
 */
export type TemplateAlarmRow = {
  code: string;
  pointKey: string;
  /**
   * `string`, not `AutomationRuleOperator` — `""` is a legitimate "not set"
   * state (ADR 0019 Amendment 2), matching `thresholdValue`'s own empty
   * string. `isOperator` narrows it wherever a real operator is needed.
   */
  operator: string;
  thresholdValue: string;
  severity: string;
  message: string;
  category: string;
  cause: string;
  impact: string;
  action: string;
  skill: string;
};

/**
 * Reads the stored `content.alarms`.
 *
 * Defensive for the reason Unit 9d records: `content` is `z.record(z.unknown())`
 * on the read side, so a row written before ADR 0019 can hold any object at
 * all, and a tab that throws while rendering is worse than one showing an
 * incomplete row the author can repair.
 */
export function alarmRowsFrom(alarms: readonly TemplateAlarm[] | undefined): TemplateAlarmRow[] {
  return (alarms ?? []).map((alarm) => {
    const philosophy = (alarm?.philosophy ?? {}) as Record<string, unknown>;
    return {
      code: text(alarm?.code),
      pointKey: text(alarm?.pointKey),
      // Absent — no `operator` key at all — seeds as "": ADR 0019 Amendment 2
      // made that a legitimate authored state (a pair-absent alarm philosophy
      // row), so the select's new empty option is what should show, not a
      // guessed default. A DEFINED but unrecognised operator (garbled or
      // pre-dating the vocabulary) still falls back to `gt` — the alternative
      // is a select bound to a value it does not offer.
      operator: alarm?.operator === undefined ? "" : isOperator(alarm.operator) ? alarm.operator : "gt",
      // `String(0)` is `"0"`, which is what makes a stored zero survive the
      // round trip. `?? ""` would not — `0 ?? ""` is `0`, but a non-number
      // would reach the input as an object.
      thresholdValue: typeof alarm?.thresholdValue === "number" ? String(alarm.thresholdValue) : "",
      severity: text(alarm?.severity),
      message: text(alarm?.message),
      category: text(alarm?.category),
      cause: text(philosophy.cause),
      impact: text(philosophy.impact),
      action: text(philosophy.action),
      skill: text(philosophy.skill),
    };
  });
}

/** A new alarm. `gt` is the rule builder's default too. */
export function blankAlarmRow(): TemplateAlarmRow {
  return {
    code: "",
    pointKey: "",
    operator: "gt",
    thresholdValue: "",
    severity: "",
    message: "",
    category: "",
    cause: "",
    impact: "",
    action: "",
    skill: "",
  };
}

/**
 * Parses the threshold box.
 *
 * `null` for anything that is not a finite number, **including the empty
 * string** — `Number("")` is `0`, and a threshold of zero is a real value an
 * author may intend. Confusing the two would arm an alarm at zero that nobody
 * asked for.
 *
 * `Infinity` and `NaN` are `null` too, because the schema is `.finite()`.
 */
export function parseThreshold(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** What the author must fix before the alarms can be sent. */
export function alarmFormErrors(
  rows: readonly TemplateAlarmRow[],
  declaredPointKeys: readonly string[],
  vocabularies: {
    severities: readonly string[];
    categories: readonly string[];
    skills: readonly string[];
  },
): PointGridProblem[] {
  const problems: PointGridProblem[] = [];

  if (rows.length > MAX_ALARM_ENTRIES) {
    problems.push({
      row: null,
      field: "alarms",
      message: `A template holds at most ${MAX_ALARM_ENTRIES} alarms. This one has ${rows.length}.`,
    });
  }

  const declared = new Set(declaredPointKeys);
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const push = (field: string, message: string) => problems.push({ row: index, field, message });

    const code = row.code.trim();
    if (code === "") {
      push("code", "An alarm needs a code.");
    } else if (code.length > LIMITS.code) {
      push("code", `A code is at most ${LIMITS.code} characters.`);
    } else {
      const first = seen.get(code);
      if (first !== undefined) {
        push("code", `"${code}" is already used by alarm ${first + 1}. Each code appears once.`);
      } else {
        seen.set(code, index);
      }
    }

    // `collectContentPointRefs` gathers `alarm.pointKey`, and
    // `assertContentRefsResolve` refuses one the template does not declare —
    // with a path into `content` rather than at the alarm.
    const pointKey = row.pointKey.trim();
    if (pointKey === "") {
      push("pointKey", "Choose the point this alarm watches.");
    } else if (!declared.has(pointKey)) {
      push("pointKey", `"${pointKey}" is not a point this template declares.`);
    }

    // `operator` and `thresholdValue` are a paired optional group (ADR 0019
    // Amendment 2). Both empty is an alarm philosophy row — nothing to
    // report. One empty and the other not is a half-pair, refused in the
    // server's own words. Both non-empty falls through to the ordinary
    // "is this actually a number" check — the one place an empty box and a
    // zero must not be confused.
    const thresholdProvided = row.thresholdValue.trim() !== "";
    const operatorProvided = row.operator.trim() !== "";
    if (thresholdProvided !== operatorProvided) {
      push("thresholdValue", HALF_PAIR_MESSAGE);
    } else if (thresholdProvided && parseThreshold(row.thresholdValue) === null) {
      push("thresholdValue", "A threshold must be a number.");
    }

    if (row.severity.trim() === "") {
      push("severity", "Choose a severity.");
    } else if (!vocabularies.severities.includes(row.severity.trim())) {
      // ADR 0032 made severity a row in `bms.alarm_severities`, so the schema
      // checks shape only and the service closes the set. A stored code that
      // was since retired lands here.
      push("severity", `"${row.severity.trim()}" is not a severity this system offers.`);
    }

    const message = row.message.trim();
    if (message === "") {
      push("message", "An alarm needs a message.");
    } else if (message.length > LIMITS.message) {
      push("message", `A message is at most ${LIMITS.message} characters.`);
    }

    // Optional, so empty is fine — but a value must be a live code.
    const category = row.category.trim();
    if (category !== "" && !vocabularies.categories.includes(category)) {
      push("category", `"${category}" is not a category this system offers.`);
    }

    const skill = row.skill.trim();
    if (skill !== "" && !vocabularies.skills.includes(skill)) {
      push("skill", `"${skill}" is not a skill this system offers.`);
    }

    for (const [field, value] of [
      ["cause", row.cause],
      ["impact", row.impact],
      ["action", row.action],
    ] as const) {
      if (value.trim().length > LIMITS.philosophy) {
        push(field, `This is at most ${LIMITS.philosophy} characters.`);
      }
    }
  });

  return problems;
}

/**
 * The `content.alarms` payload.
 *
 * Optional keys are added only when set, because both objects are `.strict()`
 * and every optional field rejects `null`. `philosophy` is omitted entirely
 * when all four of its fields are empty — an empty object would be a record
 * claiming class knowledge was captured when none was.
 *
 * **`operator` and `thresholdValue` are both omitted, or both sent — never
 * one alone** (ADR 0019 Amendment 2). A pair-absent row (both empty) sends
 * neither key, which is what makes it an alarm philosophy row on the wire.
 * A row whose threshold does not parse — including one left empty while its
 * operator is somehow set, which is unreachable behind the disabled Save —
 * omits `thresholdValue` rather than sending `NaN` or papering over it with
 * `?? 0`: a silent zero is an armed alarm nobody asked for, and this is the
 * one field where the safe-looking fallback is the dangerous one.
 */
export function buildAlarmPayload(rows: readonly TemplateAlarmRow[]): TemplateAlarm[] {
  return rows.map((row) => {
    const alarm: TemplateAlarm = {
      code: row.code.trim(),
      pointKey: row.pointKey.trim(),
      severity: row.severity.trim(),
      message: row.message.trim(),
    };

    // Sent independently of each other, deliberately: a half-pair reaching
    // here is unreachable behind the disabled Save, and the safe response to
    // an unreachable state is still "send only what is real", never a guess.
    if (isOperator(row.operator)) {
      alarm.operator = row.operator;
    }
    const parsedThreshold = parseThreshold(row.thresholdValue);
    if (parsedThreshold !== null) {
      alarm.thresholdValue = parsedThreshold;
    }

    const category = row.category.trim();
    if (category !== "") {
      alarm.category = category;
    }

    const philosophy: Record<string, string> = {};
    for (const [field, value] of [
      ["cause", row.cause],
      ["impact", row.impact],
      ["action", row.action],
      ["skill", row.skill],
    ] as const) {
      const trimmed = value.trim();
      if (trimmed !== "") {
        philosophy[field] = trimmed;
      }
    }
    if (Object.keys(philosophy).length > 0) {
      alarm.philosophy = philosophy as TemplateAlarm["philosophy"];
    }

    return alarm;
  });
}

/** Whether the rows differ from what is stored, compared as they would be sent. */
export function alarmsHaveChanged(
  rows: readonly TemplateAlarmRow[],
  stored: readonly TemplateAlarm[] | undefined,
): boolean {
  return (
    JSON.stringify(buildAlarmPayload(rows)) !==
    JSON.stringify(buildAlarmPayload(alarmRowsFrom(stored)))
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isOperator(value: unknown): value is AutomationRuleOperator {
  return typeof value === "string" && (ALARM_OPERATORS as readonly string[]).includes(value);
}
