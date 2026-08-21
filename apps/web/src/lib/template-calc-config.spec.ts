/**
 * The Calculations tab's trigger rules (`F2.5`, ADR 0038 Unit 9c).
 *
 * The bounds come from `@bms/shared`, not from literals repeated here. The
 * server's own schema reads them from the same constants, so a bound that moves
 * moves in both places at once — a copied `10` would keep passing while the
 * server started refusing.
 */
import {
  CALC_TRIGGERS,
  MAX_CALC_INTERVAL_SECONDS,
  MAX_INPUT_AGE_SECONDS_BOUND,
  MIN_CALC_INTERVAL_SECONDS,
} from "@bms/shared";

import {
  CALC_INTERVAL_BOUNDS,
  INPUT_AGE_BOUNDS,
  calcConfigErrors,
  calcGridErrors,
  parseOptionalSeconds,
  setCalcTrigger,
} from "./template-calc-config";
import type { TemplatePointRow } from "./template-points-grid";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function derived(overrides: Partial<TemplatePointRow> = {}): TemplatePointRow {
  return {
    pointKey: "COOLING_KW",
    label: "Cooling load",
    unit: "kW",
    kind: "derived",
    sourceDataKeyPattern: "",
    required: true,
    sortOrder: 0,
    formula: "{CHW_SUPPLY_T} * 2",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "streaming",
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    ...overrides,
  };
}

/** The bounds are the shared constants, not copies. */
export function runBoundsComeFromSharedTests(): void {
  assert(
    CALC_INTERVAL_BOUNDS.min === MIN_CALC_INTERVAL_SECONDS,
    "the interval minimum is the shared constant the server's schema reads",
  );
  assert(CALC_INTERVAL_BOUNDS.max === MAX_CALC_INTERVAL_SECONDS, "…and the maximum");
  assert(INPUT_AGE_BOUNDS.max === MAX_INPUT_AGE_SECONDS_BOUND, "…and the input-age bound");
  assert(INPUT_AGE_BOUNDS.min === 1, "the schema is .min(1) — zero is not an age");

  // Both triggers are handled. A third added to `CALC_TRIGGERS` must arrive
  // here rather than falling through as "not scheduled, so no interval needed".
  assert(
    CALC_TRIGGERS.length === 2 && CALC_TRIGGERS.join(",") === "streaming,scheduled",
    `this module handles exactly the declared triggers — got ${CALC_TRIGGERS.join(",")}`,
  );
}

/** A valid derived point has nothing to fix. */
export function runValidConfigTests(): void {
  assert(calcConfigErrors(derived(), 0).length === 0, "a streaming point with no interval is valid");
  assert(
    calcConfigErrors(derived({ calcTrigger: "scheduled", calcIntervalSeconds: 300 }), 0).length === 0,
    "a scheduled point with an interval is valid",
  );
  assert(
    calcConfigErrors(derived({ maxInputAgeSeconds: 600 }), 0).length === 0,
    "an input age is allowed under streaming — the schema cross-checks it against neither trigger",
  );

  // A measured point's calc fields are `pointGridErrors`' cross-check, not
  // this module's. Two authorities on one rule is one authority too many.
  assert(
    calcConfigErrors(derived({ kind: "measured", calcTrigger: null }), 0).length === 0,
    "a measured point is not this module's to judge",
  );
}

/**
 * The half an implementation forgets.
 *
 * `templatePointBodySchema`: "A streaming point must not carry
 * calcIntervalSeconds — it runs on every matching reading."
 */
export function runIntervalOnlyWhenScheduledTests(): void {
  const missing = calcConfigErrors(
    derived({ calcTrigger: "scheduled", calcIntervalSeconds: null }),
    0,
  );
  assert(missing.length === 1, `a scheduled point needs an interval — got ${missing.length}`);
  assert(missing[0].field === "calcIntervalSeconds", "reported against the interval field");
  // The **message**, not just the field. An absent interval and an
  // out-of-range one are both `calcIntervalSeconds` problems, and the bounds
  // check catches `null` too — `Number.isInteger(null)` is false. So asserting
  // the field alone let a mutation that deleted this branch survive: the author
  // would have been told an empty box was "between 10 and 86400 seconds".
  assert(
    missing[0].message.includes("needs an interval"),
    `an empty interval must say it is missing, not that it is out of range — got ${missing[0].message}`,
  );

  const leftover = calcConfigErrors(
    derived({ calcTrigger: "streaming", calcIntervalSeconds: 300 }),
    0,
  );
  assert(
    leftover.length === 1,
    `a streaming point must not carry an interval — got ${JSON.stringify(leftover)}`,
  );
  assert(
    leftover[0].message.includes("every matching reading"),
    `the message says why, not just that — got ${leftover[0].message}`,
  );

  const noTrigger = calcConfigErrors(derived({ calcTrigger: null }), 0);
  assert(noTrigger.length === 1 && noTrigger[0].field === "calcTrigger", "a derived point needs a trigger");
}

/** The bounds are inclusive at both ends, and reject a fraction. */
export function runBoundsCheckTests(): void {
  const at = (value: number) =>
    calcConfigErrors(derived({ calcTrigger: "scheduled", calcIntervalSeconds: value }), 0);

  assert(at(CALC_INTERVAL_BOUNDS.min).length === 0, "the minimum interval is allowed");
  assert(at(CALC_INTERVAL_BOUNDS.max).length === 0, "the maximum interval is allowed");
  assert(at(CALC_INTERVAL_BOUNDS.min - 1).length === 1, "below the minimum is refused");
  assert(at(CALC_INTERVAL_BOUNDS.max + 1).length === 1, "above the maximum is refused");
  // `.int()` on the wire. A fractional interval would be a 400 naming a type.
  assert(at(30.5).length === 1, "a fractional interval is refused — the schema is .int()");

  // The field **and** the message, for the reason the missing-interval case
  // above records: two of this module's four checks report
  // `calcIntervalSeconds`, and two report `maxInputAgeSeconds`. A check that
  // reported the wrong one of its pair would pass every count assertion here.
  const outOfRange = at(CALC_INTERVAL_BOUNDS.max + 1)[0];
  assert(outOfRange.field === "calcIntervalSeconds", "reported against the interval");
  // The **wording**, not the number. `MAX_CALC_INTERVAL_SECONDS` and
  // `MAX_INPUT_AGE_SECONDS_BOUND` are both 86400, so quoting the bound would
  // discriminate nothing — the two messages would be interchangeable to any
  // assertion that only looked at the digits.
  assert(
    outOfRange.message.startsWith("An interval"),
    `the interval message must name the interval — got ${outOfRange.message}`,
  );

  const age = (value: number) => calcConfigErrors(derived({ maxInputAgeSeconds: value }), 0);
  assert(age(INPUT_AGE_BOUNDS.min).length === 0, "an age of one second is allowed");
  assert(age(INPUT_AGE_BOUNDS.max).length === 0, "the maximum age is allowed");
  assert(age(0).length === 1, "zero is not an age");
  assert(age(INPUT_AGE_BOUNDS.max + 1).length === 1, "above the bound is refused");
  assert(age(0)[0].field === "maxInputAgeSeconds", "reported against the input age");
  assert(
    age(0)[0].message.includes("input age"),
    `the input-age message must say what it is about — got ${age(0)[0].message}`,
  );
  assert(
    calcConfigErrors(derived({ maxInputAgeSeconds: null }), 0).length === 0,
    "an unset age is valid — the engine applies its own default",
  );
}

/** Switching to streaming clears the interval; switching to scheduled seeds none. */
export function runTriggerChangeTests(): void {
  const scheduled = derived({ calcTrigger: "scheduled", calcIntervalSeconds: 300 });

  const streaming = setCalcTrigger(scheduled, "streaming");
  assert(streaming.calcTrigger === "streaming", "the trigger changes");
  assert(
    streaming.calcIntervalSeconds === null,
    `switching to streaming clears the interval — got ${streaming.calcIntervalSeconds}`,
  );
  // Proven through the validator too: a leftover interval is exactly what the
  // server refuses, so the clear and the check must agree.
  assert(calcConfigErrors(streaming, 0).length === 0, "and the result is valid");

  const back = setCalcTrigger(streaming, "scheduled");
  assert(
    back.calcIntervalSeconds === null,
    "switching to scheduled seeds no interval — a schedule the author did not set is worse than a prompt",
  );
  assert(calcConfigErrors(back, 0).length === 1, "so the author is asked for one");

  // The input age means the same thing under both triggers.
  const aged = setCalcTrigger(derived({ maxInputAgeSeconds: 600 }), "scheduled");
  assert(aged.maxInputAgeSeconds === 600, "the input age survives a trigger change");

  const same = setCalcTrigger(scheduled, "scheduled");
  assert(same.calcIntervalSeconds === 300, "setting the trigger it already has changes nothing");
}

/** An emptied number box is "unset", not zero. */
export function runParseOptionalSecondsTests(): void {
  assert(parseOptionalSeconds("") === null, "an empty box is unset");
  assert(parseOptionalSeconds("   ") === null, "a whitespace box is unset");
  // `Number("")` is 0, which is below both minimums — a cleared field would
  // otherwise report "out of range" instead of simply being absent.
  assert(parseOptionalSeconds("") !== 0, "an empty box must not read as zero");
  assert(parseOptionalSeconds("300") === 300, "a number parses");
  assert(parseOptionalSeconds(" 300 ") === 300, "padding is ignored");
  assert(parseOptionalSeconds("300.7") === 300, "a fraction truncates — the wire type is an integer");
  assert(parseOptionalSeconds("abc") === null, "a non-number is unset, not NaN");
  assert(parseOptionalSeconds("0") === 0, "an explicit zero is kept, so the bounds check reports it");
}

/** The grid-wide pass reports every derived point, addressed by row. */
export function runGridPassTests(): void {
  const rows: TemplatePointRow[] = [
    derived({ pointKey: "A", kind: "measured", calcTrigger: null, formula: null }),
    derived({ pointKey: "B", calcTrigger: "scheduled", calcIntervalSeconds: null }),
    derived({ pointKey: "C", calcTrigger: "streaming", calcIntervalSeconds: 60 }),
  ];
  const problems = calcGridErrors(rows);

  assert(problems.length === 2, `two derived points are broken — got ${problems.length}`);
  assert(
    problems.map((problem) => problem.row).join(",") === "1,2",
    `addressed by row index, in order — got ${problems.map((problem) => problem.row).join(",")}`,
  );
  assert(calcGridErrors([]).length === 0, "an empty grid has no problems");
  assert(
    calcGridErrors([derived()]).length === 0,
    "a grid of valid derived points has no problems",
  );
}
