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
 * `coverage_ratio_out_of_range` (`F2.9`, ADR 0055 decision 11) is the same
 * shape for `min_coverage_ratio`: the Zod layer holds `(0, 1]`, a database
 * `CHECK` is foreclosed by decision 11 and the `0035`/`0036` precedent, so this
 * re-checks the bound beside its two siblings for the rows that never passed
 * the Zod layer (plan finding 32). A `0` would make every aggregate pass on
 * zero fresh members; a ratio above `1` could never pass at all.
 *
 * `streaming_on_v2` (`F2.9`, ADR 0055 decision 10) is the same shape for the
 * `bms-calc-v2` dialect: `v2` is `scheduled`-only, the Zod rule refuses the
 * pair at save, and this is the second refusal on the stored row — for
 * exactly the `createDraftFrom` path above.
 *
 * `self_reference` (`F2.9`) is the odd one: it does not describe a row that
 * failed a save-time rule, it describes one whose *stored dialect disagrees
 * with its formula*. See the comment on the check itself.
 *
 * `v1_references_derived` (`F2.9`) is that same shape widened from one hop to
 * every hop, and **no `toActiveDefinition` path returns it**: the check needs
 * the *sibling* rows, which only `CalcDefinitionsService.reload()` has, so it
 * is raised there as a post-pass. See {@link referencesADerivedSiblingUnderV1}.
 * Like every other reason here it counts on a cache refresh only: the
 * save-time detector's read (`getAllDefinitionsFresh()`) re-resolves every
 * definition **without** counting, since `F2.9` Task 12 (plan finding 30).
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
  | "self_reference"
  | "v1_references_derived"
  | "coverage_ratio_out_of_range";

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
  // parsed whenever an override states a formula *or* a dialect). The second
  // path — template migration repointing `assets.template_id` without
  // re-validating the surviving override — **is closed too, since `F2.9` Task
  // 12b**: `AssetTemplateMigrationService` merges each override over the target
  // version's point and re-runs `validateMergedCalcOverride`, refusing as
  // `calc_override_invalid_on_target`. That was ADR 0039 decision 2's "no blind
  // apply".
  //
  // **This check still earns its lines.** It does not rest on either of those
  // write paths being closed — that is the whole point of a read-time backstop,
  // and the two findings that produced it (33 and 34) were both cases where a
  // guard trusted a write path it should not have. A row can still reach here
  // from a fixture, a support SQL edit, or a path not yet written.
  //
  // What it does discharge is the damage. A self-reference compounds: `{SELF} *
  // 2` doubles its own stored value on every tick until it overflows, silently.
  // The sweep's cycle detector (`runScheduledSweep`, since `F2.9` Task 13)
  // would refuse the same row as a one-edge `dependency_cycle` — but that is
  // one host's evaluation-time check, and this is the loader's, which every
  // host shares; a definition refused here never reaches either. Nothing
  // legitimate is refused: every authoring path already rejects a
  // self-reference at save time, so a row that reaches here with one arrived
  // by a route that did not validate it.
  //
  // Re-checking a stored row at read time is this function's own convention,
  // not a new mechanism — `interval_out_of_range` and
  // `max_input_age_out_of_range` below re-check bounds the Zod layer enforces,
  // for exactly the rows that never passed it.
  //
  // **Local references only.** A cross-asset self-reference (`sum({SELF}
  // @site)` on a member of that site) is not visible here: it needs the
  // membership set, which only the two detectors resolve — the save-time
  // `CalcDependencyService` and the sweep's own ordering pass.
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
  // `(0, 1]` — written as the negation of "inside", so a `NaN` (which a
  // `numeric` column admits) fails rather than passing both comparisons
  // vacuously. `1` is inside: it means "every member" (ADR 0055 decision 11).
  if (row.minCoverageRatio != null && !(row.minCoverageRatio > 0 && row.minCoverageRatio <= 1)) {
    return { ok: false, reason: "coverage_ratio_out_of_range" };
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

/**
 * Whether `def` is a **`bms-calc-v1`** definition that reads a point which is
 * `derived` on its own asset — the `v1_references_derived` skip, raised as a
 * post-pass by `CalcDefinitionsService.reload()` because the answer needs the
 * asset's *sibling* rows and `toActiveDefinition` sees one row at a time.
 *
 * **This is not a new rule and not a cycle detector.** ADR 0036 decision 7
 * already forbids a `v1` formula from referencing another derived point, and
 * ADR 0055 decision 3 freezes `v1`'s refusals forever; decision 7 of ADR 0055
 * repeals the ban for `v2` only, which is why this reads the dialect. The
 * write-side half is `asset-templates.schema.ts`'s decision-7 refusal
 * (`kindByKey.get(ref) === "derived"`), and this is the same predicate read off
 * stored rows. Task 12's real dependency graph and topological order are PR 2's;
 * this is a flat per-asset set membership test and must stay one.
 *
 * **Why a read-time copy of a write-time rule is worth its lines.** The class it
 * backstops is a stored `formula_dialect` that does not describe the formula
 * beside it, and every guard that trusts the label is a guard that class walks
 * past. `reload()` coalesces `formula` and `formula_dialect` independently, so
 * the two can arrive from different rows:
 *
 *  - the **override** path that produced such a pair is closed (`582ed49` —
 *    the merged pair is parsed whenever an override states a formula *or* a
 *    dialect);
 *  - the **one-hop** case, a formula reading the point it writes, is refused
 *    above whatever the label says (`f2f0023`);
 *  - the **migrate** path is closed since `F2.9` Task 12b. Repointing
 *    `assets.template_id` now re-validates each surviving override against the
 *    target version through `validateMergedCalcOverride` — the same function
 *    the override endpoint calls, so migrate cannot admit a pair that endpoint
 *    would refuse — and refuses as `calc_override_invalid_on_target`. That was
 *    ADR 0039 decision 2's "no blind apply".
 *
 * None of that retires this check. A read-time refusal exists precisely so it
 * does not depend on a write path holding, and findings 33 and 34 were both
 * guards that trusted one.
 *
 * Two hops is the case the one-hop backstop misses: two `v1`-labelled points on
 * one asset referencing each other compound every tick, and nothing in PR 1
 * detects a cycle. Refusing the *reference* rather than the *cycle* closes one
 * hop, two hops and n hops together, whatever path produced the row.
 *
 * **It can never fire on legitimate `v1` content**, precisely because the
 * write-side guard refuses such a formula at save. If it fires, something
 * upstream stored a dialect that lies — which is exactly what makes it worth
 * counting rather than merging into a neighbouring reason.
 */
export function referencesADerivedSiblingUnderV1(
  def: CalcDefinition,
  derivedPointKeysByAsset: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (def.dialect !== CALC_DIALECT) {
    return false;
  }
  const derivedOnThisAsset = derivedPointKeysByAsset.get(def.assetId);
  if (!derivedOnThisAsset) {
    return false;
  }
  // Per asset, never global: `point_keys.code` is an org-scoped catalog code,
  // and the same code is measured on one template and derived on another. A
  // global set would refuse a legal formula on the second asset — and would
  // break cross-asset work before PR 2 begins it.
  return def.refs.some((ref) => derivedOnThisAsset.has(ref));
}
