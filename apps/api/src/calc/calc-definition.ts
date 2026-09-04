import type { CalcCrossRef, CalcDialect, CalcExpr, CalcTrigger } from "@bms/shared";
import {
  CALC_DIALECT,
  CALC_DIALECTS,
  DEFAULT_MAX_INPUT_AGE_SECONDS,
  MAX_CALC_INTERVAL_SECONDS,
  MAX_INPUT_AGE_SECONDS_BOUND,
  MIN_CALC_INTERVAL_SECONDS,
  parseFormula,
} from "@bms/shared";

/**
 * Every reason a stored `template_points` row is not an active calc
 * definition (ADR 0037 decision 9 — every skip is counted, none silent).
 *
 * `not_derived` through `max_input_age_out_of_range` cover a row that never
 * passed `templatePointBodySchema` — a pre-`F2.3` row with `formula: null`,
 * or one copied forward unvalidated by `createDraftFrom` (ADR 0036's
 * Consequences record that path). `toActiveDefinition` treats every one of
 * these as a skip, never a throw and never a default: a stored row this
 * function cannot use is simply not computed, exactly as if it did not
 * exist, until an author fixes it through the normal write path.
 *
 * `streaming_on_v2` (`F2.9`, ADR 0055 decision 10) is the same shape for the
 * `bms-calc-v2` dialect: `v2` is `scheduled`-only, the Zod rule refuses the
 * pair at save, and this is the second refusal on the stored row — for
 * exactly the `createDraftFrom` path above.
 *
 * `self_reference` (`F2.9`) is the odd one: it does not describe a row that
 * failed a save-time rule, it describes one whose *stored dialect disagrees
 * with its formula*. See the comment on the check itself.
 */
export type CalcSkipReason =
  | "not_derived"
  | "no_formula"
  | "bad_dialect"
  | "unparseable_formula"
  | "no_trigger"
  | "missing_interval"
  | "interval_on_streaming"
  | "interval_out_of_range"
  | "max_input_age_out_of_range"
  | "streaming_on_v2"
  | "self_reference";

export interface CalcDefinition {
  templatePointId: string;
  assetId: string;
  pointKey: string;
  ast: CalcExpr;
  /** Distinct point keys the formula references, in first-appearance order. */
  refs: string[];
  trigger: CalcTrigger;
  /** Only set when `trigger === "scheduled"`. */
  intervalSeconds: number | null;
  /** Resolved: `DEFAULT_MAX_INPUT_AGE_SECONDS` when the row leaves it unset. */
  maxInputAgeSeconds: number;
  /**
   * The dialect the formula was parsed under (ADR 0055). Carried on the
   * definition rather than re-derived, so a host can branch on it without
   * re-reading the row — which is what `runScheduledSweep` does today.
   */
  dialect: CalcDialect;
  /**
   * Every distinct cross-asset reference the formula names, deduped by
   * `crossRefKey`. Always `[]` under `v1`, which has no such production.
   * Separate from `refs`: a local point key and a cross reference live in
   * different namespaces and must never be resolved against each other.
   */
  crossRefs: CalcCrossRef[];
  /**
   * ADR 0055 decision 11. `null` means **fail closed** — every declared member
   * of an aggregate must be fresh — not "no limit". Never overridden per asset:
   * the column exists on `template_points` alone.
   */
  minCoverageRatio: number | null;
}

/**
 * The subset of a **merged** calc row `toActiveDefinition` needs, joined with
 * the asset it applies to — decoupled from the Drizzle row shape so this stays
 * a pure function the caller (`CalcDefinitionsService`) adapts a query result
 * into.
 *
 * Since ADR 0039 decision 6 the five calc fields are no longer read straight
 * off `template_points`: each arrives as
 * `coalesce(asset_points.<col>, template_points.<col>)`, so this row describes
 * *what the engine will use for this asset*, not what the template declares.
 * The shape and every skip reason below are unchanged by that — the merge
 * happens entirely in the caller's SQL, and a row whose merged values are
 * unusable is the same counted skip a template-only row was. `kind` is the
 * exception and is never merged: an asset cannot make a measured point
 * derived, so `not_derived` still fires on the template's own value.
 */
export interface TemplatePointCalcRow {
  templatePointId: string;
  assetId: string;
  pointKey: string;
  kind: string;
  formula: string | null;
  formulaDialect: string | null;
  calcTrigger: string | null;
  calcIntervalSeconds: number | null;
  maxInputAgeSeconds: number | null;
  /** `template_points.min_coverage_ratio` — the one calc column ADR 0055 does
   * **not** put on `asset_points`, so it arrives unmerged. */
  minCoverageRatio: number | null;
}

export type ActiveDefinitionResult = { ok: true; def: CalcDefinition } | { ok: false; reason: CalcSkipReason };

/**
 * Turns one stored `template_points` row into a usable calc definition, or
 * says why it cannot be used. Pure and total — never throws, so a caller can
 * fold this over every derived row in a template without a try/catch per row.
 */
export function toActiveDefinition(row: TemplatePointCalcRow): ActiveDefinitionResult {
  if (row.kind !== "derived") {
    return { ok: false, reason: "not_derived" };
  }
  if (!row.formula) {
    return { ok: false, reason: "no_formula" };
  }
  // Resolved against the vocabulary rather than compared to one literal, so a
  // third dialect is admitted here the moment it is admitted everywhere
  // (`F4.43`'s "nobody restates a vocabulary"). A stored dialect this engine
  // does not know is `bad_dialect` — never quietly parsed as `v1`, which would
  // give a formula written for another grammar a meaning it was not authored
  // with.
  const dialect: CalcDialect | undefined = CALC_DIALECTS.find((known) => known === row.formulaDialect);
  if (!dialect) {
    return { ok: false, reason: "bad_dialect" };
  }
  const parsed = parseFormula(row.formula, { dialect });
  if (!parsed.ok) {
    return { ok: false, reason: "unparseable_formula" };
  }
  // A formula that reads the point it writes is refused here, **whatever
  // dialect the row claims** — because the failure this backstops is a stored
  // dialect label that does not describe the formula beside it, and a guard
  // that read the label would be the guard that failure walks past.
  //
  // `reload()` coalesces `formula` and `formula_dialect` independently, so the
  // two can come from different places. The **write** path that produced such a
  // pair through a calc override is closed (`582ed49`: the merged pair is now
  // parsed whenever an override states a formula *or* a dialect). A second path
  // is still open — template migration repoints `assets.template_id` without
  // re-validating the surviving override, because `computeTemplateVersionDelta`
  // reports a derived point's formula/dialect change in `derivedChanged` and
  // never in `refusals`, which is all the migrate service consumes.
  // **Re-validating that path is ADR 0039 decision 2's "no blind apply" and is
  // owed to PR 2**; this is not that fix and does not discharge it.
  //
  // What it does discharge is the damage. A self-reference compounds: `{SELF} *
  // 2` doubles its own stored value on every tick until it overflows, silently,
  // and no cycle detector exists in this PR (ADR 0055 decision 8's
  // evaluation-time detector is Task 13's, with the ordering pass and
  // membership resolution). Nothing legitimate is refused: every authoring path
  // already rejects a self-reference at save time, so a row that reaches here
  // with one arrived by a route that did not validate it.
  //
  // Re-checking a stored row at read time is this function's own convention,
  // not a new mechanism — `interval_out_of_range` and
  // `max_input_age_out_of_range` below re-check bounds the Zod layer enforces,
  // for exactly the rows that never passed it.
  //
  // **Local references only.** A cross-asset self-reference (`sum({SELF}
  // @site)` on a member of that site) is not visible here: it needs the
  // membership set, which only Task 13's detector resolves.
  if (parsed.refs.includes(row.pointKey)) {
    return { ok: false, reason: "self_reference" };
  }
  if (row.calcTrigger !== "streaming" && row.calcTrigger !== "scheduled") {
    return { ok: false, reason: "no_trigger" };
  }
  // ADR 0055 decision 10: `v2` is `scheduled`-only. Reported ahead of the
  // interval checks because the dialect/trigger pair is the actionable defect —
  // a `v2` streaming row is wrong whether or not it also carries an interval.
  if (dialect !== CALC_DIALECT && row.calcTrigger === "streaming") {
    return { ok: false, reason: "streaming_on_v2" };
  }
  if (row.calcTrigger === "streaming" && row.calcIntervalSeconds != null) {
    return { ok: false, reason: "interval_on_streaming" };
  }
  if (row.calcTrigger === "scheduled") {
    if (row.calcIntervalSeconds == null) {
      return { ok: false, reason: "missing_interval" };
    }
    if (row.calcIntervalSeconds < MIN_CALC_INTERVAL_SECONDS || row.calcIntervalSeconds > MAX_CALC_INTERVAL_SECONDS) {
      return { ok: false, reason: "interval_out_of_range" };
    }
  }
  if (
    row.maxInputAgeSeconds != null &&
    (row.maxInputAgeSeconds < 1 || row.maxInputAgeSeconds > MAX_INPUT_AGE_SECONDS_BOUND)
  ) {
    return { ok: false, reason: "max_input_age_out_of_range" };
  }

  return {
    ok: true,
    def: {
      templatePointId: row.templatePointId,
      assetId: row.assetId,
      pointKey: row.pointKey,
      ast: parsed.ast,
      refs: parsed.refs,
      trigger: row.calcTrigger,
      intervalSeconds: row.calcTrigger === "scheduled" ? row.calcIntervalSeconds : null,
      maxInputAgeSeconds: row.maxInputAgeSeconds ?? DEFAULT_MAX_INPUT_AGE_SECONDS,
      dialect,
      crossRefs: parsed.crossRefs,
      minCoverageRatio: row.minCoverageRatio,
    },
  };
}
