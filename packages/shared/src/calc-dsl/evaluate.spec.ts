import type { CalcEvalErrorCode, CalcEvalResult } from "./evaluate";
import { evaluate } from "./evaluate";
import { CALC_DIALECT_V2 } from "./limits";
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

/** The `v2` sibling of `evalExpr`: parses under `bms-calc-v2` and passes the
 * third, cross-asset map. `crossInputs` is keyed by `crossRefKey` strings —
 * written out literally here so the spec pins the canonical form the host
 * must produce, not whatever `crossRefKey` happens to return. */
function evalExprV2(
  expression: string,
  inputs: Record<string, number>,
  crossInputs: Record<string, number>,
): CalcEvalResult {
  const parsed = parseFormula(expression, { dialect: CALC_DIALECT_V2 });
  if (!parsed.ok) {
    throw new Error(`expected ${JSON.stringify(expression)} to parse under v2, got errors: ${JSON.stringify(parsed.errors)}`);
  }
  return evaluate(parsed.ast, new Map(Object.entries(inputs)), new Map(Object.entries(crossInputs)));
}

/**
 * The `bms-calc-v2` half (ADR 0055; `F2.9` Task 2). The evaluator stays pure
 * (ADR 0037 decision 1): it resolves nothing, it only looks a cross reference
 * up in the map the host filled before calling.
 */
export function runEvaluateV2Tests(): void {
  // ---- an aggregate reads its value from crossInputs by canonical key ---------

  const half = evalExprV2("sum({kw} @site) / 2", {}, { "sum(kw)@site": 10 });
  assert(half.ok === true && Object.is(half.value, 5), `sum(kw)@site = 10 halved must be 5, got ${JSON.stringify(half)}`);

  const grouped = evalExprV2("sum({kw} @site) / sum({kw} @group('IT_LOAD'))", {}, { "sum(kw)@site": 10, "sum(kw)@group:IT_LOAD": 4 });
  assert(grouped.ok === true && Object.is(grouped.value, 2.5), `the ADR's PUE shape must compute, got ${JSON.stringify(grouped)}`);

  // ---- a qref reads by CODE.key --------------------------------------------------

  const balance = evalExprV2("{TX_01.kwh} - {TX_02.kwh}", {}, { "TX_01.kwh": 7, "TX_02.kwh": 3 });
  assert(balance.ok === true && Object.is(balance.value, 4), `a balance of two qrefs must compute, got ${JSON.stringify(balance)}`);

  // ---- absent → missing_input at the node's own position ------------------------

  const absent = evalExprV2("sum({kw} @site) / 2", {}, {});
  assert(absent.ok === false && absent.code === "missing_input", `an absent aggregate must refuse as missing_input, got ${JSON.stringify(absent)}`);
  if (!absent.ok) {
    assert(absent.position === 0, `expected the aggregate's position (0), got ${absent.position}`);
  }
  const absentQref = evalExprV2("{TX_01.kwh} - {TX_02.kwh}", {}, { "TX_01.kwh": 7 });
  assert(absentQref.ok === false && absentQref.code === "missing_input", "an absent qref must refuse as missing_input");
  if (!absentQref.ok) {
    // "{TX_01.kwh} - {TX_02.kwh}" — the second brace is at 14
    assert(absentQref.position === 14, `expected the second qref's position (14), got ${absentQref.position}`);
  }

  // ---- a non-finite cross input refuses at the node, like a local ref does ----

  const infinite = evalExprV2("sum({kw} @site) / 2", {}, { "sum(kw)@site": Infinity });
  assert(infinite.ok === false && infinite.code === "non_finite", `Infinity in crossInputs must refuse as non_finite, got ${JSON.stringify(infinite)}`);
  if (!infinite.ok) {
    assert(infinite.position === 0, `expected the aggregate's position (0), got ${infinite.position}`);
  }
  const nan = evalExprV2("1 + {TX_01.kwh}", {}, { "TX_01.kwh": NaN });
  assert(nan.ok === false && nan.code === "non_finite", "NaN in crossInputs must refuse as non_finite");
  if (!nan.ok) {
    assert(nan.position === 4, `expected the qref's position (4), got ${nan.position}`);
  }

  // ---- the two namespaces never meet --------------------------------------------
  // A local ref is served from `inputs` only, and a cross ref from `crossInputs`
  // only. A v1 AST given a non-empty crossInputs map ignores it entirely — even
  // when that map happens to hold the local key.

  const v1Parsed = parseFormula("{A} + 1");
  if (!v1Parsed.ok) {
    throw new Error("v1 fixture must parse");
  }
  const v1Ignores = evaluate(v1Parsed.ast, new Map([["A", 1]]), new Map([["A", 100], ["sum(A)@site", 5]]));
  assert(v1Ignores.ok === true && Object.is(v1Ignores.value, 2), `a v1 AST must read A from inputs, not crossInputs, got ${JSON.stringify(v1Ignores)}`);
  const v1NotServedByCross = evaluate(v1Parsed.ast, new Map(), new Map([["A", 100]]));
  assert(
    v1NotServedByCross.ok === false && v1NotServedByCross.code === "missing_input",
    `a local ref must never be served from crossInputs, got ${JSON.stringify(v1NotServedByCross)}`,
  );
  const crossNotServedByLocal = evalExprV2("{TX_01.kwh}", { "TX_01.kwh": 9 }, {});
  assert(
    crossNotServedByLocal.ok === false && crossNotServedByLocal.code === "missing_input",
    `a qref must never be served from inputs, got ${JSON.stringify(crossNotServedByLocal)}`,
  );

  // ---- the third argument is optional — every existing caller keeps compiling ---

  const twoArg = evaluate(v1Parsed.ast, new Map([["A", 1]]));
  assert(twoArg.ok === true && Object.is(twoArg.value, 2), "evaluate(ast, inputs) with no crossInputs must still work");
}
