import type { CalcErrorCode, CalcExpr, ParseResult } from "./ast";
import { CALC_FUNCTION_ARITY, MAX_FORMULA_DEPTH, MAX_FORMULA_LENGTH, MAX_FORMULA_POINT_REFS } from "./limits";
import { formatCalcError, parseFormula, validateFormula } from "./parser";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectOk(expression: string): Extract<ParseResult, { ok: true }> {
  const result = parseFormula(expression);
  if (!result.ok) {
    throw new Error(
      `expected ${JSON.stringify(expression)} to parse, got errors: ${JSON.stringify(result.errors)}`,
    );
  }
  return result;
}

function expectFailCode(expression: string, code: CalcErrorCode, message: string): void {
  const result = parseFormula(expression);
  assert(result.ok === false, `${message} — expected a failure, got ok`);
  if (!result.ok) {
    assert(
      result.errors[0]?.code === code,
      `${message} — expected code ${code}, got ${result.errors[0]?.code}`,
    );
  }
}

export function runParserTests(): void {
  // ---- precedence and associativity ------------------------------------------

  const precedence = expectOk("2 + 3 * 4");
  assert(
    precedence.ast.kind === "binary" &&
      precedence.ast.op === "+" &&
      precedence.ast.right.kind === "binary" &&
      precedence.ast.right.op === "*",
    "2 + 3 * 4 must bind * tighter than +, not parse left-to-right",
  );

  const leftAssoc = expectOk("10 - 3 - 2").ast as Extract<CalcExpr, { kind: "binary" }>;
  assert(
    leftAssoc.kind === "binary" &&
      leftAssoc.op === "-" &&
      leftAssoc.left.kind === "binary" &&
      leftAssoc.left.op === "-",
    "10 - 3 - 2 must be left-associative: (10 - 3) - 2",
  );

  const parens = expectOk("(2 + 3) * 4").ast;
  assert(
    parens.kind === "binary" && parens.op === "*" && parens.left.kind === "binary" && parens.left.op === "+",
    "parentheses must override precedence",
  );

  // ---- the ADR's own worked example round-trips --------------------------------

  const worked = expectOk("({SUB_METER_1_KWH} + {SUB_METER_2_KWH}) / {TOTAL_KWH}");
  assert(
    worked.refs.join(",") === "SUB_METER_1_KWH,SUB_METER_2_KWH,TOTAL_KWH",
    `refs should be in first-appearance order, got ${worked.refs.join(",")}`,
  );

  // ---- calls -----------------------------------------------------------------

  expectOk("clamp({A}, 0, 100)");
  expectOk("abs({A})");
  expectOk("min(max({A}, {B}), 5)");

  expectFailCode("pow({A}, 2)", "unknown_function", "pow is not a whitelisted function");
  const unknownFnResult = parseFormula("pow({A}, 2)");
  assert(unknownFnResult.ok === false, "pow(...) must fail to parse");
  if (!unknownFnResult.ok) {
    assert(
      !formatCalcError(unknownFnResult.errors[0]).includes("pow"),
      "the unknown-function error must not name the function",
    );
  }

  // ---- arity, exactly at and either side of each whitelisted function's bound ---

  for (const [fn, arity] of Object.entries(CALC_FUNCTION_ARITY)) {
    const arg = "{A}";
    const withinMin = `${fn}(${Array(arity.min).fill(arg).join(",")})`;
    const withinMax = `${fn}(${Array(arity.max).fill(arg).join(",")})`;
    expectOk(withinMin);
    expectOk(withinMax);

    if (arity.min > 0) {
      const belowMin = `${fn}(${Array(arity.min - 1).fill(arg).join(",")})`;
      expectFailCode(belowMin || `${fn}()`, "bad_arity", `${fn} below its minimum arity must fail`);
    }
    const aboveMax = `${fn}(${Array(arity.max + 1).fill(arg).join(",")})`;
    expectFailCode(aboveMax, "bad_arity", `${fn} above its maximum arity must fail`);
  }

  // ---- malformed programs ------------------------------------------------------

  expectFailCode("2 +", "unexpected_end", "a trailing operator must fail");
  expectFailCode("2 3", "trailing_input", "two juxtaposed terms must fail");
  expectFailCode("", "empty_expression", "an empty expression must fail");
  expectFailCode("   ", "empty_expression", "a whitespace-only expression must fail");

  // ---- bounds -------------------------------------------------------------------

  expectFailCode("1".repeat(MAX_FORMULA_LENGTH + 1), "too_long", "over the length cap must fail");

  const twentyOneRefs = Array.from({ length: MAX_FORMULA_POINT_REFS + 1 }, (_, i) => `{P${i}}`).join("+");
  expectFailCode(twentyOneRefs, "too_many_refs", "21 distinct refs must fail");

  const twentyRefsRepeated = Array.from(
    { length: MAX_FORMULA_POINT_REFS },
    (_, i) => `{P${i}}`,
  )
    .concat(Array.from({ length: MAX_FORMULA_POINT_REFS }, (_, i) => `{P${i}}`))
    .join("+");
  expectOk(twentyRefsRepeated);

  const deeplyNested = "(".repeat(65) + "1" + ")".repeat(65);
  const deepResult = parseFormula(deeplyNested);
  assert(deepResult.ok === false, "65 nested parens must be rejected, not stack-overflow");
  if (!deepResult.ok) {
    assert(
      deepResult.errors[0]?.code === "too_deep",
      `expected too_deep, got ${deepResult.errors[0]?.code}`,
    );
  }
  assert(MAX_FORMULA_DEPTH === 64, "guard constant moved without updating this test's expectation");

  // ---- validateFormula: name-only, pure -----------------------------------------

  const missingRef = validateFormula("{A} + {B}", ["A"]);
  assert(missingRef.ok === false, "a ref outside knownRefs must fail");
  if (!missingRef.ok) {
    assert(missingRef.errors[0]?.code === "unknown_reference", "must report unknown_reference");
  }

  const unusedKnownRefIsFine = validateFormula("{A}", ["A", "B"]);
  assert(unusedKnownRefIsFine.ok === true, "an unused known ref is not this layer's concern");

  // ---- purity: same input, same output, no mutation ------------------------------

  const first = parseFormula("2 + {A} * 3");
  const second = parseFormula("2 + {A} * 3");
  assert(JSON.stringify(first) === JSON.stringify(second), "parseFormula must be pure");
}
