import type { CalcFunctionName } from "./ast";

export const CALC_DIALECT = "bms-calc-v1";
export type CalcDialect = typeof CALC_DIALECT;

/** Same cap as `TemplateKpi.expression` (ADR 0036 decision 8). */
export const MAX_FORMULA_LENGTH = 1000;
/** Distinct point references, not occurrences — `MAX_KPI_POINT_REFS` reuses
 * this constant (ADR 0036 decision 8). */
export const MAX_FORMULA_POINT_REFS = 20;
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
