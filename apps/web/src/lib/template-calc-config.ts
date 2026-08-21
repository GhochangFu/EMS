import {
  DEFAULT_MAX_INPUT_AGE_SECONDS,
  MAX_CALC_INTERVAL_SECONDS,
  MAX_INPUT_AGE_SECONDS_BOUND,
  MIN_CALC_INTERVAL_SECONDS,
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
  if (trigger === row.calcTrigger) {
    return row;
  }
  if (trigger === "streaming") {
    return { ...row, calcTrigger: trigger, calcIntervalSeconds: null };
  }
  return { ...row, calcTrigger: trigger };
}

/**
 * What the author must fix on one derived point before the grid can be sent.
 *
 * Only the three trigger fields. The formula is Unit 5's
 * `validateEditorFormula`, and the cross-point references are Unit 9b's
 * `brokenFormulaRefs` — repeating either here would put two authorities on one
 * rule, and the one that drifted would be the one nobody was reading.
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

  if (row.calcTrigger === null) {
    problems.push({
      row: index,
      field: "calcTrigger",
      message: "Choose when this formula runs: on every reading, or on a schedule.",
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

function inBounds(value: number, bounds: { min: number; max: number }): boolean {
  return Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
}
