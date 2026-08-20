import type { CalcExpr, CalcTrigger } from "@bms/shared";
import {
  CALC_DIALECT,
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
  | "max_input_age_out_of_range";

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
}

/** The subset of a `template_points` row `toActiveDefinition` needs, joined
 * with the asset it applies to — decoupled from the Drizzle row shape so this
 * stays a pure function the caller (`CalcDefinitionsService`, task 7) adapts
 * a query result into. */
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
  if (row.formulaDialect !== CALC_DIALECT) {
    return { ok: false, reason: "bad_dialect" };
  }
  const parsed = parseFormula(row.formula);
  if (!parsed.ok) {
    return { ok: false, reason: "unparseable_formula" };
  }
  if (row.calcTrigger !== "streaming" && row.calcTrigger !== "scheduled") {
    return { ok: false, reason: "no_trigger" };
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
    },
  };
}
