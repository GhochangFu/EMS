import {
  CALC_DIALECT,
  MAX_CALC_INTERVAL_SECONDS,
  MAX_INPUT_AGE_SECONDS_BOUND,
  MIN_CALC_INTERVAL_SECONDS,
} from "@bms/shared";
import type { AssetPointCalcConfigDto, AssetPointCalcOverrideFields } from "@bms/shared";

/**
 * The rules behind the per-point calc override panel (`F2.6`, ADR 0039
 * decisions 6, 7 and 8).
 *
 * In `lib/` for the reason `template-tabs.ts` records: `apps/web`'s Vitest
 * project runs `environment: "node"` over `src/**\/*.test.ts` and the coverage
 * gate reaches `src/lib/**` and nothing above it, so a `.tsx` is untestable and
 * uncovered here. The panel holds no logic.
 *
 * ## Why D-1 is checked in the browser at all
 *
 * The API enforces it and is the authority — this does not replace it. But
 * ADR 0039 decision 6 makes `null` mean *inherit*, so the mistake is
 * structural rather than careless: an author who changes the trigger and leaves
 * the interval alone has done the obvious thing, and the merged result is a
 * counted skip. Learning that from a 400 after pressing Save teaches the rule
 * once, at the worst moment. The panel says it while they are still typing, in
 * the same terms, and the pure spec asserts both.
 */

/** How one column reads in the panel. */
export type ColumnOrigin = "overridden" | "inherited" | "unset";

/** Which of the five columns is set on this asset, and which falls through. */
export function columnOrigin(
  config: AssetPointCalcConfigDto,
  field: keyof AssetPointCalcOverrideFields,
): ColumnOrigin {
  if (config.override[field] !== null) {
    return "overridden";
  }
  return config.template[field] !== null ? "inherited" : "unset";
}

/** Whether this point departs from its template at all. */
export function hasAnyOverride(config: AssetPointCalcConfigDto): boolean {
  return CALC_FIELDS.some((field) => config.override[field] !== null);
}

/**
 * Clear is available only when there is something to clear.
 *
 * The API returns 404 for a clear with no row, so an always-enabled button
 * produces an error that says nothing went wrong — the worst kind.
 */
export function canClear(config: AssetPointCalcConfigDto): boolean {
  return hasAnyOverride(config);
}

export const CALC_FIELDS: readonly (keyof AssetPointCalcOverrideFields)[] = [
  "formula",
  "formulaDialect",
  "calcTrigger",
  "calcIntervalSeconds",
  "maxInputAgeSeconds",
];

/** One row of the panel: what the template says, what this asset says, what runs. */
export type CalcFieldRow = {
  field: keyof AssetPointCalcOverrideFields;
  label: string;
  origin: ColumnOrigin;
  templateValue: string;
  effectiveValue: string;
};

const LABELS: Record<keyof AssetPointCalcOverrideFields, string> = {
  formula: "Formula",
  formulaDialect: "Dialect",
  calcTrigger: "Runs",
  calcIntervalSeconds: "Every",
  maxInputAgeSeconds: "Inputs valid for",
};

function display(field: keyof AssetPointCalcOverrideFields, value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (field === "calcIntervalSeconds" || field === "maxInputAgeSeconds") {
    return `${String(value)}s`;
  }
  return String(value);
}

/**
 * The panel's rows.
 *
 * All three of template, override and effective are carried rather than only
 * the effective value: "300s" tells an operator what runs but not whether
 * changing the template would change it, and that is the whole question an
 * override page exists to answer.
 */
export function calcFieldRows(config: AssetPointCalcConfigDto): CalcFieldRow[] {
  return CALC_FIELDS.map((field) => ({
    field,
    label: LABELS[field],
    origin: columnOrigin(config, field),
    templateValue: display(field, config.template[field]),
    effectiveValue: display(field, config.effective[field]),
  }));
}

/** The draft an author edits: empty string means "leave this column inheriting". */
export type OverrideDraft = {
  formula: string;
  calcTrigger: string;
  calcIntervalSeconds: string;
  maxInputAgeSeconds: string;
};

export const EMPTY_DRAFT: OverrideDraft = {
  formula: "",
  calcTrigger: "",
  calcIntervalSeconds: "",
  maxInputAgeSeconds: "",
};

/** Seeds the form from what is already overridden, so an edit is not a retype. */
export function draftFromConfig(config: AssetPointCalcConfigDto): OverrideDraft {
  return {
    formula: config.override.formula ?? "",
    calcTrigger: config.override.calcTrigger ?? "",
    calcIntervalSeconds:
      config.override.calcIntervalSeconds === null ? "" : String(config.override.calcIntervalSeconds),
    maxInputAgeSeconds:
      config.override.maxInputAgeSeconds === null ? "" : String(config.override.maxInputAgeSeconds),
  };
}

/**
 * The request body.
 *
 * `formulaDialect` is not an input. There is exactly one dialect the engine
 * runs, and asking an author to restate it on every formula edit is the
 * restatement decision 6 exists to avoid — so it is sent only when a formula is,
 * and is otherwise left inheriting.
 */
export function draftToBody(draft: OverrideDraft): AssetPointCalcOverrideFields {
  const formula = draft.formula.trim();
  const interval = draft.calcIntervalSeconds.trim();
  const maxAge = draft.maxInputAgeSeconds.trim();
  return {
    formula: formula === "" ? null : formula,
    formulaDialect: formula === "" ? null : CALC_DIALECT,
    calcTrigger:
      draft.calcTrigger === "" ? null : (draft.calcTrigger as AssetPointCalcOverrideFields["calcTrigger"]),
    calcIntervalSeconds: interval === "" ? null : Number(interval),
    maxInputAgeSeconds: maxAge === "" ? null : Number(maxAge),
  };
}

/**
 * What the panel refuses to submit, and why — the same rules the API applies to
 * the *merged* result.
 *
 * Deliberately duplicated from `apps/api`'s `validateMergedCalcOverride`, which
 * `apps/web` cannot import. The duplication is bounded to the sentences below;
 * the API stays the authority and the panel does not decide anything the server
 * would not. What it buys is that the structural mistake decision 6 makes easy
 * — change the trigger, leave the interval inheriting — is caught while the
 * author is still looking at both fields.
 */
export function draftProblems(
  draft: OverrideDraft,
  config: AssetPointCalcConfigDto,
): string[] {
  const body = draftToBody(draft);
  const problems: string[] = [];

  const merged = {
    calcTrigger: body.calcTrigger ?? config.template.calcTrigger,
    calcIntervalSeconds: body.calcIntervalSeconds ?? config.template.calcIntervalSeconds,
  };
  const inherited = (field: "calcTrigger" | "calcIntervalSeconds"): string =>
    body[field] === null ? " (inherited from the template)" : "";

  if (CALC_FIELDS.every((field) => body[field] === null)) {
    problems.push(
      'This override sets no column: every field is empty, and empty means "inherit". ' +
        "Use Clear to remove an existing override.",
    );
  }

  if (body.calcIntervalSeconds !== null) {
    if (!Number.isInteger(body.calcIntervalSeconds)) {
      problems.push("The interval must be a whole number of seconds.");
    } else if (
      body.calcIntervalSeconds < MIN_CALC_INTERVAL_SECONDS ||
      body.calcIntervalSeconds > MAX_CALC_INTERVAL_SECONDS
    ) {
      problems.push(
        `The interval must be between ${MIN_CALC_INTERVAL_SECONDS} and ` +
          `${MAX_CALC_INTERVAL_SECONDS} seconds.`,
      );
    }
  }
  if (body.maxInputAgeSeconds !== null) {
    if (!Number.isInteger(body.maxInputAgeSeconds)) {
      problems.push("The input validity window must be a whole number of seconds.");
    } else if (body.maxInputAgeSeconds < 1 || body.maxInputAgeSeconds > MAX_INPUT_AGE_SECONDS_BOUND) {
      problems.push(
        `The input validity window must be between 1 and ${MAX_INPUT_AGE_SECONDS_BOUND} seconds.`,
      );
    }
  }

  // D-1, in the same terms the API uses.
  if (merged.calcTrigger === "scheduled" && merged.calcIntervalSeconds === null) {
    problems.push(
      `Runs is "scheduled"${inherited("calcTrigger")} but no interval is ` +
        `set${inherited("calcIntervalSeconds")}. A scheduled formula needs an interval; set ` +
        "both together.",
    );
  }
  if (merged.calcTrigger === "streaming" && merged.calcIntervalSeconds !== null) {
    problems.push(
      `Runs is "streaming"${inherited("calcTrigger")} but the interval is ` +
        `${merged.calcIntervalSeconds}s${inherited("calcIntervalSeconds")}. A streaming formula ` +
        "runs on its inputs and must carry no interval." +
        (body.calcIntervalSeconds === null && config.template.calcIntervalSeconds !== null
          ? " An override cannot clear an inherited value — empty means inherit — so a " +
            "scheduled template point cannot be overridden to streaming. Change the template " +
            "version instead."
          : ""),
    );
  }

  return problems;
}

/** Whether Save may be pressed. */
export function canSubmit(draft: OverrideDraft, config: AssetPointCalcConfigDto): boolean {
  return draftProblems(draft, config).length === 0;
}
