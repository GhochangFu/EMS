/**
 * The formula help list (`F4.314` PR 1, ADR 0038 Amendment 6 decision A1).
 *
 * What a calculated-point formula field admits, per dialect, with one example
 * each and the text a click appends. **Generated** from `@bms/shared`'s
 * calc-dsl constants wherever the grammar keeps one (ruling 2): the functions
 * from `CALC_FUNCTION_ARITY`, the aggregates from `CALC_AGGREGATE_FNS`, the
 * scopes through `calcScopeForms` (a map over `CALC_SCOPE_KINDS`), the
 * window functions from `CALC_WINDOW_FNS`, the window lengths from
 * `CALC_CALENDAR_WINDOWS` / `CALC_ROLLING_UNITS` / `MAX_ROLLING_WINDOW_DAYS`,
 * and the two reference forms from `V2_REFERENCE_FORMS`. Only the operator
 * glyphs (the tokenizer's private `SINGLE_CHAR_TOKENS`) and `hours` (a parser
 * literal) are restated, and `formula-help.spec.ts` holds both to the
 * tokenizer and the parser. Every example is parsed there under its dialect,
 * so a function the grammar gains or loses reddens the spec instead of
 * drifting.
 *
 * Lives under `src/lib` for the reason `formula-editor-rules.ts` gives: the
 * coverage gate reaches nothing above it. Imports no CodeMirror (decision 7,
 * `tests/adr-0038-formula-editor.test.ts`).
 *
 * Reads `calc-reference-forms.ts` (a leaf), never `formula-editor-rules.ts`,
 * which imports this module for `functionCompletions` — so there is no
 * import cycle.
 */
import {
  CALC_AGGREGATE_FNS,
  CALC_CALENDAR_WINDOWS,
  CALC_FUNCTION_ARITY,
  CALC_ROLLING_UNITS,
  CALC_WINDOW_FNS,
  MAX_ROLLING_WINDOW_DAYS,
  isCrossAssetDialect,
  isParameterDialect,
  isWindowDialect,
} from "@bms/shared";
import type { CalcAggregateFn, CalcDialect, CalcFunctionName, CalcWindowFnName } from "@bms/shared";

import { V2_REFERENCE_FORMS, calcScopeForms } from "./calc-reference-forms";
import { V3_PARAMETER_HELP } from "./template-calc-config";

/** One line of the help: what it is, what it says, an example, and what a click appends. */
export type FormulaHelpEntry = {
  group: "operator" | "function" | "reference" | "scope" | "parameter" | "window";
  /** Unique within a dialect's list; the button is named `Insert <label>`. */
  label: string;
  says: string;
  /** Grammar, not prose: the spec parses it under the dialect whose list carries it. */
  example: string;
  /** Appended to the formula when the entry is taken. */
  insert: string;
};

/** The four operators and the parentheses — restated, held by the spec's tokenize check. */
const OPERATORS: readonly FormulaHelpEntry[] = [
  { group: "operator", label: "+", says: "add", example: "{kw_l1} + {kw_l2}", insert: " + " },
  { group: "operator", label: "-", says: "subtract", example: "{kwh_in} - {kwh_out}", insert: " - " },
  { group: "operator", label: "*", says: "multiply", example: "{kw} * 1000", insert: " * " },
  { group: "operator", label: "/", says: "divide", example: "{kwh} / 24", insert: " / " },
  { group: "operator", label: "( )", says: "group", example: "({kw_l1} + {kw_l2}) / 2", insert: "(" },
];

const LOCAL_REFERENCE: FormulaHelpEntry = {
  group: "reference",
  label: "{key}",
  says: "a point of this asset",
  example: "{kw} * 2",
  insert: "{",
};

/**
 * Per function, what it does and one example. Keyed by `CalcFunctionName`, so
 * a function the grammar gains fails to compile here; the list itself is the
 * map over `CALC_FUNCTION_ARITY`.
 */
const FUNCTION_TEACHING: Record<CalcFunctionName, { does: string; example: string }> = {
  abs: { does: "absolute value", example: "abs({kw})" },
  round: { does: "nearest whole number", example: "round({kwh})" },
  min: { does: "smallest argument", example: "min({kw_a}, {kw_b})" },
  max: { does: "largest argument", example: "max({kw_a}, {kw_b})" },
  clamp: { does: "first argument held between the other two", example: "clamp({pf}, 0, 1)" },
};

/** `1 argument`, `3 arguments`, `2 to 20 arguments` — from the arity table. */
function arityText({ min, max }: { min: number; max: number }): string {
  if (min === max) {
    return `${min} argument${min === 1 ? "" : "s"}`;
  }
  return `${min} to ${max} arguments`;
}

const AGGREGATE_TEACHING: Record<CalcAggregateFn, { does: string; example: string }> = {
  sum: { does: "total of a point over a scope", example: "sum({kw} @site)" },
  avg: { does: "average of a point over a scope", example: "avg({kw} @domain('electrical'))" },
};

const WINDOW_TEACHING: Record<CalcWindowFnName, { does: string; example: string }> = {
  sum: { does: "time integral over the window (avg × hours)", example: "sum({kw}, 24h)" },
  avg: { does: "average over the window", example: "avg({kw}, this_week)" },
  min: { does: "lowest value in the window", example: "min({kw}, 15m)" },
  max: { does: "highest value in the window", example: "max({kw}, today)" },
  delta: { does: "last minus first, for cumulative counters", example: "delta({kwh_total}, today)" },
};

function functionEntries(): FormulaHelpEntry[] {
  return (Object.keys(CALC_FUNCTION_ARITY) as CalcFunctionName[]).map((name) => ({
    group: "function",
    label: name,
    says: `${FUNCTION_TEACHING[name].does}, ${arityText(CALC_FUNCTION_ARITY[name])}`,
    example: FUNCTION_TEACHING[name].example,
    insert: `${name}(`,
  }));
}

function crossAssetEntries(): FormulaHelpEntry[] {
  const forms = V2_REFERENCE_FORMS.map(
    (form): FormulaHelpEntry => ({
      group: "reference",
      label: form.form,
      says: form.answers,
      example: form.example,
      insert: form.example,
    }),
  );
  const aggregates = CALC_AGGREGATE_FNS.map(
    (name): FormulaHelpEntry => ({
      group: "function",
      label: name,
      says: AGGREGATE_TEACHING[name].does,
      example: AGGREGATE_TEACHING[name].example,
      insert: `${name}(`,
    }),
  );
  // Every scope `CALC_SCOPE_KINDS` holds, in the completion's own shape; this
  // branch is already gated on `isCrossAssetDialect`.
  const scopes = calcScopeForms().map(
    (scope): FormulaHelpEntry => ({
      group: "scope",
      label: scope.label,
      says: scope.info,
      example: `sum({kw} ${scope.apply}${scope.apply.endsWith("'") ? "main')" : ""})`,
      insert: scope.apply,
    }),
  );
  return [...forms, ...aggregates, ...scopes];
}

/** `V3_PARAMETER_HELP` without its `$key — ` lead, which the entry's label already shows. */
const PARAMETER_SAYS = V3_PARAMETER_HELP.slice(V3_PARAMETER_HELP.indexOf(" — ") + " — ".length);

function windowEntries(): FormulaHelpEntry[] {
  const calls = CALC_WINDOW_FNS.map(
    (name): FormulaHelpEntry => ({
      group: "window",
      label: `${name} over a window`,
      says: WINDOW_TEACHING[name].does,
      example: WINDOW_TEACHING[name].example,
      insert: `${name}(`,
    }),
  );
  const units = Object.keys(CALC_ROLLING_UNITS)
    .map((unit) => `<n>${unit}`)
    .join(", ");
  return [
    ...calls,
    {
      group: "window",
      label: "hours of a window",
      says: "the window's length in hours — prorates a daily baseline",
      example: "{baseline_kwh} / 24 * hours(today)",
      insert: "hours(",
    },
    {
      group: "window",
      label: "window lengths",
      says: `calendar: ${CALC_CALENDAR_WINDOWS.join(", ")}; rolling: ${units}, up to ${MAX_ROLLING_WINDOW_DAYS}d`,
      example: "avg({kw}, 7d)",
      insert: "24h",
    },
  ];
}

/**
 * The help list for one dialect, in display order: operators, the `{key}`
 * reference, the functions, then by dialect the `v2` reference forms,
 * aggregates and `@` scopes, the `v3` `$key` parameter and the window forms.
 * A newer dialect's list carries every entry of an older one (ADR 0070).
 */
export function formulaHelpEntries(dialect: CalcDialect): readonly FormulaHelpEntry[] {
  const entries: FormulaHelpEntry[] = [...OPERATORS, LOCAL_REFERENCE, ...functionEntries()];
  if (isCrossAssetDialect(dialect)) {
    entries.push(...crossAssetEntries());
  }
  if (isParameterDialect(dialect)) {
    entries.push({
      group: "parameter",
      label: "$key",
      says: PARAMETER_SAYS,
      example: "{kw} * $energy_tariff_per_kwh",
      insert: "$",
    });
  }
  if (isWindowDialect(dialect)) {
    entries.push(...windowEntries());
  }
  return entries;
}
