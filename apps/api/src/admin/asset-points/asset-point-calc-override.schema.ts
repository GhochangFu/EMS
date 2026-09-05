import { z } from "zod";

import {
  CALC_DIALECT,
  CALC_DIALECTS,
  CALC_DIALECT_V2,
  CALC_TRIGGERS,
  MAX_CALC_INTERVAL_SECONDS,
  MAX_FORMULA_LENGTH,
  MAX_INPUT_AGE_SECONDS_BOUND,
  MIN_CALC_INTERVAL_SECONDS,
  calcDialectSchema,
  formatCalcError,
  validateFormula,
} from "@bms/shared";
import type { AssetPointCalcOverrideFields } from "@bms/shared";

/**
 * `F2.6` — one asset's override of the calc configuration its pinned template
 * version declares (ADR 0039 decisions 6 and 7).
 *
 * Every field is **required but nullable**, not optional. A `PUT` states the
 * whole override, and `null` means "inherit this column from the template" —
 * the same thing the stored column means. Making them optional would give two
 * spellings of "leave this alone" (absent, and `null`) that the client cannot
 * distinguish from "clear this one field", and clearing is what `DELETE` is
 * for.
 *
 * Bounds are imported from `@bms/shared`, never restated. They are the same
 * numbers `templatePointBodySchema` enforces, because the merged result has to
 * satisfy exactly what the engine would have required of the template.
 */
/**
 * The `:pointKey` path parameter.
 *
 * Bounded the way `bms.asset_points.point_key` is. The service already refuses
 * any key the pinned version does not declare, so this changes no outcome for a
 * legitimate call — it moves an over-long key from a 404 ("the version does not
 * declare it") to a 400, which is what actually went wrong, and it matches the
 * repo's convention of parsing path parameters (AGENTS.md §4.3).
 */
export const calcPointKeyParamSchema = z.string().min(1).max(128);

/** `CALC_DIALECTS` as a lookup, for the *stored* value on a row this endpoint
 * did not write. `readonly [...]`'s `.includes` will not take a `string`. */
const RUNNABLE_DIALECTS: ReadonlySet<string> = new Set(CALC_DIALECTS);

export const assetPointCalcOverrideBodySchema = z
  .object({
    formula: z.string().min(1).max(MAX_FORMULA_LENGTH).nullable(),
    // ADR 0055 decision 2 (`F2.9`): the vocabulary is `CALC_DIALECTS`, derived
    // once as `calcDialectSchema`. Never a literal — a literal here refuses
    // `bms-calc-v2` at this endpoint while the template author's endpoint
    // accepts it, so the same stored row reads back on one page and 400s on
    // another (`tests/adr-0055-calc-v2-invariants.test.ts` part (c)).
    formulaDialect: calcDialectSchema.nullable(),
    calcTrigger: z.enum(CALC_TRIGGERS).nullable(),
    calcIntervalSeconds: z
      .number()
      .int()
      .min(MIN_CALC_INTERVAL_SECONDS)
      .max(MAX_CALC_INTERVAL_SECONDS)
      .nullable(),
    maxInputAgeSeconds: z.number().int().min(1).max(MAX_INPUT_AGE_SECONDS_BOUND).nullable(),
  })
  .strict();

export type AssetPointCalcOverrideBody = z.infer<typeof assetPointCalcOverrideBodySchema>;

/**
 * D-1 — validates the **merged** result, not the override in isolation.
 *
 * This cannot be a Zod refinement: the rule spans two rows. Template
 * `scheduled` with interval 300, overridden with `calcTrigger: 'streaming'`
 * alone, merges to streaming-with-an-interval — which `toActiveDefinition`
 * classifies as `interval_on_streaming` and drops as a **counted skip**. The
 * write would return 200, the UI would show an override, and the formula would
 * silently stop computing. Every one of those is a plausible screen; none of
 * them says anything is wrong.
 *
 * So the check runs against the merged pair and the message names the
 * *inherited* value, because "interval required" is not actionable when the
 * author never typed an interval and cannot see the one they are colliding
 * with.
 *
 * Pure, and separate from the service, so every combination is enumerable in a
 * unit test without a database.
 *
 * ## `F2.9` — guard 3 is dialect-gated, not removed
 *
 * `declared` arrives as two lists because ADR 0055 decision 7 repeals "a
 * derived formula may only reference measured points" for `bms-calc-v2`
 * **only**. Under `v1` the known set is still `declared.measured`, so a
 * reference to a derived sibling (or to the overridden point itself) comes back
 * as `unknown_reference` — byte-for-byte the refusal this endpoint has always
 * made, and the one `assertFormulaCannotReferenceADerivedPoint` holds. Under
 * `v2` it is `declared.all`: a cross-asset formula reads other assets' points,
 * and a site total is a derived point by construction, so the ban would refuse
 * the dialect's own purpose. What replaces it is a **cycle** check on the real
 * dependency graph, which needs membership resolution and lands with `F2.9`
 * Task 12 (`CalcDependencyService.checkCandidate`, called from the service).
 *
 * **Every rule here is a rule about the merged pair**, and the formula parse is
 * no exception — an override that sets `formulaDialect` alone re-labels a
 * formula it did not write, and `CalcDefinitionsService.reload` coalesces the
 * two columns independently. See the branch below.
 *
 * @param override what this request sets, per column; `null` inherits
 * @param template the pinned version's values for the same five columns
 * @param declared the point keys that version declares — `measured` is what a
 *   `v1` formula may reference, `all` what a `v2` one may
 * @returns the problems, most specific first; empty means the merge is usable
 */
export function validateMergedCalcOverride(
  override: AssetPointCalcOverrideFields,
  template: AssetPointCalcOverrideFields,
  declared: { readonly measured: readonly string[]; readonly all: readonly string[] },
): string[] {
  const merged: AssetPointCalcOverrideFields = {
    formula: override.formula ?? template.formula,
    formulaDialect: override.formulaDialect ?? template.formulaDialect,
    calcTrigger: override.calcTrigger ?? template.calcTrigger,
    calcIntervalSeconds: override.calcIntervalSeconds ?? template.calcIntervalSeconds,
    maxInputAgeSeconds: override.maxInputAgeSeconds ?? template.maxInputAgeSeconds,
  };
  const inherited = (field: keyof AssetPointCalcOverrideFields): string =>
    override[field] === null ? " (inherited from the template)" : "";

  const problems: string[] = [];
  const dialect = merged.formulaDialect;

  if (merged.formula === null) {
    problems.push(
      "The merged configuration has no formula: the template does not set one and this " +
        "override does not either. A derived point with no formula computes nothing.",
    );
  } else if (dialect === null || !RUNNABLE_DIALECTS.has(dialect)) {
    // `AssetPointCalcOverrideFields.formulaDialect` is typed to `CalcDialect`,
    // but `toFields` carries a *stored* column through rather than coercing it
    // (a row can predate a vocabulary), so this membership test is a runtime
    // question and not a redundant one.
    problems.push(
      `The merged formulaDialect is ${dialect === null ? "unset" : `"${dialect}"`}` +
        `${inherited("formulaDialect")}, which is not a dialect this engine runs. Set ` +
        `formulaDialect alongside the formula, to ` +
        `${CALC_DIALECTS.map((known) => `"${known}"`).join(" or ")}.`,
    );
  } else if (override.formula !== null || override.formulaDialect !== null) {
    // The **merged** formula, under the **merged** dialect, whenever this
    // request states *either* half — not only when it states the formula.
    //
    // It used to be only the new formula, and that was sound while
    // `formulaDialect` had one legal value: a dialect nobody could change
    // could not change what the inherited formula means. `F2.9` makes it a
    // two-member enum, so an override that sets the dialect alone **re-labels
    // the template's formula** — and `CalcDefinitionsService.reload` coalesces
    // `formula` and `formula_dialect` independently, so that relabelled pair
    // is what the engine runs. Parsed nowhere else, a `v1` label on a `v2`
    // formula walks past `runScheduledSweep`'s `def.dialect !== CALC_DIALECT`
    // refusal and gets evaluated as an ordinary local formula — the runaway
    // the plan's finding 22 exists to stop, reached around it. Decision 3
    // ("a `v1` formula keeps its exact current meaning, forever") is a
    // property of the merged pair, exactly as decision 10 below already is.
    //
    // An override that states **neither** half still does not parse the stored
    // formula, and that boundary is deliberate: a stored template formula that
    // no longer validates is `toActiveDefinition`'s counted skip to report, and
    // rejecting an unrelated override because of it would strand the point.
    //
    // **Guard 3, gated on the dialect** — see the docblock. `v1` keeps the
    // measured-only set and therefore keeps its refusal verbatim; `v2` gets
    // every declared key.
    const knownRefs = dialect === CALC_DIALECT ? declared.measured : declared.all;
    const result = validateFormula(merged.formula, knownRefs, { dialect });
    if (!result.ok) {
      const first = result.errors[0];
      problems.push(
        `The formula${inherited("formula")} is not valid ` +
          `${dialect}${inherited("formulaDialect")}: ` +
          `${first ? formatCalcError(first) : "unparseable"}. It may reference only the ` +
          `point keys this asset's template version declares: ${knownRefs.join(", ")}.`,
      );
    }
  }

  // ADR 0055 decision 10, mirroring `templatePointBodySchema`'s per-point
  // refinement word for word — this endpoint is a second author for the same
  // engine, and a rule enforced in one path and not the other is not a style
  // difference. A `bms-calc-v2` formula resolves its cross-asset membership
  // once per sweep, so there is nothing for it to resolve against on a single
  // incoming reading: a streaming `v2` point stores clean and never computes.
  //
  // The dialect is named with `inherited(...)` because the D-1 case here is an
  // author who overrides `calcTrigger` alone and never typed the dialect that
  // makes it illegal.
  if (dialect === CALC_DIALECT_V2 && merged.calcTrigger === "streaming") {
    problems.push(
      `The merged formulaDialect is "${CALC_DIALECT_V2}"${inherited("formulaDialect")} but ` +
        `calcTrigger is "streaming"${inherited("calcTrigger")}. A "${CALC_DIALECT_V2}" point ` +
        `requires calcTrigger: "scheduled" — a cross-asset formula resolves its members once ` +
        "per sweep and cannot run on a single reading.",
    );
  }

  if (merged.calcTrigger === null) {
    problems.push(
      "The merged calcTrigger is unset. A derived point with no trigger never runs — the " +
        "engine treats it as a counted skip rather than assuming a default.",
    );
  } else if (merged.calcTrigger === "scheduled" && merged.calcIntervalSeconds === null) {
    problems.push(
      `calcTrigger is "scheduled"${inherited("calcTrigger")} but calcIntervalSeconds is ` +
        `unset${inherited("calcIntervalSeconds")}. A scheduled formula needs an interval; ` +
        "set both together.",
    );
  } else if (merged.calcTrigger === "streaming" && merged.calcIntervalSeconds !== null) {
    // The one asymmetry decision 6's coalesce creates, stated plainly rather
    // than papered over. `null` in an override means *inherit*, so an override
    // has no way to spell "clear the template's interval": a template that is
    // `scheduled` with an interval cannot be overridden to `streaming` at all.
    // Suggesting "set calcIntervalSeconds to null" would be advice that cannot
    // work, and the author would try it and get this same message back.
    problems.push(
      `calcTrigger is "streaming"${inherited("calcTrigger")} but calcIntervalSeconds is ` +
        `${merged.calcIntervalSeconds}${inherited("calcIntervalSeconds")}. A streaming ` +
        "formula runs on its inputs and must carry no interval." +
        (override.calcIntervalSeconds === null && template.calcIntervalSeconds !== null
          ? " An override cannot clear an inherited value — null means inherit — so a " +
            "scheduled template point cannot be overridden to streaming. Change the " +
            "template version, or leave this point's trigger alone."
          : " Set calcIntervalSeconds and calcTrigger consistently in the same request."),
    );
  }

  return problems;
}
