/**
 * The two formula surfaces (`F2.5`, ADR 0038 decision 4 — Unit 4).
 *
 * Every offset asserted below was read off a deliberately-red first run and
 * then pasted as a literal. None of them is computed here from the same
 * derivation the module uses — two copies of one arithmetic agreeing proves
 * nothing about either.
 */
import { CALC_DIALECT, CalcTokenizeError, tokenize, validateFormula, type TemplateKpi } from "@bms/shared";

import {
  upgradeKpiToCalcDialect,
  validateDerivedFormula,
  validateKpiExpression,
  type FormulaPoint,
  type FormulaValidation,
} from "./template-formula-validation";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** `A` and `B` measured, `D` and `SELF` derived. */
const POINTS: FormulaPoint[] = [
  { pointKey: "A", kind: "measured" },
  { pointKey: "B", kind: "measured" },
  { pointKey: "D", kind: "derived" },
  { pointKey: "SELF", kind: "derived" },
];

const DECLARED = POINTS.map((point) => point.pointKey);

/** The single diagnostic of an error result, or a failure naming what came back. */
function onlyDiagnostic(result: FormulaValidation, label: string) {
  assert(result.state === "error", `${label}: expected state "error", got "${result.state}"`);
  if (result.state !== "error") {
    throw new Error("unreachable");
  }
  assert(
    result.diagnostics.length === 1,
    `${label}: expected exactly one diagnostic, got ${result.diagnostics.length}`,
  );
  return result.diagnostics[0];
}

/** Case 1 — a formula over two measured siblings. */
export function runValidDerivedFormulaTests(): void {
  const result = validateDerivedFormula("({A} + {B}) / 2", POINTS, "D");
  assert(result.state === "ok", `expected ok, got ${JSON.stringify(result)}`);
  if (result.state !== "ok") {
    return;
  }
  assert(
    result.refs.join(",") === "A,B",
    `refs must be ["A","B"] in source order, got ${JSON.stringify(result.refs)}`,
  );
}

/**
 * Case 2 — a reference to a point the template does not declare.
 *
 * The offsets are the whole assertion. A diagnostic that merely says "somewhere
 * in this formula" is what a `<textarea>` already gives you.
 */
export function runUnknownReferenceTests(): void {
  const diagnostic = onlyDiagnostic(
    validateDerivedFormula("{A} + {ZZZ}", POINTS, "D"),
    "unknown ref",
  );
  assert(diagnostic.from === 6, `from must be 6 (the offset of "{"), got ${diagnostic.from}`);
  assert(diagnostic.to === 11, `to must be 11 (past the closing "}"), got ${diagnostic.to}`);
}

/**
 * Case 3 — a derived formula may only reference measured points.
 *
 * Two *distinct* messages, mirroring `templatePointsBodySchema.superRefine`.
 * The self-reference case is not a special case of the sibling one: an author
 * who wrote `{SELF}` inside `SELF` needs to be told that, not told to go and
 * look at another point.
 */
export function runDerivedReferenceTests(): void {
  const sibling = onlyDiagnostic(validateDerivedFormula("{D} * 2", POINTS, "OTHER"), "derived sibling");
  assert(
    sibling.message.includes("references another derived point"),
    `sibling message must name the other point, got: ${sibling.message}`,
  );
  assert(
    sibling.message.includes("may only reference measured points"),
    `sibling message must state the rule, got: ${sibling.message}`,
  );

  const self = onlyDiagnostic(validateDerivedFormula("{SELF} + 1", POINTS, "SELF"), "self reference");
  assert(
    self.message.includes("references itself"),
    `self message must say "references itself", got: ${self.message}`,
  );
  assert(
    self.message !== sibling.message,
    "the self-reference and sibling-reference messages must differ",
  );
}

/**
 * Case 4 — a `pointKeys` entry the expression never uses.
 *
 * This is the half a naive editor misses. `validateFormula` alone is happy:
 * `{A}` parses and `A` is declared. The rule is about the array, so the
 * diagnostic spans the whole expression and says `pointKeys` in its text —
 * `FormulaDiagnostic` carries no attribution field.
 */
export function runUnusedPointKeysTests(): void {
  const kpi = { expression: "{A}", pointKeys: ["A", "B"], dialect: CALC_DIALECT } as const;
  const diagnostic = onlyDiagnostic(validateKpiExpression(kpi, DECLARED), "unused pointKeys");
  assert(
    diagnostic.message === "Every entry in pointKeys must be referenced by expression at least once",
    `message must match templateKpiSchema's, got: ${diagnostic.message}`,
  );
  assert(diagnostic.from === 0, `from must be 0, got ${diagnostic.from}`);
  assert(diagnostic.to === 3, `to must span the expression (3), got ${diagnostic.to}`);
}

/** Case 5 — the other direction: a reference missing from `pointKeys`. */
export function runReferenceNotInPointKeysTests(): void {
  const kpi = { expression: "{A}+{B}", pointKeys: ["A"], dialect: CALC_DIALECT } as const;
  const diagnostic = onlyDiagnostic(validateKpiExpression(kpi, DECLARED), "ref outside pointKeys");
  assert(
    diagnostic.message.includes("unknown point"),
    `must report an unknown reference, got: ${diagnostic.message}`,
  );
  assert(diagnostic.from === 4, `from must be 4 (the offset of "{B}"), got ${diagnostic.from}`);
  assert(diagnostic.to === 7, `to must be 7, got ${diagnostic.to}`);
}

/**
 * Case 6 — declared in `pointKeys`, absent from the template's `points[]`.
 *
 * The `findUnresolvedContentRefs` half. `pointKeys` is content and `points[]`
 * is a sibling column, so a KPI can agree with itself perfectly and still
 * reference a point that does not exist.
 */
export function runReferenceNotDeclaredByTemplateTests(): void {
  const kpi = { expression: "{A}", pointKeys: ["A"], dialect: CALC_DIALECT } as const;
  const ok = validateKpiExpression(kpi, DECLARED);
  assert(ok.state === "ok", `with A declared this must pass, got ${JSON.stringify(ok)}`);

  const diagnostic = onlyDiagnostic(validateKpiExpression(kpi, ["B"]), "undeclared ref");
  assert(
    diagnostic.message.includes("does not declare"),
    `must say the template does not declare it, got: ${diagnostic.message}`,
  );
  assert(diagnostic.from === 0, `from must be 0, got ${diagnostic.from}`);
  assert(diagnostic.to === 3, `to must be 3, got ${diagnostic.to}`);
}

/**
 * Case 7 — an unbalanced brace, and *which* path it takes.
 *
 * `tokenize` throws and `validateFormula` does not, which is the whole reason
 * this module wraps the tokenizer. Asserting only "it errors" would pass even
 * if the wrapper propagated the throw — and a throw on a keystroke path takes
 * the editor down, not the formula.
 */
export function runUnbalancedBraceTests(): void {
  let thrown: unknown = null;
  try {
    tokenize("{A");
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof CalcTokenizeError, "tokenize('{A') must throw CalcTokenizeError");
  if (thrown instanceof CalcTokenizeError) {
    assert(
      thrown.parseError.code === "unterminated_reference",
      `code must be unterminated_reference, got ${thrown.parseError.code}`,
    );
    assert(
      thrown.parseError.position === 0,
      `position must be 0, got ${thrown.parseError.position}`,
    );
  }

  const parsed = validateFormula("{A", ["A"]);
  assert(!parsed.ok, "validateFormula must return { ok: false }, not throw");

  let wrapperThrew = false;
  let result: FormulaValidation = { state: "unvalidated" };
  try {
    result = validateDerivedFormula("{A", POINTS, "D");
  } catch {
    wrapperThrew = true;
  }
  assert(!wrapperThrew, "the wrapper must never throw — it runs on every keystroke");
  assert(result.state === "error", `expected state "error", got "${result.state}"`);
}

/**
 * Case 8 — position-accurate placement inside a longer expression.
 *
 * A range derived from the wrong end of a token still produces a diagnostic and
 * still looks correct in a summary list. It underlines the wrong text.
 */
export function runDiagnosticPlacementTests(): void {
  const diagnostic = onlyDiagnostic(
    validateDerivedFormula("1 + {NOPE} + 2", POINTS, "D"),
    "placement",
  );
  assert(diagnostic.from === 4, `from must be 4, got ${diagnostic.from}`);
  assert(diagnostic.to === 10, `to must be 10, got ${diagnostic.to}`);
}

/**
 * Case 9 — an `"unvalidated"` KPI is never an error.
 *
 * The expression here does not parse and must not be parsed. ADR 0038
 * decision 9: opening a template to fix an alarm message and pressing Save must
 * never reject a KPI the author did not touch.
 */
export function runUnvalidatedDialectTests(): void {
  const kpi = {
    expression: "whatever ###",
    pointKeys: ["A"],
    dialect: "unvalidated",
  } as const;
  const result = validateKpiExpression(kpi, DECLARED);
  assert(
    result.state === "unvalidated",
    `an unvalidated KPI must stay unvalidated, got ${JSON.stringify(result)}`,
  );
}

/**
 * Case 10 — the opt-in upgrade, both directions.
 *
 * The failure direction is the one that matters. `upgradeKpiToCalcDialect`
 * returns the input **reference**, so `Object.is` gates it: a caller that
 * writes `result.kpi` unconditionally writes nothing new. The frozen copy
 * catches an in-place mutation, which reference identity alone would not.
 */
export function runKpiUpgradeTests(): void {
  const good: TemplateKpi = {
    code: "COP",
    name: "Coefficient of performance",
    pointKeys: ["A", "B"],
    expression: "{A} / {B}",
    dialect: "unvalidated",
  };
  const upgraded = upgradeKpiToCalcDialect(good, DECLARED);
  assert(
    upgraded.validation.state === "ok",
    `a parsable expression must upgrade, got ${JSON.stringify(upgraded.validation)}`,
  );
  assert(
    upgraded.kpi.dialect === CALC_DIALECT,
    `dialect must become ${CALC_DIALECT}, got ${upgraded.kpi.dialect}`,
  );
  assert(upgraded.kpi !== good, "success must return a new object, not mutate the input");
  assert(good.dialect === "unvalidated", "the input must not be mutated on success either");
  assert(
    upgraded.kpi.expression === good.expression,
    "the expression must survive the upgrade unchanged",
  );

  const bad: TemplateKpi = {
    code: "BAD",
    name: "Broken",
    pointKeys: ["A"],
    expression: "{A} +",
    dialect: "unvalidated",
  };
  const before = JSON.stringify(bad);
  const rejected = upgradeKpiToCalcDialect(bad, DECLARED);
  assert(
    rejected.validation.state === "error",
    `an unparsable expression must fail, got ${JSON.stringify(rejected.validation)}`,
  );
  assert(Object.is(rejected.kpi, bad), "failure must return the input reference untouched");
  assert(JSON.stringify(bad) === before, "failure must write nothing — not the dialect, not the expression");
}
