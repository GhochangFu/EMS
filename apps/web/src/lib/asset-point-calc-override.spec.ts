import { CALC_DIALECT_V2 } from "@bms/shared";
import type { AssetPointCalcConfigDto } from "@bms/shared";

import {
  calcFieldRows,
  calcRuntimePillLabel,
  canClear,
  canSubmit,
  columnOrigin,
  coverageRatioDisplay,
  draftFromConfig,
  draftProblems,
  draftToBody,
  hasAnyOverride,
  mergedDialect,
  EMPTY_DRAFT,
} from "./asset-point-calc-override";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NOTHING = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
} as const;

const SCHEDULED_TEMPLATE = {
  formula: "{KW} * 2",
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 300,
  maxInputAgeSeconds: 600,
} as const;

/**
 * A `bms-calc-v2` template point.
 *
 * `scheduled`, because the server refuses any other shape (ADR 0055 decision
 * 10) — a stored `v2` streaming point cannot exist, so the only way to reach
 * the merged refusal is an override that sets the trigger while the dialect
 * inherits.
 */
const V2_TEMPLATE = {
  formula: "sum({KW} @site)",
  formulaDialect: CALC_DIALECT_V2,
  calcTrigger: "scheduled",
  calcIntervalSeconds: 300,
  maxInputAgeSeconds: 600,
} as const;

function config(
  override: Partial<AssetPointCalcConfigDto["override"]> = {},
  template: AssetPointCalcConfigDto["template"] = { ...SCHEDULED_TEMPLATE },
): AssetPointCalcConfigDto {
  const ov = { ...NOTHING, ...override };
  return {
    pointKey: "KWH",
    templatePointId: "tp-1",
    label: "Energy",
    unit: "kWh",
    assetPointId: null,
    template,
    override: ov,
    effective: {
      formula: ov.formula ?? template.formula,
      formulaDialect: ov.formulaDialect ?? template.formulaDialect,
      calcTrigger: ov.calcTrigger ?? template.calcTrigger,
      calcIntervalSeconds: ov.calcIntervalSeconds ?? template.calcIntervalSeconds,
      maxInputAgeSeconds: ov.maxInputAgeSeconds ?? template.maxInputAgeSeconds,
    },
    // `F2.22` item 4 — template-only and read-only (ADR 0055 decision 11);
    // nothing in this module's rules reads it.
    minCoverageRatio: null,
    // `F2.9` Task 16 — the panel's own rules do not read it, and the pill's
    // label is asserted on the field directly in `runRuntimePillLabelTests`.
    runtime: null,
  };
}

/** Overridden, inherited and unset are three states, not two. */
export function runColumnOriginTests(): void {
  const partial = config({ calcIntervalSeconds: 45 });

  assert(
    columnOrigin(partial, "calcIntervalSeconds") === "overridden",
    "a set override column reads as overridden",
  );
  assert(
    columnOrigin(partial, "formula") === "inherited",
    "a null override with a template value reads as inherited, not as empty",
  );

  const empty = config({}, { ...NOTHING });
  assert(
    columnOrigin(empty, "formula") === "unset",
    "a null override with no template value is unset — telling that apart from inherited " +
      "is the difference between 'the template decides' and 'nothing decides'",
  );
}

/** Clear is disabled when there is nothing to clear. */
export function runClearAvailabilityTests(): void {
  assert(!hasAnyOverride(config()), "an all-null override is no override");
  assert(
    !canClear(config()),
    "Clear must be disabled with nothing overridden — the API returns 404, and an error " +
      "that says nothing went wrong is the worst kind",
  );
  assert(canClear(config({ maxInputAgeSeconds: 30 })), "one overridden column is enough to clear");
}

/** The rows carry all three values, not just what runs. */
export function runFieldRowTests(): void {
  const rows = calcFieldRows(config({ calcIntervalSeconds: 45 }));

  assert(rows.length === 5, `all five columns must be listed, got ${rows.length}`);
  const interval = rows.find((row) => row.field === "calcIntervalSeconds");
  assert(
    interval?.templateValue === "300s" && interval?.effectiveValue === "45s",
    `both the template's value and what runs must show — got ${String(
      interval?.templateValue,
    )} / ${String(interval?.effectiveValue)}. "45s" alone says what runs but not whether ` +
      "changing the template would change it, which is the question this page answers",
  );
  assert(interval?.origin === "overridden", "and the row must say which it is");

  const formula = rows.find((row) => row.field === "formula");
  assert(
    formula?.effectiveValue === "{KW} * 2" && formula?.origin === "inherited",
    "an un-overridden column shows the template's value as what runs",
  );

  const unsetRows = calcFieldRows(config({}, { ...NOTHING }));
  assert(
    unsetRows.every((row) => row.templateValue === "—"),
    "an unset value renders as a dash, not as 'null'",
  );
}

/** The form seeds from the existing override, so editing is not retyping. */
export function runDraftSeedingTests(): void {
  const draft = draftFromConfig(config({ calcIntervalSeconds: 45, formula: "{KW} * 9" }));

  assert(draft.calcIntervalSeconds === "45", `expected "45", got ${draft.calcIntervalSeconds}`);
  assert(draft.formula === "{KW} * 9", "the overridden formula must seed the field");
  assert(
    draft.calcTrigger === "",
    "an inherited column must seed EMPTY, not with the template's value — seeding it would " +
      "silently convert an inherited column into an override on the next save",
  );

  const none = draftFromConfig(config());
  assert(
    none.formula === "" && none.calcIntervalSeconds === "" && none.maxInputAgeSeconds === "",
    "nothing overridden seeds an empty form",
  );
  assert(none.formulaDialect === "", "and the Grammar select seeds to inherit");

  const relabelled = draftFromConfig(config({ formulaDialect: CALC_DIALECT_V2 }));
  assert(
    relabelled.formulaDialect === CALC_DIALECT_V2,
    `an overridden dialect seeds the Grammar select, got ${JSON.stringify(relabelled.formulaDialect)}`,
  );
}

/**
 * Empty means inherit — for the dialect too (`F2.22` design decision 9, ruling
 * Q2).
 *
 * `draftToBody` used to stamp `bms-calc-v1` beside any formula, on the premise
 * that there was exactly one dialect. `F2.9` made it two, and the stamp became
 * a label the author never chose: a `v2`-shaped formula typed against a `v2`
 * template with Grammar left on inherit was refused for being `v1`. The dialect
 * is now its own column of the draft and is sent exactly as the author set it,
 * with or without a formula. The API accepts both halves alone
 * (`assertFormulaAloneInheritsTheDialect`,
 * `assertADialectOnlyUpgradeOfAValidFormulaIsAccepted` in
 * `asset-point-calc-override.schema.spec.ts`).
 */
export function runDraftToBodyTests(): void {
  const blank = draftToBody(EMPTY_DRAFT);
  assert(
    Object.values(blank).every((value) => value === null),
    "an empty form is five nulls — every column inherits",
  );

  const withFormula = draftToBody({ ...EMPTY_DRAFT, formula: "  {KW} + 1  " });
  assert(withFormula.formula === "{KW} + 1", "the formula is trimmed");
  assert(
    withFormula.formulaDialect === null,
    `inherit sends formulaDialect: null even beside a formula — got ${JSON.stringify(
      withFormula.formulaDialect,
    )}. A stamped label is one the author never chose, and against a v2 template it refuses ` +
      "the v2 syntax they typed (design decision 9)",
  );

  const dialectOnly = draftToBody({ ...EMPTY_DRAFT, formulaDialect: CALC_DIALECT_V2 });
  assert(
    dialectOnly.formulaDialect === CALC_DIALECT_V2 && dialectOnly.formula === null,
    `a chosen dialect is sent without a formula — a dialect-only override, which the API ` +
      `parses on the merged pair. Got ${JSON.stringify(dialectOnly)}`,
  );

  const withoutFormula = draftToBody({ ...EMPTY_DRAFT, calcIntervalSeconds: "45" });
  assert(
    withoutFormula.formulaDialect === null && withoutFormula.formula === null,
    "an interval alone sends neither half of the formula pair",
  );
  assert(withoutFormula.calcIntervalSeconds === 45, "numbers are parsed, not sent as strings");
}

/**
 * `F2.22` item 3 on the override panel — the draft formula is parsed under the
 * **merged** dialect, so T1's ten `v2` sentences reach this surface, and so a
 * `v2`-shaped formula against a `v1` template says which grammar refused it
 * rather than failing after Save.
 *
 * Compared in full, not by substring, for the reason `runV2IsScheduledOnlyTests`
 * gives. The "character 9" is read off a red run (`sum({kw} @site)` — the `@`
 * is the ninth character, and `v1`'s tokenizer stops there; plan correction
 * 25 records the same text on the KPIs tab).
 *
 * The dialect-only draft is the assertion the plan's list was missing: a
 * `v2` label alone over a valid `v1` formula must be **submittable**, because
 * `v2` is a superset (ADR 0055 decision 4) and the API accepts exactly that
 * body. `CALC_FIELDS` names the dialect, so the "sets no column" refusal must
 * not fire on it either.
 */
export function runDialectMirrorTests(): void {
  const V1_REFUSAL = "unexpected character at character 9";
  const inheritV1 = draftProblems({ ...EMPTY_DRAFT, formula: "sum({kw} @site)" }, config());
  assert(
    inheritV1.length === 1,
    `a v2-shaped formula under an inherited v1 grammar is refused once — got ${JSON.stringify(inheritV1)}`,
  );
  assert(
    inheritV1[0] ===
      `Under bms-calc-v1 (inherited from the template) the formula does not parse: ${V1_REFUSAL}.`,
    `the problem names the grammar that refused it and ends with formatCalcError's text, got: ${inheritV1[0]}`,
  );

  const chosenV2 = draftProblems(
    { ...EMPTY_DRAFT, formula: "sum({kw} @site)", formulaDialect: CALC_DIALECT_V2 },
    config(),
  );
  assert(
    chosenV2.length === 0,
    `the same formula under a chosen v2 grammar parses — got ${JSON.stringify(chosenV2)}`,
  );

  const chosenV1 = draftProblems(
    { ...EMPTY_DRAFT, formula: "sum({kw} @site)", formulaDialect: "bms-calc-v1" },
    config({}, { ...V2_TEMPLATE }),
  );
  assert(
    chosenV1.length === 1 &&
      chosenV1[0] === `Under bms-calc-v1 the formula does not parse: ${V1_REFUSAL}.`,
    `a chosen v1 grammar over a v2 template is the merged dialect, and the sentence drops the ` +
      `inherited clause — got ${JSON.stringify(chosenV1)}`,
  );

  const dialectOnly = { ...EMPTY_DRAFT, formulaDialect: CALC_DIALECT_V2 };
  assert(
    canSubmit(dialectOnly, config()),
    `a dialect-only upgrade over a valid v1 formula must be submittable (ADR 0055 decision 4), ` +
      `got: ${JSON.stringify(draftProblems(dialectOnly, config()))}`,
  );

  assert(
    mergedDialect(EMPTY_DRAFT, config({}, { ...V2_TEMPLATE })) === CALC_DIALECT_V2 &&
      mergedDialect(dialectOnly, config()) === CALC_DIALECT_V2 &&
      mergedDialect(EMPTY_DRAFT, config()) === "bms-calc-v1",
    "the merged dialect is the draft's when chosen and the template's when inheriting",
  );
}

/**
 * `F2.22` item 7 on the override panel — a self-reference is a cycle of length
 * one, and the panel says so before the fleet-wide read the server's cycle
 * check costs. A local ref to the point's own key, or an aggregate over its
 * own key (the asset is a member of its own site), are the two shapes a pure
 * check on this request can see; a qualified `{OWN_CODE.key}` needs the asset
 * code, which the DTO does not carry, and stays the server's.
 *
 * `{other}` is the negative control: the panel has no sibling-key list, so an
 * unknown reference is the server's to refuse — and must not be refused here
 * under a sentence about cycles.
 */
export function runSelfReferenceTests(): void {
  const CYCLE = /would form a dependency cycle/;

  const local = draftProblems({ ...EMPTY_DRAFT, formula: "{KWH} * 2" }, config());
  assert(
    local.length === 1 && CYCLE.test(local[0]),
    `a local reference to the point's own key is one cycle problem — got ${JSON.stringify(local)}`,
  );

  const aggregate = draftProblems(
    { ...EMPTY_DRAFT, formula: "sum({KWH} @site)" },
    config({}, { ...V2_TEMPLATE }),
  );
  assert(
    aggregate.length === 1 && CYCLE.test(aggregate[0]),
    `an aggregate over the point's own key is one cycle problem — got ${JSON.stringify(aggregate)}`,
  );
  assert(
    aggregate[0] ===
      'This formula would form a dependency cycle: it reads its own point "KWH". Every point on ' +
        "a cycle waits on another, so none of them ever computes. Break the loop — change this " +
        "formula, or the aggregate scope that draws the other points in.",
    `the fixed part is the server's cycle sentence (asset-point-calc-override.service.ts:250-257), got: ${aggregate[0]}`,
  );

  const other = draftProblems({ ...EMPTY_DRAFT, formula: "{other}" }, config());
  assert(
    other.length === 0,
    `a reference to another key is not the panel's to refuse — got ${JSON.stringify(other)}`,
  );
}

/**
 * `F2.22` item 4 on the override panel — the template's ratio, read-only. A
 * `null` reads as what it means (fail closed, ADR 0055 decision 11), never as
 * a dash that an operator would read as "no limit".
 */
export function runCoverageRatioDisplayTests(): void {
  assert(
    coverageRatioDisplay(null) === "fail closed (every member must be fresh)",
    `null is fail closed, got ${coverageRatioDisplay(null)}`,
  );
  assert(coverageRatioDisplay(0.5) === "0.5", `a stored ratio reads as itself, got ${coverageRatioDisplay(0.5)}`);
}

/**
 * **D-1, before the request rather than after the 400.**
 *
 * `null` meaning inherit makes this the structural mistake, not a careless one:
 * changing the trigger and leaving the interval alone is the obvious thing to
 * do, and the merged result is a counted skip.
 */
export function runD1IsCaughtBeforeSubmitTests(): void {
  const target = config();

  const triggerOnly = draftProblems({ ...EMPTY_DRAFT, calcTrigger: "streaming" }, target);
  assert(triggerOnly.length > 0, "streaming over a scheduled template must be refused");
  assert(
    triggerOnly.join(" ").includes("300s"),
    `the message must name the inherited interval, got: ${triggerOnly.join(" ")}`,
  );
  assert(
    triggerOnly.join(" ").includes("cannot clear an inherited value"),
    "and must say the override is impossible rather than suggesting a fix that cannot work",
  );
  assert(!canSubmit({ ...EMPTY_DRAFT, calcTrigger: "streaming" }, target), "Save must be disabled");

  const streamingTemplate = config({}, { ...SCHEDULED_TEMPLATE, calcTrigger: "streaming", calcIntervalSeconds: null });
  const scheduledNoInterval = draftProblems({ ...EMPTY_DRAFT, calcTrigger: "scheduled" }, streamingTemplate);
  assert(scheduledNoInterval.length > 0, "scheduled with no interval must be refused");
  assert(
    scheduledNoInterval.join(" ").includes("needs an interval"),
    `the message must name what is missing, got: ${scheduledNoInterval.join(" ")}`,
  );

  const both = { ...EMPTY_DRAFT, calcTrigger: "scheduled", calcIntervalSeconds: "60" };
  assert(
    canSubmit(both, streamingTemplate),
    `overriding both together must be allowed, got: ${draftProblems(both, streamingTemplate).join(" ")}`,
  );
}

/** The shared bounds are applied here too, so the 400 is the backstop. */
export function runBoundsTests(): void {
  const target = config();

  assert(
    draftProblems({ ...EMPTY_DRAFT, calcIntervalSeconds: "5" }, target).length > 0,
    "an interval below the shared minimum must be caught",
  );
  assert(
    draftProblems({ ...EMPTY_DRAFT, calcIntervalSeconds: "90000" }, target).length > 0,
    "and above the maximum",
  );
  assert(
    draftProblems({ ...EMPTY_DRAFT, calcIntervalSeconds: "45" }, target).length === 0,
    "a legal interval passes",
  );
  assert(
    draftProblems({ ...EMPTY_DRAFT, maxInputAgeSeconds: "0" }, target).length > 0,
    "the input validity window is bounded at 1",
  );
  assert(
    draftProblems({ ...EMPTY_DRAFT, calcIntervalSeconds: "45.5" }, target).length > 0,
    "a fractional interval is not a whole number of seconds",
  );
}

/**
 * ADR 0055 decision 10 on the **merged** pair, word for word from the API.
 *
 * The mistake decision 6 makes easy: the author overrides `Runs` to streaming
 * on a `v2` template and never touches Grammar, so the `v2` half is inherited
 * and the message says so. Since `F2.22` Grammar is an input, and the second
 * arm is the other way round: a chosen `v2` over a `v1` template makes the
 * merged pair illegal with the dialect half stated, so the sentence drops the
 * inherited clause on that half.
 *
 * The wording is compared in full rather than by substring. The API's sentence
 * and this one are two copies of one rule that `apps/web` cannot import; a
 * substring assertion is exactly what lets them drift apart while staying
 * green.
 *
 * The `v1` control is the anti-vacuity half — the same override on a `v1`
 * template must raise the interval problem and **not** this one.
 */
export function runV2IsScheduledOnlyTests(): void {
  const problems = draftProblems(
    { ...EMPTY_DRAFT, calcTrigger: "streaming" },
    config({}, { ...V2_TEMPLATE }),
  );
  const v2 = problems.filter((problem) => problem.includes(`A "${CALC_DIALECT_V2}" point`));
  assert(
    v2.length === 1,
    `a streaming override on a v2 point is refused once — got ${JSON.stringify(problems)}`,
  );
  assert(
    v2[0] ===
      `The merged formulaDialect is "${CALC_DIALECT_V2}" (inherited from the template) but ` +
        `calcTrigger is "streaming". A "${CALC_DIALECT_V2}" point requires calcTrigger: ` +
        '"scheduled" — a cross-asset formula resolves its members once per sweep and cannot ' +
        "run on a single reading.",
    `the panel must use the API's sentence verbatim, got: ${v2[0]}`,
  );

  const chosen = draftProblems(
    { ...EMPTY_DRAFT, calcTrigger: "streaming", formulaDialect: CALC_DIALECT_V2 },
    config({}, { ...SCHEDULED_TEMPLATE, calcIntervalSeconds: null }),
  ).filter((problem) => problem.includes(`A "${CALC_DIALECT_V2}" point`));
  assert(
    chosen.length === 1 &&
      chosen[0] ===
        `The merged formulaDialect is "${CALC_DIALECT_V2}" but calcTrigger is "streaming". ` +
          `A "${CALC_DIALECT_V2}" point requires calcTrigger: "scheduled" — a cross-asset ` +
          "formula resolves its members once per sweep and cannot run on a single reading.",
    `a chosen v2 grammar states the dialect half, so no inherited clause on it — got ${JSON.stringify(chosen)}`,
  );

  const v1 = draftProblems({ ...EMPTY_DRAFT, calcTrigger: "streaming" }, config());
  assert(
    v1.length > 0,
    "a v1 template scheduled with an interval still refuses a streaming override",
  );
  assert(
    !v1.some((problem) => problem.includes(CALC_DIALECT_V2)),
    `nothing v2 may be said about a v1 point — got ${JSON.stringify(v1)}`,
  );

  assert(
    !canSubmit({ ...EMPTY_DRAFT, calcTrigger: "streaming" }, config({}, { ...V2_TEMPLATE })),
    "and Save stays disabled",
  );
}

/** An empty form is Clear, not Save — the same rule the API applies. */
export function runEmptySubmitIsRefusedTests(): void {
  const problems = draftProblems(EMPTY_DRAFT, config());
  assert(problems.length > 0, "an all-empty form must not be submittable");
  assert(
    problems.join(" ").includes("Clear"),
    `and must point at Clear rather than reading as an error, got: ${problems.join(" ")}`,
  );
}

/**
 * `F2.9` Task 16 — the calc-points status pill's text (plan design decision 9,
 * layer 3).
 *
 * `null` in, `null` out is the case that keeps the pill from appearing at all
 * on a point this API process has not evaluated: the field is nullable for a
 * real reason (the registry is in-process and empty after a restart), and a
 * pill reading "skipped" there would state a refusal that never happened.
 */
export function runRuntimePillLabelTests(): void {
  const at = "2026-09-05T12:00:00.000Z";
  const nowMs = new Date(at).getTime();

  assert(
    calcRuntimePillLabel(null, nowMs) === null,
    "no recorded outcome means no pill — never a pill that invents one",
  );

  assert(
    calcRuntimePillLabel({ lastOutcome: "written", lastSkipReason: null, at }, nowMs + 12_000) ===
      "written 12 s ago",
    `a written point reads as its age, got ${String(
      calcRuntimePillLabel({ lastOutcome: "written", lastSkipReason: null, at }, nowMs + 12_000),
    )}`,
  );
  assert(
    calcRuntimePillLabel({ lastOutcome: "written", lastSkipReason: null, at }, nowMs + 90_000) ===
      "written 1 min ago",
    "past a minute the pill reads in minutes rather than 90 s",
  );
  assert(
    calcRuntimePillLabel({ lastOutcome: "written", lastSkipReason: null, at }, nowMs + 7_200_000) ===
      "written 2 h ago",
    "past an hour it reads in hours — the shape that says a scheduled point has stopped",
  );
  assert(
    calcRuntimePillLabel({ lastOutcome: "written", lastSkipReason: null, at }, nowMs - 4_000) ===
      "written 0 s ago",
    "a browser clock behind the server's must not produce a negative age, which reads as a bug " +
      "in the engine rather than in the clock",
  );

  assert(
    calcRuntimePillLabel({ lastOutcome: "skipped", lastSkipReason: "dependency_cycle", at }, nowMs + 12_000) ===
      "skipped: dependency_cycle",
    "a refusal names its reason and not its age — the reason is what an operator who just moved " +
      "an asset into a group needs, and a refusal repeats every due window anyway",
  );
  assert(
    calcRuntimePillLabel({ lastOutcome: "skipped", lastSkipReason: "a_reason_web_has_never_heard_of", at }, nowMs) ===
      "skipped: a_reason_web_has_never_heard_of",
    "an unknown reason is rendered as received. The vocabulary lives in apps/api and the contract " +
      "keeps the field a plain string for that reason; a web-side lookup would show nothing at all " +
      "the first time the engine gained a reason, which is when it matters most.",
  );
  assert(
    calcRuntimePillLabel({ lastOutcome: "skipped", lastSkipReason: null, at }, nowMs) === "skipped",
    "a skip with no reason still renders a pill, without a dangling colon",
  );
}
