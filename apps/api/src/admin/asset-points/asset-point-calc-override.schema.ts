import { z } from "zod";

import {
  CALC_DIALECT,
  CALC_TRIGGERS,
  MAX_CALC_INTERVAL_SECONDS,
  MAX_FORMULA_LENGTH,
  MAX_INPUT_AGE_SECONDS_BOUND,
  MIN_CALC_INTERVAL_SECONDS,
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
export const assetPointCalcOverrideBodySchema = z.object({
  formula: z.string().min(1).max(MAX_FORMULA_LENGTH).nullable(),
  formulaDialect: z.literal(CALC_DIALECT).nullable(),
  calcTrigger: z.enum(CALC_TRIGGERS).nullable(),
  calcIntervalSeconds: z
    .number()
    .int()
    .min(MIN_CALC_INTERVAL_SECONDS)
    .max(MAX_CALC_INTERVAL_SECONDS)
    .nullable(),
  maxInputAgeSeconds: z.number().int().min(1).max(MAX_INPUT_AGE_SECONDS_BOUND).nullable(),
});

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
 * @param override what this request sets, per column; `null` inherits
 * @param template the pinned version's values for the same five columns
 * @param declaredPointKeys the point keys that version declares — a formula
 *   may only reference points the asset actually has
 * @returns the problems, most specific first; empty means the merge is usable
 */
export function validateMergedCalcOverride(
  override: AssetPointCalcOverrideFields,
  template: AssetPointCalcOverrideFields,
  declaredPointKeys: readonly string[],
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

  if (merged.formula === null) {
    problems.push(
      "The merged configuration has no formula: the template does not set one and this " +
        "override does not either. A derived point with no formula computes nothing.",
    );
  } else if (merged.formulaDialect !== CALC_DIALECT) {
    problems.push(
      `The merged formulaDialect is ${merged.formulaDialect === null ? "unset" : `"${merged.formulaDialect}"`}` +
        `${inherited("formulaDialect")}, but the only dialect this engine runs is ` +
        `"${CALC_DIALECT}". Set formulaDialect alongside the formula.`,
    );
  } else if (override.formula !== null) {
    // Only the *new* formula is parsed. A stored template formula that no
    // longer validates is `toActiveDefinition`'s counted skip to report, and
    // rejecting an unrelated override because of it would strand the point.
    const result = validateFormula(override.formula, declaredPointKeys);
    if (!result.ok) {
      const first = result.errors[0];
      problems.push(
        `The formula is not valid ${CALC_DIALECT}: ` +
          `${first ? formatCalcError(first) : "unparseable"}. It may reference only the ` +
          `point keys this asset's template version declares: ${declaredPointKeys.join(", ")}.`,
      );
    }
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
