import { CALC_DIALECTS, isParameterDialect, parseFormula, type CalcDialect } from "@bms/shared";

/**
 * `E4.1a` / ADR 0070 decision 4 — the `$key`s a `bms-calc-v3` formula names
 * inside its own text, for the save-time vocabulary check. The sibling of
 * `crossRefPointKeys` in `./asset-templates-cross-refs`, and under the same
 * header discipline: **pure and total**. A point that is not derived, has no
 * formula, carries a dialect without parameters, or does not parse
 * contributes nothing and never throws — the parse error is
 * `templatePointBodySchema`'s to report, and this runs after it.
 *
 * What the check does with the keys is `AssetTemplatesAdminService
 * .assertParameterKeysKnown`: `CalcParametersService.unknownKeys` on the
 * union, a 400 naming each missing `$key`. **A key that exists but has no
 * value in scope is not a save-time error** (ADR 0070 decision 4): the value
 * is per organization and per date and the author of a stock template cannot
 * see either, so that is the runtime `parameter_unset` refusal.
 */

export interface ParamRefCandidatePoint {
  pointKey: string;
  kind?: string | null;
  formula?: string | null;
  formulaDialect?: string | null;
}

/** A KPI expression is a second authored-formula surface (ADR 0036 decision
 * 6); a `v3` one names keys the same way and is checked the same way. */
export interface ParamRefCandidateKpi {
  expression: string;
  dialect?: string | null;
}

function knownDialect(dialect: string | null | undefined): CalcDialect | undefined {
  return CALC_DIALECTS.find((known) => known === dialect);
}

function keysOf(expression: string, dialect: CalcDialect, found: Set<string>): void {
  if (!isParameterDialect(dialect)) {
    return;
  }
  const parsed = parseFormula(expression, { dialect });
  if (!parsed.ok) {
    return;
  }
  for (const key of parsed.paramRefs) {
    found.add(key);
  }
}

/** Every distinct `$key` the `v3` points and KPIs name, in first-appearance order. */
export function paramRefKeys(
  points: readonly ParamRefCandidatePoint[],
  kpis: readonly ParamRefCandidateKpi[] = [],
): string[] {
  const found = new Set<string>();
  for (const point of points) {
    const dialect = knownDialect(point.formulaDialect);
    if (point.kind !== "derived" || !point.formula || dialect === undefined) {
      continue;
    }
    keysOf(point.formula, dialect, found);
  }
  for (const kpi of kpis) {
    const dialect = knownDialect(kpi.dialect);
    if (dialect === undefined) {
      continue;
    }
    keysOf(kpi.expression, dialect, found);
  }
  return [...found];
}

/**
 * The one sentence both write paths (template save and per-asset override)
 * use for a `$key` the vocabulary does not hold — one voice, as the streaming
 * refusal is one voice across its four copies. Bounded the way
 * `boundedMissingPointKeys` bounds a catalog refusal, and for the same
 * reason: these codes come out of formula text.
 */
export function unknownParameterKeysMessage(codes: readonly string[]): string {
  const listed = codes.slice(0, 10).map((code) => `$${code.length > 64 ? `${code.slice(0, 64)}… (truncated)` : code}`);
  const withheld = codes.length - listed.length;
  const named = withheld > 0 ? [...listed, `and ${withheld} more`] : listed;
  return (
    `Not in the calc parameter vocabulary: ${named.join(", ")} — choose a key from ` +
    "GET /admin/calc-parameters/keys or correct the formula"
  );
}
