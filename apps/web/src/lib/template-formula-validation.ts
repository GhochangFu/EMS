/**
 * Client-side formula validation for the two authored-formula surfaces
 * (`F2.5`, ADR 0038 decision 4 — Unit 4).
 *
 * The two surfaces are a **derived point's `formula`** (Calculations tab) and a
 * **KPI's `expression`** (KPIs tab). They share the `bms-calc-v1` parser and
 * share nothing else: a derived formula may only reference *measured* siblings,
 * while a KPI carries its own `pointKeys` array that must agree with the
 * expression in both directions. One function each, one private checker under
 * the KPI pair.
 *
 * **This does not replace the server's validation and must not drift from it.**
 * Every rule below mirrors one the API already enforces
 * (`asset-templates.schema.ts`, `asset-templates-content.schema.ts`); the point
 * is that the author sees it while typing instead of learning it from a 400.
 *
 * **This is not a port of `findUnresolvedContentRefs`.** That function
 * (`asset-templates-content.schema.ts:412`) walks the whole content tree —
 * alarms, dashboards, KPIs — server-side. What the client needs is the
 * KPI-scoped subset over the `points[]` array it has already fetched: set
 * membership and three assertions. Widening this into a content walker would
 * duplicate an API-owned traversal.
 *
 * **Why `lib/` and not the component.** The root `vitest.config.ts` coverage
 * `include` reaches `apps/web/src/lib/**` and nothing above it, and
 * `apps/web/vitest.config.ts` runs `environment: "node"` over
 * `src/**\/*.test.ts`. Logic in a `.tsx` is both untestable here and invisible
 * to the coverage gate. See `apps/web/src/lib/vocabulary.ts`.
 */
import {
  CALC_DIALECT,
  CALC_DIALECTS,
  formatCalcError,
  validateFormula,
  type CalcDialect,
  type CalcParseError,
  type TemplateKpi,
  type TemplatePointKind,
  type Token,
} from "@bms/shared";

import { clampOffset, safeTokenize, tokenRange } from "./calc-token-ranges";

/**
 * One author-facing problem, positioned in the source text.
 *
 * `from`/`to` are character offsets into the formula, ready for CodeMirror's
 * `Diagnostic`. The type carries no severity and no attribution field: every
 * diagnostic here is an error, and the two rules that have no position of their
 * own say so in the message (see `UNUSED_POINT_KEYS_MESSAGE`).
 */
export type FormulaDiagnostic = { message: string; from: number; to: number };

/**
 * The result shape every formula surface consumes (Units 5, 9c, 9d).
 *
 * `"unvalidated"` is a third state rather than an `ok` with an empty `refs`
 * array, because the two mean opposite things to a caller: `ok` licenses
 * highlighting and the live preview, `unvalidated` must suppress both while
 * staying silent. ADR 0038 decision 9 — opening a template to fix an alarm
 * message must never reject a KPI the author did not touch.
 */
export type FormulaValidation =
  | { state: "ok"; refs: string[] }
  | { state: "error"; diagnostics: FormulaDiagnostic[] }
  | { state: "unvalidated" };

/** One declared template point, reduced to what validation reads. */
export type FormulaPoint = { pointKey: string; kind: TemplatePointKind };

/**
 * A KPI reduced to the three fields validation reads.
 *
 * Spelled out rather than `Pick<TemplateKpi, …>` so that `pointKeys` can be
 * `readonly`. `TemplateKpi.pointKeys` is a mutable `string[]` because it is a
 * stored shape; nothing here writes to it, and a `Pick` would reject a frozen
 * or `as const` array for no reason a caller could act on.
 */
export type KpiFormulaInput = {
  expression: string;
  pointKeys: readonly string[];
  dialect: TemplateKpi["dialect"];
};

/**
 * The two derived-reference messages, copied from
 * `apps/api/src/admin/asset-templates/asset-templates.schema.ts:159–171`.
 *
 * `apps/web` may not import from `apps/api`, so these are string literals on
 * both sides of the boundary — stated here rather than left for a reader to
 * discover, because a message that drifts from the server's is worse than no
 * client check: the author fixes what the editor complained about and the save
 * still fails, with different wording.
 */
const DERIVED_SELF_REFERENCE_MESSAGE =
  "This point's formula references itself — a derived formula may only reference measured points";
const DERIVED_SIBLING_REFERENCE_MESSAGE =
  "This point's formula references another derived point — a derived formula may only reference measured points";

/** Copied from `templateKpiSchema.superRefine` (`asset-templates-content.schema.ts:230`). */
const UNUSED_POINT_KEYS_MESSAGE =
  "Every entry in pointKeys must be referenced by expression at least once";

/**
 * The client half of `findUnresolvedContentRefs`, KPI-scoped.
 *
 * A KPI reference must appear in `pointKeys` **and** be a point the template
 * declares. `validateFormula` checks the first; only the caller knows the
 * second, because `pointKeys` is content and `points[]` is a sibling column.
 */
const UNDECLARED_KPI_REFERENCE_MESSAGE =
  "This KPI references a point that the template does not declare";

/**
 * Maps a parser position onto a source range.
 *
 * Two fallbacks, both to "from here to the end of the text": the formula did
 * not tokenize at all, or no token starts at the reported position. Both are
 * reachable — a tokenize failure has no tokens to search, and a parse error can
 * be reported past the last token — and both are better than a zero-width mark
 * the author cannot see.
 */
function rangeAt(
  formula: string,
  position: number,
  dialect: CalcDialect = CALC_DIALECT,
): { from: number; to: number } {
  const token = safeTokenize(formula, dialect).find(
    (candidate) => candidate.position === position,
  );
  if (!token) {
    return { from: clampOffset(position, formula), to: formula.length };
  }
  return tokenRange(formula, token);
}

/** Renders a parser error as a positioned diagnostic. */
function toDiagnostic(
  formula: string,
  error: CalcParseError,
  dialect: CalcDialect = CALC_DIALECT,
): FormulaDiagnostic {
  return { message: formatCalcError(error), ...rangeAt(formula, error.position, dialect) };
}

/** Every `ref` token in source order. */
function refTokens(formula: string, dialect: CalcDialect = CALC_DIALECT): Token[] {
  return safeTokenize(formula, dialect).filter((token) => token.kind === "ref");
}

/**
 * Builds a diagnostic over a whole expression.
 *
 * Used for the one rule that has no position: an unused `pointKeys` entry is a
 * fact about the array, not about any character of the expression.
 */
function wholeText(formula: string, message: string): FormulaDiagnostic {
  return { message, from: 0, to: formula.length };
}

/**
 * Validates a derived point's formula against its siblings.
 *
 * Mirrors `templatePointsBodySchema.superRefine`: the formula must parse, every
 * `{ref}` must resolve to a point this template declares, and none of those
 * references may resolve to a derived point — including this one.
 *
 * The offending reference is located by scanning tokens in **source order**,
 * where the server scans `result.refs`. The rule is identical; the order only
 * decides which reference is reported first when a formula breaks it twice, and
 * source order is the one the author is looking at.
 *
 * ## The derived-reference refusal runs under `bms-calc-v1` only
 *
 * ADR 0055 decision 7 repeals ADR 0036 decision 7 for `bms-calc-v2`: a
 * cross-asset formula reads other assets' points, and a site total is a derived
 * point by construction, so keeping the ban would refuse the dialect's own
 * purpose. Decision 3 freezes the `v1` half **forever** — that arm is not a
 * default to be revisited, it is the meaning `v1` is guaranteed to keep.
 *
 * What replaces the ban under `v2` is a **cycle** check on the real dependency
 * graph, which needs membership resolution and therefore lives on the server
 * (`F2.9` Task 12). This function cannot do it and does not pretend to; the
 * editor mirror of those diagnostics is `F2.22`'s.
 *
 * `dialect` defaults to `v1`, so every caller that predates `F2.9` is unchanged
 * without restating it.
 */
export function validateDerivedFormula(
  formula: string,
  points: readonly FormulaPoint[],
  selfPointKey: string,
  dialect: CalcDialect = CALC_DIALECT,
): FormulaValidation {
  const result = validateFormula(
    formula,
    points.map((point) => point.pointKey),
    { dialect },
  );
  if (!result.ok) {
    return { state: "error", diagnostics: [toDiagnostic(formula, result.errors[0], dialect)] };
  }

  if (dialect !== CALC_DIALECT) {
    return { state: "ok", refs: result.refs };
  }

  const kindByKey = new Map(points.map((point) => [point.pointKey, point.kind]));
  for (const token of refTokens(formula, dialect)) {
    if (kindByKey.get(token.text) !== "derived") {
      continue;
    }
    return {
      state: "error",
      diagnostics: [
        {
          message:
            token.text === selfPointKey
              ? DERIVED_SELF_REFERENCE_MESSAGE
              : DERIVED_SIBLING_REFERENCE_MESSAGE,
          ...rangeAt(formula, token.position, dialect),
        },
      ],
    };
  }

  return { state: "ok", refs: result.refs };
}

/**
 * The KPI rules themselves, with **no dialect gate**.
 *
 * Private on purpose. `validateKpiExpression` gates on the dialect and returns
 * `"unvalidated"`; the upgrade path acts on a KPI whose dialect is exactly
 * `"unvalidated"`, so delegating to the public function would make the upgrade
 * unable to ever succeed. Both call this instead.
 *
 * **Both directions are narrowed to LOCAL references under `bms-calc-v2`** —
 * the owner's `F2.9` Q3b ruling, mirroring `templateKpiSchema.superRefine`
 * (`asset-templates-content.schema.ts:349-368`). A key that appears solely
 * inside an aggregate (`sum({kw} @site)`) or a qualified reference
 * (`{CODE.key}`) is exempt from both: it need not appear in `pointKeys`, it
 * does not count as "used", and the template need not declare it, because the
 * asset it resolves against is not known until evaluation time.
 *
 * That exemption is almost free. `validateFormula` already checks local
 * references only, and `result.refs` is local by construction — so the one
 * addition is the `used.has` guard on the declared-key scan, which walks raw
 * `ref` tokens and would otherwise reach inside an aggregate. **Under `v1` that
 * guard is a provable no-op**: every `ref` token in a formula that passed
 * `validateFormula` is a local reference, so `used` holds all of them.
 */
function checkKpiExpression(
  expression: string,
  pointKeys: readonly string[],
  declaredPointKeys: readonly string[],
  dialect: CalcDialect,
): FormulaValidation {
  const result = validateFormula(expression, pointKeys, { dialect });
  if (!result.ok) {
    return { state: "error", diagnostics: [toDiagnostic(expression, result.errors[0], dialect)] };
  }

  const used = new Set(result.refs);
  if (pointKeys.some((key) => !used.has(key))) {
    return { state: "error", diagnostics: [wholeText(expression, UNUSED_POINT_KEYS_MESSAGE)] };
  }

  const declared = new Set(declaredPointKeys);
  for (const token of refTokens(expression, dialect)) {
    if (!used.has(token.text) || declared.has(token.text)) {
      continue;
    }
    return {
      state: "error",
      diagnostics: [
        {
          message: UNDECLARED_KPI_REFERENCE_MESSAGE,
          ...rangeAt(expression, token.position, dialect),
        },
      ],
    };
  }

  return { state: "ok", refs: result.refs };
}

/**
 * The dialect a stored KPI is checked under, or `null` for `"unvalidated"`.
 *
 * Resolved through `CALC_DIALECTS` rather than compared to the two literals:
 * `TemplateKpi["dialect"]` widened with the Q3 ruling and a third member would
 * otherwise be read as `"unvalidated"` by a check nobody remembered to extend.
 */
function checkedDialect(dialect: TemplateKpi["dialect"]): CalcDialect | null {
  return CALC_DIALECTS.find((known) => known === dialect) ?? null;
}

/**
 * Validates a KPI as stored.
 *
 * A KPI at `dialect: "unvalidated"` is **never an error** — ADR 0038 decision 9.
 * `F2.3` shipped this column before the parser existed and templates on `main`
 * hold expressions that never met it.
 *
 * **`"unvalidated"` is now the only silent state** (`F2.9`). It used to be
 * "anything that is not `v1`", which made a stored `bms-calc-v2` KPI free text
 * in the editor while `isCheckedDialect` — already widened by the Q3 ruling —
 * told the same field it was checked. The two disagreed, and the field showed
 * neither highlighting nor a diagnostic for an expression the server would
 * happily parse.
 */
export function validateKpiExpression(
  kpi: KpiFormulaInput,
  declaredPointKeys: readonly string[],
): FormulaValidation {
  const dialect = checkedDialect(kpi.dialect);
  if (dialect === null) {
    return { state: "unvalidated" };
  }
  return checkKpiExpression(kpi.expression, kpi.pointKeys, declaredPointKeys, dialect);
}

/**
 * The **Validate this expression** action (ADR 0038 decision 9).
 *
 * Returns one `FormulaValidation` — the same vocabulary every other caller
 * reads — beside the KPI to store. On failure the KPI is **the input reference
 * itself**, so a caller that writes `result.kpi` unconditionally still writes
 * nothing new: not the dialect, not the expression.
 *
 * **The target dialect is the row's own, not a hardcoded `v1`** (`F2.9`). An
 * `"unvalidated"` row is upgraded to `bms-calc-v1`, which is what this function
 * has always done and what its name says. A row that already names a real
 * dialect is validated **under that dialect and left on it** — stamping
 * `CALC_DIALECT` here rewrote a stored `bms-calc-v2` KPI to `v1` every time the
 * author pressed **Validate this expression**, which is the same class of
 * damage as an editor stamping its own dialect over a formula it did not write.
 */
export function upgradeKpiToCalcDialect(
  kpi: TemplateKpi,
  declaredPointKeys: readonly string[],
): { validation: FormulaValidation; kpi: TemplateKpi } {
  const dialect = checkedDialect(kpi.dialect) ?? CALC_DIALECT;
  const validation = checkKpiExpression(
    kpi.expression,
    kpi.pointKeys,
    declaredPointKeys,
    dialect,
  );
  if (validation.state !== "ok") {
    return { validation, kpi };
  }
  return { validation, kpi: { ...kpi, dialect } };
}
