/**
 * The Calculations tab's trigger rules (`F2.5`, ADR 0038 Unit 9c).
 *
 * The bounds come from `@bms/shared`, not from literals repeated here. The
 * server's own schema reads them from the same constants, so a bound that moves
 * moves in both places at once — a copied `10` would keep passing while the
 * server started refusing.
 */
import {
  CALC_DIALECT,
  CALC_DIALECTS,
  CALC_DIALECT_V2,
  CALC_TRIGGERS,
  MAX_CALC_INTERVAL_SECONDS,
  MAX_INPUT_AGE_SECONDS_BOUND,
  MIN_CALC_INTERVAL_SECONDS,
  type CalcDialect,
  type CalcTrigger,
} from "@bms/shared";

import {
  CALC_INTERVAL_BOUNDS,
  COVERAGE_RATIO_HINT,
  INPUT_AGE_BOUNDS,
  V2_TRIGGER_LATENCY_HINT,
  calcConfigErrors,
  calcGridErrors,
  dialectOptions,
  parseOptionalRatio,
  parseOptionalSeconds,
  setCalcTrigger,
  setFormulaDialect,
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
    minCoverageRatio: null,
    meta: null,
    // `F2.7` — a derived row carries no instrument metadata.
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
    ...overrides,
  };
}

/**
 * ADR 0055 decision 10 — a `bms-calc-v2` point is `scheduled` and nothing else.
 *
 * A `v2` formula resolves its cross-asset membership once per sweep, so there
 * is nothing for it to resolve against on a single incoming reading: a
 * streaming `v2` point stores clean and never computes. The server refuses it
 * in `templatePointBodySchema` and in `validateMergedCalcOverride`; this tab is
 * a third author for the same engine, and a rule held in two paths and not the
 * third is not a style difference.
 *
 * The `v1` control is the anti-vacuity half: `streaming` is the *default* shape
 * of a `v1` derived point, so a check that fired on every streaming row would
 * make the tab unsaveable and would still pass an assertion that only looked at
 * the `v2` case.
 */
export function runV2IsScheduledOnlyTests(): void {
  const streaming = calcConfigErrors(derived({ formulaDialect: CALC_DIALECT_V2 }), 0);
  const onTrigger = streaming.filter((problem) => problem.field === "calcTrigger");
  assert(
    onTrigger.length === 1,
    `a streaming v2 row is one problem on calcTrigger — got ${JSON.stringify(streaming)}`,
  );
  assert(
    onTrigger[0].message ===
      `A "${CALC_DIALECT_V2}" point requires calcTrigger: "scheduled" — a cross-asset ` +
        "formula resolves its members once per sweep and cannot run on a single reading",
    `the message must match the server's word for word, got: ${onTrigger[0].message}`,
  );

  const scheduled = calcConfigErrors(
    derived({
      formulaDialect: CALC_DIALECT_V2,
      calcTrigger: "scheduled",
      calcIntervalSeconds: 300,
    }),
    0,
  );
  assert(
    scheduled.length === 0,
    `a scheduled v2 row is fine — got ${JSON.stringify(scheduled)}`,
  );

  const v1Streaming = calcConfigErrors(derived(), 0);
  assert(
    v1Streaming.length === 0,
    `streaming is still the ordinary v1 shape — got ${JSON.stringify(v1Streaming)}`,
  );
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

  // **The value the form can actually produce, which `null` alone never
  // reached.** The trigger `<select>` renders `<option value="">Choose…` and
  // casts `event.target.value` to `CalcTrigger`, so re-picking "Choose…" hands
  // this module `""` — not `null`. Every guard here used to test `=== null`,
  // so `""` reported no problem at all: the error message disappeared, Save
  // enabled, and the request 400'd on `z.enum(CALC_TRIGGERS).nullish()`, which
  // is the exact failure this module exists to prevent.
  //
  // A mutation of `=== null` still reddened the `null` case above, so the
  // mutation run reported this module clean while the gap was open. The fix is
  // to assert the **rule** — a derived point carries one of the two triggers —
  // rather than the one absent value the old assertion pinned.
  for (const absent of [null, "" as CalcTrigger, "hourly" as CalcTrigger]) {
    const problems = calcConfigErrors(derived({ calcTrigger: absent }), 0);
    assert(
      problems.length === 1 && problems[0].field === "calcTrigger",
      `a derived point whose trigger is ${JSON.stringify(absent)} must report a calcTrigger problem, got ${JSON.stringify(problems)}`,
    );
  }

  // The two real members must still pass, or the rule above would be satisfied
  // by a guard that simply refuses everything.
  for (const trigger of CALC_TRIGGERS) {
    const row =
      trigger === "scheduled"
        ? derived({ calcTrigger: trigger, calcIntervalSeconds: CALC_INTERVAL_BOUNDS.min })
        : derived({ calcTrigger: trigger });
    assert(
      calcConfigErrors(row, 0).length === 0,
      `"${trigger}" is a real trigger and must be accepted`,
    );
  }
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

  // **The setter's half of the `""` defect, which had no test until a mutation
  // said so.** Deleting the non-member guard from `setCalcTrigger` left every
  // assertion above green, because nothing here ever called it with a value
  // outside the union — the parameter type says it cannot happen, and the
  // `<select>`'s cast is exactly what makes it happen anyway.
  //
  // A non-member must land as `null`: the author has chosen no trigger, which
  // is what `null` means. Storing `""` would put a value in the row that
  // `calcConfigErrors` then has to defend against a second time.
  for (const absent of ["", "hourly", "Streaming"]) {
    const cleared = setCalcTrigger(
      derived({ calcTrigger: "scheduled", calcIntervalSeconds: 300 }),
      absent as CalcTrigger,
    );
    assert(
      cleared.calcTrigger === null,
      `setting the trigger to ${JSON.stringify(absent)} must clear it, got ${JSON.stringify(cleared.calcTrigger)}`,
    );
  }

  // A row that already has no trigger is returned unchanged rather than
  // rebuilt — the setter is called on every keystroke-adjacent render.
  const already = derived({ calcTrigger: null });
  assert(
    setCalcTrigger(already, "" as CalcTrigger) === already,
    "clearing an already-clear trigger must return the same row",
  );
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

// ---- F2.22: the dialect control, the coverage ratio and the two hints ------

/**
 * `F2.22` design decision 3 — the dialect setter clears what the new dialect
 * may not carry, the same shape as `setCalcTrigger`.
 *
 * To `v2`: a `streaming` trigger flips to `scheduled` (ADR 0055 decision 10,
 * the only legal trigger) and **no interval is seeded** — `calcConfigErrors`'
 * "needs an interval" asks for one instead. To `v1`: `minCoverageRatio` is
 * cleared, because the server refuses one off a `v2` derived point
 * (`asset-templates.schema.ts:187-198`).
 */
export function runSetFormulaDialectTests(): void {
  const streamingV1 = derived();
  const toV2 = setFormulaDialect(streamingV1, CALC_DIALECT_V2);
  assert(toV2.formulaDialect === CALC_DIALECT_V2, "the dialect changes");
  assert(
    toV2.calcTrigger === "scheduled",
    `a streaming row flips to scheduled under v2 — got ${JSON.stringify(toV2.calcTrigger)}`,
  );
  assert(
    toV2.calcIntervalSeconds === null,
    `no interval is seeded — a schedule the author did not set is worse than a prompt. Got ${toV2.calcIntervalSeconds}`,
  );
  // Proven through the validator: the flip leaves exactly the "needs an
  // interval" prompt and nothing on the trigger — the setter and the check
  // agree on what a fresh `v2` row is missing.
  const afterFlip = calcConfigErrors(toV2, 0);
  assert(
    afterFlip.length === 1 &&
      afterFlip[0].field === "calcIntervalSeconds" &&
      afterFlip[0].message.includes("needs an interval"),
    `the flipped row is asked for an interval and nothing else — got ${JSON.stringify(afterFlip)}`,
  );

  // A trigger that is already legal under `v2` is left alone, interval and all.
  const scheduled = derived({ calcTrigger: "scheduled", calcIntervalSeconds: 300, maxInputAgeSeconds: 600 });
  const scheduledV2 = setFormulaDialect(scheduled, CALC_DIALECT_V2);
  assert(scheduledV2.calcTrigger === "scheduled" && scheduledV2.calcIntervalSeconds === 300, "a scheduled row keeps its schedule");
  assert(scheduledV2.maxInputAgeSeconds === 600, "the input age survives a dialect change");
  // An unset trigger stays unset: only `streaming` is illegal under `v2`, and
  // choosing a trigger for the author is not this setter's job.
  const unset = setFormulaDialect(derived({ calcTrigger: null }), CALC_DIALECT_V2);
  assert(unset.calcTrigger === null, `an unset trigger is not chosen for the author — got ${JSON.stringify(unset.calcTrigger)}`);

  // To `v1`: the ratio goes, the trigger stays.
  const v2WithRatio = derived({
    formulaDialect: CALC_DIALECT_V2,
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
    minCoverageRatio: 0.5,
  });
  const toV1 = setFormulaDialect(v2WithRatio, CALC_DIALECT);
  assert(toV1.formulaDialect === CALC_DIALECT, "the dialect changes back");
  assert(
    toV1.minCoverageRatio === null,
    `a v1 row cannot carry a coverage ratio, so the change clears it — got ${toV1.minCoverageRatio}`,
  );
  assert(toV1.calcTrigger === "scheduled" && toV1.calcIntervalSeconds === 300, "the schedule is legal under v1 and survives");
  assert(calcConfigErrors(toV1, 0).length === 0, "and the result is valid");

  // The same dialect is the same reference, both ways — the setter is called
  // from a change handler and a rebuilt row would mark the tab dirty.
  assert(setFormulaDialect(streamingV1, CALC_DIALECT) === streamingV1, "v1 → v1 returns the same row");
  assert(setFormulaDialect(v2WithRatio, CALC_DIALECT_V2) === v2WithRatio, "v2 → v2 returns the same row");

  // A non-member: the `<select>` hands this a `string`, and there is no
  // "Choose…" option for a dialect. Anything outside `CALC_DIALECTS` is
  // returned unchanged rather than stored — a row cannot be moved to a
  // dialect the engine does not know, whatever the parameter type says.
  for (const absent of ["", "bms-calc-v9", "BMS-CALC-V2"]) {
    assert(
      setFormulaDialect(v2WithRatio, absent as CalcDialect) === v2WithRatio,
      `a non-member dialect ${JSON.stringify(absent)} must leave the row untouched`,
    );
  }
}

/**
 * ADR 0055 decision 11 on the Calculations tab.
 *
 * Two rules on one field. Placement: the ratio is the coverage of an
 * aggregate's member set, and only a `v2` derived formula can hold one — the
 * server's sentence verbatim (`asset-templates.schema.ts:195-196`). Bounds:
 * `(0, 1]`, written as the negation of "inside" so `NaN` fails rather than
 * passing both comparisons vacuously (`calc-definition.ts:225-228`'s shape).
 * `1` is inside — it means "every member"; `0` is not — a formula that needs
 * no member fresh is not a coverage rule.
 *
 * Every `v2` fixture here is `scheduled` with an interval, so the only problem
 * on the row is the one under test; the assertions still filter on the field,
 * because the `v1` placement case carries the decision-10 shape too.
 */
export function runCoverageRatioTests(): void {
  const BOUNDS_MESSAGE = "A minimum coverage ratio is above 0 and at most 1. Leave it empty to fail closed.";
  const PLACEMENT_MESSAGE =
    `minCoverageRatio applies only to a derived point in the "${CALC_DIALECT_V2}" ` +
    "dialect — it is the fraction of an aggregate's declared members that must be fresh";

  const onRatio = (value: number | null, dialect: CalcDialect = CALC_DIALECT_V2) =>
    calcConfigErrors(
      derived({
        formulaDialect: dialect,
        calcTrigger: "scheduled",
        calcIntervalSeconds: 300,
        minCoverageRatio: value,
      }),
      0,
    ).filter((problem) => problem.field === "minCoverageRatio");

  assert(onRatio(null).length === 0, "an empty ratio is fail closed, and valid");
  assert(onRatio(1).length === 0, "1 is inside — every member must be fresh");
  assert(onRatio(0.5).length === 0, "a fraction is the ordinary relaxed shape");

  const zero = onRatio(0);
  assert(zero.length === 1, `0 is outside (0, 1] — got ${JSON.stringify(zero)}`);
  assert(zero[0].message === BOUNDS_MESSAGE, `the bounds message, exactly — got ${zero[0].message}`);
  // The **bounds** rule and not its neighbour: both report this field, and a
  // check that reported the wrong one of the pair would pass every count.
  assert(!zero[0].message.includes("applies only"), "0 on a v2 row is a bounds problem, not a placement one");

  const above = onRatio(1.5);
  assert(above.length === 1 && above[0].message === BOUNDS_MESSAGE, `1.5 is outside — got ${JSON.stringify(above)}`);

  // The fail-closed shape: `NaN > 0` and `NaN <= 1` are both false, so a guard
  // written as two "outside" comparisons joined by `||` lets it through. No
  // path in this tab produces one (`parseOptionalRatio` maps non-finite to
  // `null`), which is exactly why the guard's shape is asserted rather than
  // trusted.
  const nan = onRatio(Number.NaN);
  assert(nan.length === 1 && nan[0].message === BOUNDS_MESSAGE, `NaN must fail closed — got ${JSON.stringify(nan)}`);

  // Placement: a ratio on a `v1` row is the server's refusal, word for word.
  const onV1 = onRatio(0.5, CALC_DIALECT);
  assert(onV1.length === 1, `a ratio on a v1 row is refused — got ${JSON.stringify(onV1)}`);
  assert(
    onV1[0].message === PLACEMENT_MESSAGE,
    `the placement message must match the server's word for word — got ${onV1[0].message}`,
  );
  // And a `v1` row with no ratio is not touched by either rule.
  assert(onRatio(null, CALC_DIALECT).length === 0, "a v1 row without a ratio has nothing to fix");

  // `parseOptionalRatio`: an emptied box is unset, a fraction is kept whole.
  assert(parseOptionalRatio("") === null, "an empty box is unset");
  assert(parseOptionalRatio("   ") === null, "a whitespace box is unset");
  assert(parseOptionalRatio("0.75") === 0.75, "a fraction is the value — never truncated");
  assert(parseOptionalRatio(" 1 ") === 1, "padding is ignored");
  assert(parseOptionalRatio("0") === 0, "an explicit zero is kept, so the bounds check reports it");
  assert(parseOptionalRatio("abc") === null, "a non-number is unset, not NaN");
  assert(parseOptionalRatio("Infinity") === null, "a non-finite value is unset");

  // The two hint sentences the tab renders beside the controls.
  assert(
    V2_TRIGGER_LATENCY_HINT.includes("at most one interval old"),
    `the trigger hint states decision 10's cost — got ${V2_TRIGGER_LATENCY_HINT}`,
  );
  assert(
    COVERAGE_RATIO_HINT.startsWith("Empty means fail closed") && COVERAGE_RATIO_HINT.includes("excluded"),
    `the ratio hint states decision 11 in the author's words — got ${COVERAGE_RATIO_HINT}`,
  );
}

/**
 * The dialect `<select>`'s options come from `CALC_DIALECTS`, in its order — a
 * third dialect added upstream arrives here without a code change, and a
 * surface that listed the two literals would be the restated vocabulary
 * part (c) of `tests/adr-0055-calc-v2-invariants.test.ts` forbids.
 */
export function runDialectOptionsTests(): void {
  const options = dialectOptions();
  assert(
    options.map((option) => option.value).join(",") === CALC_DIALECTS.join(","),
    `the options are CALC_DIALECTS in order — got ${options.map((option) => option.value).join(",")}`,
  );
  assert(options.length === CALC_DIALECTS.length, "one option per dialect, no more");
  for (const option of options) {
    assert(
      option.label.startsWith(option.value),
      `each label leads with the stored name so the author sees what is saved — got ${option.label}`,
    );
  }
  assert(new Set(options.map((option) => option.label)).size === options.length, "labels are distinct");
  const v2 = options.find((option) => option.value === CALC_DIALECT_V2);
  assert(
    v2 !== undefined && v2.label.includes("@site") && v2.label.includes("{CODE.key}"),
    `the v2 label names the cross-asset forms — got ${v2?.label}`,
  );
  const v1 = options.find((option) => option.value === CALC_DIALECT);
  assert(
    v1 !== undefined && v1.label.includes("own points"),
    `the v1 label says it is same-asset — got ${v1?.label}`,
  );
}
