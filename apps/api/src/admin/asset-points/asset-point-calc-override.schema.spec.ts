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

const KEYS = ["KW", "VOLTS", "KWH"];

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
    !assetPointCalcOverrideBodySchema.safeParse({ ...base, formulaDialect: "bms-calc-v2" }).success,
    "an unknown dialect must be rejected — the engine runs exactly one",
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
