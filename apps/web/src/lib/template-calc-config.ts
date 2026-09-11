import {
  CALC_DIALECT,
  CALC_DIALECTS,
  CALC_DIALECT_V2,
  CALC_TRIGGERS,
  DEFAULT_MAX_INPUT_AGE_SECONDS,
  MAX_CALC_INTERVAL_SECONDS,
  MAX_INPUT_AGE_SECONDS_BOUND,
  MIN_CALC_INTERVAL_SECONDS,
  type CalcDialect,
  type CalcTrigger,
} from "@bms/shared";

import type { PointGridProblem, TemplatePointRow } from "./template-points-grid";

/**
 * The Calculations tab's trigger rules (`F2.5`, ADR 0038 Unit 9c).
 *
 * The formula field itself is Unit 5's: `FormulaEditorLazy` in `"derived"`
 * mode, validated by `validateEditorFormula`. What is new here is the three
 * fields around it — `calcTrigger`, `calcIntervalSeconds`, `maxInputAgeSeconds`
 * — which ADR 0037 decision 4 attaches to a derived point and ADR 0038
 * decision 4 puts on this tab and no other.
 *
 * ## `calcIntervalSeconds` is required when, and **only** when, scheduled
 *
 * `templatePointBodySchema`'s `superRefine` says both halves:
 *
 * - `"scheduled"` with no interval → *"A scheduled point requires
 *   calcIntervalSeconds"*;
 * - `"streaming"` **with** an interval → *"A streaming point must not carry
 *   calcIntervalSeconds — it runs on every matching reading"*.
 *
 * The second half is the one an implementation forgets, because leaving a value
 * behind looks harmless. It is not: an author who tries `scheduled`, sets 300,
 * then switches to `streaming` sends a body the server refuses, with a message
 * about a field the form no longer shows. `setCalcTrigger` is the only way this
 * tab changes the trigger, and it clears the interval on that transition — the
 * same shape as `setPointKind` in Unit 6's neighbour module, for the same
 * reason.
 *
 * ## `maxInputAgeSeconds` is optional in both modes
 *
 * It is `.nullish()` on a derived point and has no cross-check against the
 * trigger. Left empty, the calc engine applies
 * `DEFAULT_MAX_INPUT_AGE_SECONDS` (300). The placeholder says so rather than
 * the field pre-filling it: a pre-filled 300 is a value the author chose, and
 * `null` is a value they left to the engine — the two are the same number today
 * and would stop being the same number the day the default moves.
 *
 * ## `F2.22` — the dialect, and what `bms-calc-v2` adds to the row
 *
 * ADR 0055 puts two more things on a derived point: which dialect its formula
 * is read under, and — under `v2` only — `minCoverageRatio`, the fraction of
 * an aggregate's declared members that must be fresh (decision 11).
 * `setFormulaDialect` is the only way this tab changes the dialect, and it
 * clears what the new dialect may not carry, the same shape as
 * `setCalcTrigger`. `calcConfigErrors` gains the two ratio rules; the two
 * `*_HINT` strings are the sentences the tab renders beside the controls, so
 * the override panel (`F2.22` T12) says the same thing from the same source.
 */

/** Bounds, mirroring `templatePointBodySchema`. */
export const CALC_INTERVAL_BOUNDS = {
  min: MIN_CALC_INTERVAL_SECONDS,
  max: MAX_CALC_INTERVAL_SECONDS,
} as const;

export const INPUT_AGE_BOUNDS = { min: 1, max: MAX_INPUT_AGE_SECONDS_BOUND } as const;

/** What the engine uses when `maxInputAgeSeconds` is left unset. */
export const IMPLIED_MAX_INPUT_AGE_SECONDS = DEFAULT_MAX_INPUT_AGE_SECONDS;

/**
 * Changes a derived point's trigger, clearing what the new trigger may not
 * carry.
 *
 * `streaming` clears `calcIntervalSeconds`, because the schema refuses a
 * streaming point that carries one. `scheduled` seeds nothing — an interval
 * chosen for the author would be a schedule they did not set, running against
 * their data on a cadence they never saw. `calcConfigErrors` asks for it
 * instead.
 *
 * `maxInputAgeSeconds` survives both directions. It means the same thing under
 * either trigger and the schema cross-checks it against neither.
 */
export function setCalcTrigger(row: TemplatePointRow, trigger: CalcTrigger): TemplatePointRow {
  // The second half of the `""` defect. The change handler casts
  // `event.target.value`, so this can be called with the "Choose…" option's
  // empty string despite the parameter type. Storing it would put a value in
  // the row that `calcConfigErrors` must then defend against; mapping it back
  // to `null` keeps the row honest — the author has chosen no trigger, which
  // is exactly what `null` means here.
  if (!isCalcTrigger(trigger)) {
    return row.calcTrigger === null ? row : { ...row, calcTrigger: null };
  }
  if (trigger === row.calcTrigger) {
    return row;
  }
  if (trigger === "streaming") {
    return { ...row, calcTrigger: trigger, calcIntervalSeconds: null };
  }
  return { ...row, calcTrigger: trigger };
}

/**
 * One label per dialect, keyed by the union so a third dialect fails to
 * compile here rather than rendering without a label. Each leads with the
 * stored name, because that name is what the author sees in the API and in
 * the stock viewer.
 */
const DIALECT_LABELS: Readonly<Record<CalcDialect, string>> = {
  [CALC_DIALECT]: `${CALC_DIALECT} — this asset's own points`,
  [CALC_DIALECT_V2]: `${CALC_DIALECT_V2} — cross-asset: aggregates over @site / @domain / @group, and {CODE.key}`,
};

/**
 * The dialect `<select>`'s options, from `CALC_DIALECTS` and in its order.
 *
 * Never the two literals: a surface that lists `bms-calc-v1` and `bms-calc-v2`
 * by name is the restated vocabulary part (c) of
 * `tests/adr-0055-calc-v2-invariants.test.ts` forbids in the contracts, and the
 * same rule holds one layer up.
 */
export function dialectOptions(): readonly { value: CalcDialect; label: string }[] {
  return CALC_DIALECTS.map((value) => ({ value, label: DIALECT_LABELS[value] }));
}

/**
 * Changes a derived point's dialect, clearing what the new dialect may not
 * carry (`F2.22` design decision 3).
 *
 * To `v2`: a `streaming` trigger flips to `scheduled`, because `scheduled` is
 * the only legal trigger under `v2` (ADR 0055 decision 10) — this is not a
 * choice made for the author, any more than `setCalcTrigger` clearing an
 * interval the schema forbids is. **No interval is seeded**: the interval stays
 * as it was, and `calcConfigErrors`' "A scheduled formula needs an interval."
 * asks for one. An unset trigger stays unset for the same reason.
 *
 * To `v1`: `minCoverageRatio` is cleared, because the server refuses one off a
 * `v2` derived point (`asset-templates.schema.ts:187-198`) and a `v1` formula
 * has no aggregate for it to cover.
 *
 * The same dialect returns the same reference, and so does a value outside
 * `CALC_DIALECTS`: the `<select>` hands a `string` to its change handler, and a
 * row cannot be moved to a dialect the engine does not know.
 */
export function setFormulaDialect(row: TemplatePointRow, dialect: CalcDialect): TemplatePointRow {
  const target = CALC_DIALECTS.find((known) => known === dialect);
  if (target === undefined || target === row.formulaDialect) {
    return row;
  }
  if (target === CALC_DIALECT_V2) {
    return {
      ...row,
      formulaDialect: target,
      calcTrigger: row.calcTrigger === "streaming" ? "scheduled" : row.calcTrigger,
    };
  }
  return { ...row, formulaDialect: target, minCoverageRatio: null };
}

/**
 * ADR 0055 decision 10's cost, in the author's words (`0055:251-254`): every
 * `v2` value is at most one tick old by construction, and the authoring UI must
 * not imply otherwise.
 */
export const V2_TRIGGER_LATENCY_HINT =
  "Runs on a schedule only. A cross-asset formula resolves its members once per sweep, " +
  "so its value is at most one interval old and cannot be as fresh as a streaming one.";

/**
 * ADR 0055 decision 11 (`0055:269-285`): a null ratio means fail closed, not
 * "no limit"; below the floor the formula writes nothing; the excluded members
 * are reported, never silently averaged over.
 */
export const COVERAGE_RATIO_HINT =
  "Empty means fail closed: every declared member must carry a fresh value, or nothing is " +
  "written. A fraction between 0 and 1 computes over the fresh members and reports the " +
  "rest as excluded.";

/**
 * What the author must fix on one derived point before the grid can be sent.
 *
 * The three trigger fields, and since `F2.22` the coverage ratio. The formula
 * is Unit 5's `validateEditorFormula`, the cross-point references are Unit
 * 9b's `brokenFormulaRefs`, and the within-template cycle scan is
 * `template-calc-cycles.ts` — repeating any of them here would put two
 * authorities on one rule, and the one that drifted would be the one nobody
 * was reading.
 */
export function calcConfigErrors(
  row: TemplatePointRow,
  index: number,
): PointGridProblem[] {
  const problems: PointGridProblem[] = [];
  if (row.kind !== "derived") {
    // A measured point carrying any of these is caught by `pointGridErrors`,
    // which owns the kind cross-check. Nothing to add.
    return problems;
  }

  // A **membership** test, not `=== null`. The trigger `<select>` carries an
  // `<option value="">Choose…`, and re-picking it hands this module `""` — a
  // value `tsc` never sees because the change handler casts
  // `event.target.value` to `CalcTrigger`. Against `=== null` that reported no
  // problem at all: the message vanished, Save enabled, and the request 400'd
  // on `z.enum(CALC_TRIGGERS).nullish()`, which is the failure this module
  // exists to prevent. Asking "is it one of the two?" is closed against every
  // absent value rather than the one that was thought of.
  if (!isCalcTrigger(row.calcTrigger)) {
    problems.push({
      row: index,
      field: "calcTrigger",
      message: "Choose when this formula runs: on every reading, or on a schedule.",
    });
  }

  // ADR 0055 decision 10. A `bms-calc-v2` formula resolves its cross-asset
  // membership once per sweep, so there is nothing for it to resolve against on
  // a single incoming reading: a streaming `v2` point stores clean and never
  // computes. `templatePointBodySchema` and `validateMergedCalcOverride` both
  // refuse it, and this tab is a third author for the same engine.
  //
  // **The server's sentence verbatim.** Its own refinement is broader —
  // `calcTrigger !== "scheduled"`, which also catches an unset trigger — but the
  // membership test above already reports that case on this same field, and
  // `calculations-tab.tsx` renders the *first* problem per field. Two messages
  // for one empty select would mean the author sees whichever this function
  // happens to push first.
  if (row.formulaDialect === CALC_DIALECT_V2 && row.calcTrigger === "streaming") {
    problems.push({
      row: index,
      field: "calcTrigger",
      message:
        `A "${CALC_DIALECT_V2}" point requires calcTrigger: "scheduled" — a cross-asset ` +
        "formula resolves its members once per sweep and cannot run on a single reading",
    });
  }

  if (row.calcTrigger === "scheduled") {
    if (row.calcIntervalSeconds === null) {
      problems.push({
        row: index,
        field: "calcIntervalSeconds",
        message: "A scheduled formula needs an interval.",
      });
    } else if (!inBounds(row.calcIntervalSeconds, CALC_INTERVAL_BOUNDS)) {
      problems.push({
        row: index,
        field: "calcIntervalSeconds",
        message: `An interval is between ${CALC_INTERVAL_BOUNDS.min} and ${CALC_INTERVAL_BOUNDS.max} seconds.`,
      });
    }
  }

  // The half that is easy to leave out. A leftover interval on a streaming
  // point is refused by the server with a message naming a field this form
  // stops showing the moment the trigger changes.
  if (row.calcTrigger === "streaming" && row.calcIntervalSeconds !== null) {
    problems.push({
      row: index,
      field: "calcIntervalSeconds",
      message:
        "A streaming formula runs on every matching reading and must not carry an interval.",
    });
  }

  if (row.maxInputAgeSeconds !== null && !inBounds(row.maxInputAgeSeconds, INPUT_AGE_BOUNDS)) {
    problems.push({
      row: index,
      field: "maxInputAgeSeconds",
      message: `An input age is between ${INPUT_AGE_BOUNDS.min} and ${INPUT_AGE_BOUNDS.max} seconds.`,
    });
  }

  // ADR 0055 decision 11. The ratio is the coverage of an *aggregate's* member
  // set, and only a `v2` derived formula can hold an aggregate — on anything
  // else it is a value that reads as configured and is never consulted.
  //
  // **The server's sentence verbatim** (`asset-templates.schema.ts:195-196`).
  // Its condition is `!(kind === "derived" && dialect === v2)`; this function
  // has already returned for a measured row, so the derived half is implied.
  // `setFormulaDialect` clears the ratio on the way to `v1`, so the only way
  // to reach this is a stored row whose dialect was changed elsewhere.
  if (row.minCoverageRatio !== null && row.formulaDialect !== CALC_DIALECT_V2) {
    problems.push({
      row: index,
      field: "minCoverageRatio",
      message:
        `minCoverageRatio applies only to a derived point in the "${CALC_DIALECT_V2}" ` +
        "dialect — it is the fraction of an aggregate's declared members that must be fresh",
    });
  }

  // `(0, 1]` — written as the negation of "inside", so a `NaN` fails rather
  // than passing both comparisons vacuously (`calc-definition.ts:225-228`'s
  // shape). No path in this tab produces one — `parseOptionalRatio` maps a
  // non-finite value to `null` — and the shape is kept anyway, because a guard
  // that is only correct for the inputs it was thought of for is the kind that
  // fails open later. `1` is inside: it means "every member".
  //
  // **Not** the server's wording. Its bound is `z.number().gt(0).max(1)`
  // (`asset-templates.schema.ts:84`), whose messages are Zod's generic
  // "Number must be greater than 0" / "less than or equal to 1" — neither says
  // what the field is or what leaving it empty means. The same reason
  // `EMPTY_DERIVED_FORMULA_MESSAGE` is not a copy: the rule is exact, the
  // sentence is the actionable half.
  if (row.minCoverageRatio !== null && !(row.minCoverageRatio > 0 && row.minCoverageRatio <= 1)) {
    problems.push({
      row: index,
      field: "minCoverageRatio",
      message: "A minimum coverage ratio is above 0 and at most 1. Leave it empty to fail closed.",
    });
  }

  return problems;
}

/** Every derived point's trigger problems, in row order. */
export function calcGridErrors(rows: readonly TemplatePointRow[]): PointGridProblem[] {
  return rows.flatMap((row, index) => calcConfigErrors(row, index));
}

/**
 * Parses a number field, treating an emptied box as "unset".
 *
 * `Number("")` is `0`, which is below both minimums and would turn a cleared
 * field into an out-of-range error rather than into the absence it is. A value
 * that is not a number at all is also `null` — the input is `type="number"`, so
 * the only way to reach that is a browser that let something else through, and
 * an unset field is the safer reading of it.
 */
export function parseOptionalSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

/**
 * Parses the coverage-ratio field, treating an emptied box as "unset" — which
 * on this field means **fail closed** (ADR 0055 decision 11), not "no rule".
 *
 * The same shape as `parseOptionalSeconds` without the `Math.trunc`: the
 * ratio is a fraction, and truncating `0.75` to `0` would turn a relaxed rule
 * into an out-of-range one. A non-finite value is `null` for the reason the
 * seconds parser gives — the input is `type="number"`, and unset is the safer
 * reading of anything else. `"0"` is kept as `0`, so `calcConfigErrors` can
 * say it is outside the bound rather than silently falling back to fail
 * closed.
 */
export function parseOptionalRatio(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function inBounds(value: number, bounds: { min: number; max: number }): boolean {
  return Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
}

/**
 * Whether a value is one of the two real triggers.
 *
 * Exported so the `<select>`'s change handler can use it instead of casting.
 * `event.target.value` is a `string`, and the cast to `CalcTrigger` that made
 * it compile also let `""` — the "Choose…" option's value — through as though
 * it were a member. Reading the union from `CALC_TRIGGERS` rather than listing
 * the two names means a third trigger cannot be added upstream and silently
 * fail this check.
 */
export function isCalcTrigger(value: unknown): value is CalcTrigger {
  return typeof value === "string" && (CALC_TRIGGERS as readonly string[]).includes(value);
}
