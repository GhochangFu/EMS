import type { CalcFunctionName } from "./ast";

export const CALC_DIALECT = "bms-calc-v1";
/**
 * `bms-calc-v2` (ADR 0055): the cross-asset dialect. A strict superset of
 * `v1` — every `v1` formula means the same thing under `v2` (decision 4), and
 * `v1` itself keeps its meaning forever (decision 3). `CALC_DIALECT` is left
 * as the bare `v1` literal on purpose: every existing import of it is a `v1`
 * import and keeps compiling unchanged.
 */
export const CALC_DIALECT_V2 = "bms-calc-v2";
export const CALC_DIALECTS = [CALC_DIALECT, CALC_DIALECT_V2] as const;
export type CalcDialect = (typeof CALC_DIALECTS)[number];
/** The `v1` literal alone, for a surface that must not widen with the union. */
export type CalcV1Dialect = typeof CALC_DIALECT;

/** Aggregate functions a `v2` formula may apply over a scope (ADR 0055
 * decision 1; the set is the plan's design decision 5 — `min`/`max` stay
 * scalar, `count` is excluded). */
export const CALC_AGGREGATE_FNS = ["sum", "avg"] as const;
/** The three scope kinds after `@` (ADR 0055 decision 1). */
export const CALC_SCOPE_KINDS = ["site", "domain", "group"] as const;

/** Same cap as `TemplateKpi.expression` (ADR 0036 decision 8). */
export const MAX_FORMULA_LENGTH = 1000;
/** Distinct point references, not occurrences — `MAX_KPI_POINT_REFS` reuses
 * this constant (ADR 0036 decision 8). */
export const MAX_FORMULA_POINT_REFS = 20;
/** Distinct cross-asset references (qualified refs and aggregates) per `v2`
 * formula, beside the unchanged local cap above (ADR 0055; plan design
 * decision 6). An aggregate's *member set* is deliberately not capped here. */
export const MAX_FORMULA_CROSS_REFS = 8;
/** Parser recursion-depth guard — defense in depth against a pathological
 * paste, not a limit any legitimate formula should approach. */
export const MAX_FORMULA_DEPTH = 64;

/**
 * Arity per function, ruled by the repository owner 2026-08-20 as the
 * narrowest defensible table: widening later is backward compatible for
 * stored formulas, narrowing is not, so every row starts at its tightest
 * legitimate bound. `round` ships single-argument only — no `digits` operand
 * yet; that is an `F2.4` widening, not a `F2.3` one. `min`/`max`'s upper
 * bound is capped at `MAX_FORMULA_POINT_REFS` — the two are unrelated
 * quantities that happen to share a cap by convention, not by grammar rule.
 */
export const CALC_FUNCTION_ARITY: Readonly<Record<CalcFunctionName, { min: number; max: number }>> = {
  abs: { min: 1, max: 1 },
  round: { min: 1, max: 1 },
  min: { min: 2, max: MAX_FORMULA_POINT_REFS },
  max: { min: 2, max: MAX_FORMULA_POINT_REFS },
  clamp: { min: 3, max: 3 },
};

/** `template_points.calc_trigger` (ADR 0037 decision 4). */
export const CALC_TRIGGERS = ["streaming", "scheduled"] as const;
export type CalcTrigger = (typeof CALC_TRIGGERS)[number];

export const MIN_CALC_INTERVAL_SECONDS = 10;
export const MAX_CALC_INTERVAL_SECONDS = 86_400;
export const MAX_INPUT_AGE_SECONDS_BOUND = 86_400;

/**
 * Default for `template_points.max_input_age_seconds` when a formula does
 * not set one (ADR 0037 decision 5). Deliberately loose, and deliberately
 * *not* reusing an existing "freshness" constant, because neither answers
 * this question: `FRESH_MS` (25 s, `apps/web/src/lib/schematic-telemetry.ts`)
 * governs socket freshness for a UI already streaming, and
 * `NOTIFY_LIVE_WINDOW_MS` (5 min, `telemetry-write.service.ts`) absorbs the
 * human latency of typing a reading in. This is neither — too tight and a
 * formula silently produces nothing, which reads as "the feature is broken"
 * and is the harder failure to diagnose; too loose only means the author has
 * not yet tightened a value they can see, and every skip is counted, so a
 * loose default is visible rather than silent.
 */
export const DEFAULT_MAX_INPUT_AGE_SECONDS = 300;
