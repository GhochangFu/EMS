import type { AssetPointCalcOverrideFields } from "@bms/shared";

import {
  assetPointCalcOverrideBodySchema,
  validateMergedCalcOverride,
} from "./asset-point-calc-override.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NOTHING: AssetPointCalcOverrideFields = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
};

const SCHEDULED_TEMPLATE: AssetPointCalcOverrideFields = {
  formula: "{KW} * 2",
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 300,
  maxInputAgeSeconds: 600,
};

const STREAMING_TEMPLATE: AssetPointCalcOverrideFields = {
  formula: "{KW} * 2",
  formulaDialect: "bms-calc-v1",
  calcTrigger: "streaming",
  calcIntervalSeconds: null,
  maxInputAgeSeconds: 600,
};

/** A `bms-calc-v2` template point: decision 10 makes it scheduled, with an
 * interval — the shape `templatePointBodySchema` is the only one that can now
 * be published, so the override cases below merge against a real one. */
const V2_TEMPLATE: AssetPointCalcOverrideFields = {
  formula: "sum({KW} @site)",
  formulaDialect: "bms-calc-v2",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 60,
  maxInputAgeSeconds: 600,
};

const MEASURED_KEYS = ["KW", "VOLTS", "KWH"];
/** The derived sibling `v1` must refuse and `v2` must admit, plus the
 * overridden point itself — `all` is every key the pinned version declares. */
const DERIVED_SIBLING = "SITE_TOTAL";
const SELF_KEY = "THIS_POINT";

/**
 * The two lists guard 3 is now gated on. `measured` is what a `v1` formula may
 * reference (ADR 0036 decision 7, unchanged); `all` is what a `v2` formula may
 * reference (ADR 0055 decision 7 repeals the ban).
 */
const KEYS = {
  measured: MEASURED_KEYS,
  all: [...MEASURED_KEYS, DERIVED_SIBLING, SELF_KEY],
};

/**
 * The bounds are the schema's, and they are the *same numbers*
 * `templatePointBodySchema` enforces — imported, never restated.
 *
 * These matter because the alternative to rejecting them here is the engine's
 * skip counter: a stored override outside the bounds is not an error anywhere,
 * it is a formula that quietly stops running with a reason only a metric knows.
 */
export function assertBoundsAreEnforcedByTheSchema(): void {
  const base = {
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
  };

  assert(assetPointCalcOverrideBodySchema.safeParse(base).success, "an all-null override is legal — it means inherit");

  assert(
    !assetPointCalcOverrideBodySchema.safeParse({ ...base, calcIntervalSeconds: 9 }).success,
    "calcIntervalSeconds below 10 must be rejected by the schema, not by the engine",
  );
  assert(
    !assetPointCalcOverrideBodySchema.safeParse({ ...base, calcIntervalSeconds: 86_401 }).success,
    "calcIntervalSeconds above 86400 must be rejected",
  );
  assert(
    assetPointCalcOverrideBodySchema.safeParse({ ...base, calcIntervalSeconds: 10 }).success &&
      assetPointCalcOverrideBodySchema.safeParse({ ...base, calcIntervalSeconds: 86_400 }).success,
    "both ends of the interval range must be accepted, or the bound is off by one",
  );
  assert(
    !assetPointCalcOverrideBodySchema.safeParse({ ...base, maxInputAgeSeconds: 0 }).success &&
      !assetPointCalcOverrideBodySchema.safeParse({ ...base, maxInputAgeSeconds: 86_401 }).success,
    "maxInputAgeSeconds is bounded 1..86400",
  );
  assert(
    assetPointCalcOverrideBodySchema.safeParse({ ...base, formulaDialect: "bms-calc-v2" }).success,
    'ADR 0055 decision 2 — "bms-calc-v2" is a dialect this engine runs, and this endpoint is ' +
      "the second author for the same engine. A literal here would refuse at one endpoint a " +
      "row every other endpoint accepts (tests/adr-0055-calc-v2-invariants.test.ts part (c))",
  );
  assert(
    !assetPointCalcOverrideBodySchema.safeParse({ ...base, formulaDialect: "bms-calc-v3" }).success,
    "and a dialect outside CALC_DIALECTS must still be rejected — widening to an enum is not " +
      "the same as accepting anything",
  );
  assert(
    !assetPointCalcOverrideBodySchema.safeParse({ ...base, calcTrigger: "cron" }).success,
    "an unknown trigger must be rejected",
  );
  assert(
    !assetPointCalcOverrideBodySchema.safeParse({ formula: null }).success,
    "every field is required-but-nullable: omitting one is not the same as inheriting it, " +
      "and accepting both spellings would make 'clear this column' unexpressible",
  );
}

/**
 * **D-1, the case this function exists for.**
 *
 * Template `scheduled` with interval 300. An override of `calcTrigger:
 * 'streaming'` alone merges to streaming-with-an-interval, which
 * `toActiveDefinition` classifies as `interval_on_streaming` and drops as a
 * counted skip. Without this check the write returns 200, the UI shows an
 * override, and the formula silently stops computing.
 */
export function assertTriggerOnlyOverrideIsRejectedNamingTheInheritedInterval(): void {
  const problems = validateMergedCalcOverride(
    { ...NOTHING, calcTrigger: "streaming" },
    SCHEDULED_TEMPLATE,
    KEYS,
  );

  assert(problems.length > 0, "overriding calcTrigger to streaming alone must be rejected");
  const joined = problems.join(" ");
  assert(
    joined.includes("300"),
    `the message must name the INHERITED interval — the author never typed one and cannot ` +
      `see what they are colliding with. Got: ${joined}`,
  );
  assert(
    joined.includes("inherited"),
    `the message must say the interval is inherited, not merely that it exists. Got: ${joined}`,
  );
  assert(
    joined.includes("cannot clear an inherited value"),
    "and it must say that this override is impossible rather than suggesting a fix that " +
      `cannot work: null means inherit, so the template's interval cannot be cleared. Got: ${joined}`,
  );
}

/** The mirror: template streaming, override to scheduled with no interval. */
export function assertScheduledWithoutIntervalIsRejected(): void {
  const problems = validateMergedCalcOverride(
    { ...NOTHING, calcTrigger: "scheduled" },
    STREAMING_TEMPLATE,
    KEYS,
  );
  assert(problems.length > 0, "scheduled with no interval must be rejected");
  assert(
    problems.join(" ").includes("calcIntervalSeconds"),
    "the message must name the missing column",
  );
}

/** And overriding both together succeeds — the check is not simply "no trigger change". */
export function assertOverridingBothColumnsTogetherIsAccepted(): void {
  const problems = validateMergedCalcOverride(
    { ...NOTHING, calcTrigger: "scheduled", calcIntervalSeconds: 60 },
    STREAMING_TEMPLATE,
    KEYS,
  );
  assert(
    problems.length === 0,
    `overriding trigger and interval together must be accepted, got: ${problems.join(" ")}`,
  );
}

/** A single-column override of something unrelated leaves the merge usable. */
export function assertAnUnrelatedSingleColumnOverrideIsAccepted(): void {
  const problems = validateMergedCalcOverride(
    { ...NOTHING, maxInputAgeSeconds: 30 },
    SCHEDULED_TEMPLATE,
    KEYS,
  );
  assert(
    problems.length === 0,
    `overriding maxInputAgeSeconds alone must be accepted, got: ${problems.join(" ")}`,
  );
}

/**
 * The formula is validated against the point keys the pinned version declares.
 *
 * Parse errors and unknown references are the same class of problem: both
 * produce a stored formula the engine drops as a counted skip.
 */
export function assertFormulaIsValidatedAgainstDeclaredKeys(): void {
  const unparseable = validateMergedCalcOverride(
    { ...NOTHING, formula: "{KW} * * 2", formulaDialect: "bms-calc-v1" },
    SCHEDULED_TEMPLATE,
    KEYS,
  );
  assert(unparseable.length > 0, "an unparseable formula must be rejected by the schema layer");

  const unknownRef = validateMergedCalcOverride(
    { ...NOTHING, formula: "{NOT_DECLARED} + 1", formulaDialect: "bms-calc-v1" },
    SCHEDULED_TEMPLATE,
    KEYS,
  );
  assert(
    unknownRef.length > 0,
    "a formula referencing a point the template version does not declare must be rejected — " +
      "the asset has no such point to read",
  );
  assert(
    unknownRef.join(" ").includes("KW"),
    "the message must list the keys that ARE available, or the author cannot act on it",
  );

  const good = validateMergedCalcOverride(
    { ...NOTHING, formula: "{VOLTS} * 3", formulaDialect: "bms-calc-v1" },
    SCHEDULED_TEMPLATE,
    KEYS,
  );
  assert(good.length === 0, `a valid formula over declared keys must pass, got: ${good.join(" ")}`);
}

/** An override of the formula without the dialect still merges to a usable pair. */
export function assertFormulaAloneInheritsTheDialect(): void {
  const problems = validateMergedCalcOverride(
    { ...NOTHING, formula: "{VOLTS} * 3" },
    SCHEDULED_TEMPLATE,
    KEYS,
  );
  assert(
    problems.length === 0,
    `the dialect must be inheritable — restating it on every formula edit is exactly the ` +
      `restatement decision 6 exists to avoid. Got: ${problems.join(" ")}`,
  );
}

/** A template with nothing set cannot be rescued by a partial override. */
export function assertAnEmptyTemplateNeedsAFullOverride(): void {
  const partial = validateMergedCalcOverride({ ...NOTHING, calcTrigger: "streaming" }, NOTHING, KEYS);
  assert(partial.length > 0, "trigger alone over an empty template has no formula to run");
  assert(
    partial.join(" ").includes("no formula"),
    "and the message must say which part is missing",
  );

  const full = validateMergedCalcOverride(
    {
      formula: "{KW} + 1",
      formulaDialect: "bms-calc-v1",
      calcTrigger: "streaming",
      calcIntervalSeconds: null,
      maxInputAgeSeconds: 60,
    },
    NOTHING,
    KEYS,
  );
  assert(full.length === 0, `a complete override over an empty template must pass, got: ${full.join(" ")}`);
}

// --- ADR 0055 `F2.9` — guard 3, dialect-gated --------------------------------

/**
 * **Guard 3's `v1` half, and it must not weaken.**
 *
 * ADR 0055 decision 7 repeals "a derived formula may only reference measured
 * points" for `bms-calc-v2` **only**. A `v1` override that names a derived
 * sibling is still the runaway series the guard exists to stop:
 * `CalcSchedulerService` stamps a fresh wall-clock bucket every tick, so
 * `ON CONFLICT DO NOTHING` never dedupes it and the value compounds.
 *
 * Matched on `formatCalcError`'s wording, not on the offending key — that
 * function deliberately never echoes a fragment of the input back, and
 * `asset-point-calc-override.integration.spec.ts` matches the same phrase.
 */
export function assertV1OverrideStillRefusesADerivedSibling(): void {
  const sibling = validateMergedCalcOverride(
    { ...NOTHING, formula: `{${DERIVED_SIBLING}} * 2`, formulaDialect: "bms-calc-v1" },
    SCHEDULED_TEMPLATE,
    KEYS,
  );
  assert(
    sibling.length > 0,
    "a bms-calc-v1 override referencing a derived sibling must still be refused — decision 7 " +
      "repeals that ban for v2 only",
  );
  assert(
    sibling.join(" ").includes("unknown point"),
    `and it must be refused as an unknown reference, the message the v1 path has always ` +
      `produced. Got: ${sibling.join(" ")}`,
  );

  const self = validateMergedCalcOverride(
    { ...NOTHING, formula: `{${SELF_KEY}} * 2`, formulaDialect: "bms-calc-v1" },
    SCHEDULED_TEMPLATE,
    KEYS,
  );
  assert(
    self.join(" ").includes("unknown point"),
    `a v1 self-reference must be refused the same way. Got: ${self.join(" ")}`,
  );
}

/**
 * **The `v2` half.** Decision 7: a `v2` formula may reference a derived point,
 * and the *cycle* — not the reference — is what has to be refused. That check
 * needs the real dependency graph and lands with `F2.9` Task 12
 * (`CalcDependencyService.checkCandidate`), called from the service.
 */
export function assertV2OverrideAdmitsADerivedSiblingAndAnAggregate(): void {
  const sibling = validateMergedCalcOverride(
    { ...NOTHING, formula: `{${DERIVED_SIBLING}} * 2`, formulaDialect: "bms-calc-v2" },
    SCHEDULED_TEMPLATE,
    KEYS,
  );
  assert(
    sibling.length === 0,
    `a bms-calc-v2 override may reference a derived sibling (ADR 0055 decision 7), got: ${sibling.join(" ")}`,
  );

  const aggregate = validateMergedCalcOverride(
    { ...NOTHING, formula: "sum({KW} @site)", formulaDialect: "bms-calc-v2" },
    SCHEDULED_TEMPLATE,
    KEYS,
  );
  assert(
    aggregate.length === 0,
    `a v2 aggregate must parse and pass the declared-key check — its member point keys are ` +
      `resolved at evaluation time, not against this list. Got: ${aggregate.join(" ")}`,
  );

  // Anti-vacuity in the other direction: `v2` widens which keys are known, it
  // does not stop checking. A key no version of this template declares is
  // still refused.
  const unknown = validateMergedCalcOverride(
    { ...NOTHING, formula: "{NOT_DECLARED} + 1", formulaDialect: "bms-calc-v2" },
    SCHEDULED_TEMPLATE,
    KEYS,
  );
  assert(
    unknown.join(" ").includes("unknown point"),
    `a v2 formula naming an undeclared local key must still be refused, got: ${unknown.join(" ")}`,
  );

  // And the same aggregate under `v1` is a syntax error, so the gate is on the
  // dialect and not on the shape of the text.
  const v1Aggregate = validateMergedCalcOverride(
    { ...NOTHING, formula: "sum({KW} @site)", formulaDialect: "bms-calc-v1" },
    SCHEDULED_TEMPLATE,
    KEYS,
  );
  assert(
    v1Aggregate.length > 0,
    "the same cross-asset formula must be refused under bms-calc-v1 — v1 keeps its meaning " +
      "forever (ADR 0055 decision 3)",
  );
}

/**
 * ADR 0055 decision 10, mirrored from `templatePointBodySchema`. A `v2` formula
 * resolves its cross-asset membership once per sweep, so there is nothing for it
 * to resolve against on a single incoming reading — a streaming `v2` point
 * stores clean and never computes.
 */
export function assertV2StreamingIsRefusedOnTheMergedPair(): void {
  const problems = validateMergedCalcOverride(
    { ...NOTHING, formula: "sum({KW} @site)", formulaDialect: "bms-calc-v2" },
    STREAMING_TEMPLATE,
    KEYS,
  );
  assert(
    problems.join(" ").includes("cannot run on a single reading"),
    `a v2 formula merged onto a streaming trigger must be refused with decision 10's reason. ` +
      `Got: ${problems.join(" ")}`,
  );
  assert(
    problems.join(" ").includes('calcTrigger: "scheduled"'),
    `and the message must name the trigger the author has to set. Got: ${problems.join(" ")}`,
  );
}

/**
 * The D-1 shape of the same rule: the author overrides `calcTrigger` alone, and
 * the dialect that makes it illegal is one they never typed and cannot see.
 *
 * Asserted on the message's content, never on `problems.length` — a `v2`
 * template is scheduled *with an interval* (decision 10 plus the existing
 * `scheduled -> interval required` branch), so overriding the trigger to
 * `streaming` also trips the streaming-with-an-inherited-interval branch. Two
 * problems is the honest answer; both are true.
 */
export function assertV2InheritedDialectIsNamedWhenOnlyTheTriggerIsOverridden(): void {
  const problems = validateMergedCalcOverride(
    { ...NOTHING, calcTrigger: "streaming" },
    V2_TEMPLATE,
    KEYS,
  );
  const joined = problems.join(" ");
  assert(
    joined.includes("bms-calc-v2"),
    `the message must name the inherited dialect — the author never typed it. Got: ${joined}`,
  );
  assert(
    joined.includes("inherited"),
    `and must say it is inherited rather than merely that it is set. Got: ${joined}`,
  );
  assert(
    joined.includes("cannot run on a single reading"),
    `and must give decision 10's reason. Got: ${joined}`,
  );
}

/** A `v2` template left scheduled is usable — the refusal above is the trigger,
 * not the dialect. */
export function assertAV2TemplateIsOverridableWithoutRestatingTheDialect(): void {
  const problems = validateMergedCalcOverride(
    { ...NOTHING, calcIntervalSeconds: 120 },
    V2_TEMPLATE,
    KEYS,
  );
  assert(
    problems.length === 0,
    `an unrelated column override on a v2 point must be accepted, got: ${problems.join(" ")}`,
  );
}

/** A dialect the engine does not run is still refused, and the message names
 * every dialect it does run rather than one. */
export function assertAnUnknownStoredDialectIsRefused(): void {
  const problems = validateMergedCalcOverride(
    { ...NOTHING, formula: "{KW} + 1" },
    {
      ...SCHEDULED_TEMPLATE,
      // A stored row can hold anything: `toFields` carries the column through
      // rather than coercing it, so this reaches the merge as-is.
      formulaDialect: "bms-calc-v3" as AssetPointCalcOverrideFields["formulaDialect"],
    },
    KEYS,
  );
  const joined = problems.join(" ");
  assert(joined.includes("not a dialect this engine runs"), `got: ${joined}`);
  assert(
    joined.includes("bms-calc-v1") && joined.includes("bms-calc-v2"),
    `and the message must name every dialect that is runnable, not one. Got: ${joined}`,
  );

  // The other half of the same condition, and a real stored shape: a template
  // that carries a formula with a NULL `formula_dialect`. Neither row states a
  // dialect, so the merge has a formula and nothing to run it with — reported
  // as "unset" rather than as a parse failure against an assumed `v1`.
  const unset = validateMergedCalcOverride(
    { ...NOTHING, formula: "{KW} + 1" },
    { ...SCHEDULED_TEMPLATE, formulaDialect: null },
    KEYS,
  );
  assert(
    unset.join(" ").includes("unset") && unset.join(" ").includes("not a dialect this engine runs"),
    `a merged formula with no dialect at all must be refused as unset, got: ${unset.join(" ")}`,
  );
}
