import type { CalcEvalErrorCode, CalcEvalResult } from "./evaluate";
import { evaluate } from "./evaluate";
import { parseFormula } from "./parser";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Parses `expression` and evaluates it against `inputs` in one step — every
 * test here exercises the real parser's AST, never a hand-built one. */
function evalExpr(expression: string, inputs: Record<string, number>): CalcEvalResult {
  const parsed = parseFormula(expression);
  if (!parsed.ok) {
    throw new Error(`expected ${JSON.stringify(expression)} to parse, got errors: ${JSON.stringify(parsed.errors)}`);
  }
  return evaluate(parsed.ast, new Map(Object.entries(inputs)));
}

function expectValue(expression: string, inputs: Record<string, number>, expected: number, message: string): void {
  const result = evalExpr(expression, inputs);
  assert(result.ok === true, `${message} — expected ok, got ${JSON.stringify(result)}`);
  if (result.ok) {
    assert(
      Object.is(result.value, expected),
      `${message} — expected ${expected}, got ${result.value}`,
    );
  }
}

function expectRefusal(
  expression: string,
  inputs: Record<string, number>,
  code: CalcEvalErrorCode,
  message: string,
): CalcEvalResult {
  const result = evalExpr(expression, inputs);
  assert(result.ok === false, `${message} — expected a refusal, got ${JSON.stringify(result)}`);
  if (!result.ok) {
    assert(result.code === code, `${message} — expected code ${code}, got ${result.code}`);
  }
  return result;
}

export function runEvaluateTests(): void {
  // ---- -0 normalisation — Object.is, never toEqual-style loose comparison ------

  expectValue("round({A})", { A: -0.5 }, 0, "round(-0.5) must normalise -0 to 0");
  expectValue("-{A}", { A: 0 }, 0, "-0 (unary negation of 0) must normalise to 0");

  // ---- round is half toward +Infinity, and the asymmetry is a paired assertion --

  expectValue("round({A})", { A: 0.5 }, 1, "round(0.5) must be 1");
  expectValue("round({A})", { A: -0.5 }, 0, "round(-0.5) must be 0, not -1 or -0");

  // ---- finiteness is checked at the node that produced it, not only the root ---

  // min(A * B, 5) — the multiply overflows to Infinity, and a root-only check
  // would let `min` absorb it back down to the finite 5. The multiply itself
  // must refuse before `min` ever runs.
  const absorbed = expectRefusal(
    "min({A} * {B}, 5)",
    { A: 1e200, B: 1e200 },
    "non_finite",
    "an overflowing intermediate must refuse at the multiply, not be absorbed by min()",
  );
  if (!absorbed.ok) {
    // the multiply's own operator token ("min({A} * ..." — the "*" is at index 8),
    // not the root call's position
    assert(absorbed.position === 8, `expected the multiply's position (8), got ${absorbed.position}`);
  }

  // The ADR's own worked example: (A*B) - (A*B) refuses at the first
  // multiply, even though the root subtraction's inputs would also both be
  // non-finite (Infinity - Infinity = NaN either way).
  const worked = expectRefusal(
    "({A} * {B}) - ({A} * {B})",
    { A: 1e200, B: 1e200 },
    "non_finite",
    "(A*B) - (A*B) with overflowing A*B must refuse at the first multiply",
  );
  if (!worked.ok) {
    // "({A} * {B}) - ..." — the first "*" is at index 5
    assert(worked.position === 5, `expected the first multiply's position (5), got ${worked.position}`);
  }

  // ---- division by zero -----------------------------------------------------

  expectRefusal("{A} / {B}", { A: 1, B: 0 }, "non_finite", "1 / 0 must refuse as non-finite");
  expectRefusal("{A} / {B}", { A: 0, B: 0 }, "non_finite", "0 / 0 must refuse as non-finite");

  // ---- clamp ------------------------------------------------------------------

  expectRefusal("clamp({A}, 10, 5)", { A: 7 }, "invalid_clamp_range", "clamp with lo > hi must refuse");
  expectValue("clamp({A}, 5, 10)", { A: 1 }, 5, "clamp below lo must clamp to lo");
  expectValue("clamp({A}, 5, 10)", { A: 20 }, 10, "clamp above hi must clamp to hi");
  expectValue("clamp({A}, 5, 10)", { A: 7 }, 7, "clamp inside the range must pass through");

  // ---- a bare ref is checked too, not only computed nodes -----------------------
  // (a formula that is nothing but `{A}` must refuse a non-finite input the same
  // way a computed node would — never return Infinity/NaN as if it were a value)

  const bareRefInfinity = expectRefusal(
    "{A}",
    { A: Infinity },
    "non_finite",
    "a bare ref resolving to a non-finite input must refuse, not pass the value through",
  );
  if (!bareRefInfinity.ok) {
    assert(bareRefInfinity.position === 0, `expected the ref's own position (0), got ${bareRefInfinity.position}`);
  }
  expectRefusal("{A}", { A: NaN }, "non_finite", "a bare ref resolving to NaN must refuse");

  // ---- missing input ------------------------------------------------------------

  const missing = expectRefusal("{A} + {B}", { A: 1 }, "missing_input", "a ref absent from inputs must refuse");
  if (!missing.ok) {
    // "{A} + {B}" — {B}'s opening "{" is at index 6
    assert(missing.position === 6, `expected {B}'s position (6), got ${missing.position}`);
  }

  // ---- min/max/abs at arity bounds --------------------------------------------

  expectValue("min({A}, {B})", { A: 3, B: 1 }, 1, "min at its minimum arity");
  expectValue("max({A}, {B})", { A: 3, B: 1 }, 3, "max at its minimum arity");
  expectValue("abs({A})", { A: -5 }, 5, "abs of a negative value");
  expectValue("abs({A})", { A: -0 }, 0, "abs(-0) must normalise to 0");

  // ---- happy path ---------------------------------------------------------------

  expectValue("({A} + {B}) / 2", { A: 4, B: 6 }, 5, "the ADR's own averaging shape");
}
