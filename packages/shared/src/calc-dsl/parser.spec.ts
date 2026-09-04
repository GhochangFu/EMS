import type { CalcErrorCode, CalcExpr, CalcParseError, ParseResult } from "./ast";
import { crossRefKey } from "./cross-ref";
import {
  CALC_DIALECT_V2,
  CALC_FUNCTION_ARITY,
  MAX_FORMULA_CROSS_REFS,
  MAX_FORMULA_DEPTH,
  MAX_FORMULA_LENGTH,
  MAX_FORMULA_POINT_REFS,
} from "./limits";
import { formatCalcError, parseFormula, validateFormula, type ParseOptions } from "./parser";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectOk(expression: string, options?: ParseOptions): Extract<ParseResult, { ok: true }> {
  const result = parseFormula(expression, options);
  if (!result.ok) {
    throw new Error(
      `expected ${JSON.stringify(expression)} to parse, got errors: ${JSON.stringify(result.errors)}`,
    );
  }
  return result;
}

function expectFailCode(
  expression: string,
  code: CalcErrorCode,
  message: string,
  options?: ParseOptions,
): CalcParseError {
  const result = parseFormula(expression, options);
  assert(result.ok === false, `${message} — expected a failure, got ok`);
  if (!result.ok) {
    assert(
      result.errors[0]?.code === code,
      `${message} — expected code ${code}, got ${result.errors[0]?.code}`,
    );
    return result.errors[0];
  }
  throw new Error("unreachable");
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
  // ADR 0055 decision 3/4 — `crossRefs` exists on every ok result and is
  // always `[]` under `v1`, so a caller reading it never branches on dialect.
  assert(
    Array.isArray(worked.crossRefs) && worked.crossRefs.length === 0,
    `a v1 parse must carry crossRefs: [], got ${JSON.stringify(worked.crossRefs)}`,
  );

  // ---- the v1 refusal that must survive v2 (ADR 0055 decision 3) --------------
  // With no options the parser is `v1`, so the `@` is an unexpected character
  // at 9 — never a scope token, never `scope_not_allowed`.

  const v1Refusal = expectFailCode(
    "sum({kw} @site)",
    "unexpected_character",
    "sum({kw} @site) with no dialect option must refuse at the lexer, as v1 always did",
  );
  assert(v1Refusal.position === 9, `expected the @ at 9, got ${v1Refusal.position}`);

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

const V2: ParseOptions = { dialect: CALC_DIALECT_V2 };

/**
 * The `bms-calc-v2` half (ADR 0055; `F2.9` Task 2). Every case passes
 * `{ dialect: "bms-calc-v2" }` explicitly — the `v1` half above never does,
 * and that asymmetry is the superset property under test.
 */
export function runParserV2Tests(): void {
  // ---- the ADR's two worked examples parse -----------------------------------

  const ratio = expectOk("sum({kw} @site) / sum({kw} @group('IT_LOAD'))", V2);
  assert(ratio.ast.kind === "binary" && ratio.ast.op === "/", "the site ratio must parse to a root binary /");
  if (ratio.ast.kind === "binary") {
    assert(ratio.ast.left.kind === "aggregate", `left of / must be an aggregate, got ${ratio.ast.left.kind}`);
    assert(ratio.ast.right.kind === "aggregate", `right of / must be an aggregate, got ${ratio.ast.right.kind}`);
    if (ratio.ast.left.kind === "aggregate" && ratio.ast.right.kind === "aggregate") {
      assert(ratio.ast.left.position === 0, `an aggregate's position is its function name, got ${ratio.ast.left.position}`);
      assert(ratio.ast.right.position === 18, `the second aggregate's name is at 18, got ${ratio.ast.right.position}`);
      assert(ratio.ast.left.scope.kind === "site", "left scope must be site");
      assert(
        ratio.ast.right.scope.kind === "group" && ratio.ast.right.scope.code === "IT_LOAD",
        `right scope must be group:IT_LOAD, got ${JSON.stringify(ratio.ast.right.scope)}`,
      );
    }
  }
  assert(ratio.crossRefs.length === 2, `the site ratio must carry two cross refs, got ${ratio.crossRefs.length}`);
  assert(ratio.refs.length === 0, `an aggregate's point key is not a local ref, got refs ${JSON.stringify(ratio.refs)}`);
  assert(
    ratio.crossRefs.map(crossRefKey).join("|") === "sum(kw)@site|sum(kw)@group:IT_LOAD",
    `cross ref keys in first-appearance order, got ${ratio.crossRefs.map(crossRefKey).join("|")}`,
  );

  const balance = expectOk("{TX_01.kwh} - {TX_02.kwh}", V2);
  assert(
    balance.crossRefs.length === 2 && balance.crossRefs.every((node) => node.kind === "qref"),
    `a balance must carry two qrefs, got ${JSON.stringify(balance.crossRefs)}`,
  );
  assert(
    balance.crossRefs.map(crossRefKey).join("|") === "TX_01.kwh|TX_02.kwh",
    `qref keys must be CODE.key, got ${balance.crossRefs.map(crossRefKey).join("|")}`,
  );
  assert(
    balance.crossRefs[0].position === 0 && balance.crossRefs[1].position === 14,
    `a qref's position is its opening brace, got ${balance.crossRefs.map((n) => n.position).join(",")}`,
  );
  assert(balance.refs.length === 0, "a qualified reference is never a local ref");

  // ---- local and cross are separate lists ------------------------------------

  const mixed = expectOk("sum({kw} @site) + {kw}", V2);
  assert(mixed.refs.join(",") === "kw", `the local {kw} must be the only local ref, got ${JSON.stringify(mixed.refs)}`);
  assert(mixed.crossRefs.length === 1, `the aggregate must be the only cross ref, got ${mixed.crossRefs.length}`);

  // ---- every v1 shape still parses identically under v2 (a spot check; Task 3
  // holds the property) ---------------------------------------------------------

  const v1UnderV2 = expectOk("({SUB_METER_1_KWH} + {SUB_METER_2_KWH}) / {TOTAL_KWH}", V2);
  assert(
    JSON.stringify(v1UnderV2) === JSON.stringify(expectOk("({SUB_METER_1_KWH} + {SUB_METER_2_KWH}) / {TOTAL_KWH}")),
    "a v1 formula must parse to the same result under v2",
  );

  // ---- the six parser codes, one expression each ------------------------------
  // Every expression carries IT_LOAD, TX_01 or foo so the no-echo loop below
  // has something to catch.

  const offending = ["IT_LOAD", "TX_01", "foo"];
  const refusals: { code: CalcErrorCode; expression: string; position: number }[] = [
    { code: "malformed_scope", expression: "sum({TX_01} @group(foo))", position: 12 },
    { code: "malformed_scope", expression: "sum({TX_01} @group)", position: 12 },
    { code: "malformed_scope", expression: "sum({TX_01} @site('IT_LOAD'))", position: 12 },
    { code: "scope_required", expression: "sum({TX_01})", position: 11 },
    { code: "scope_not_allowed", expression: "{TX_01.kwh} @group('IT_LOAD')", position: 12 },
    { code: "scope_not_allowed", expression: "min({TX_01} @site, 1)", position: 12 },
    { code: "scope_not_allowed", expression: "@site + {foo}", position: 0 },
    { code: "aggregate_needs_point_reference", expression: "sum(foo @group('IT_LOAD'))", position: 4 },
    { code: "aggregate_needs_point_reference", expression: "avg(1 @site)", position: 4 },
    { code: "qualified_reference_in_aggregate", expression: "sum({TX_01.kwh} @group('IT_LOAD'))", position: 4 },
  ];
  for (const { code, expression, position } of refusals) {
    const error = expectFailCode(expression, code, `${JSON.stringify(expression)} must refuse as ${code}`, V2);
    assert(error.position === position, `${JSON.stringify(expression)}: expected ${code} at ${position}, got ${error.position}`);
    const message = formatCalcError(error);
    for (const fragment of offending) {
      assert(!message.includes(fragment), `formatCalcError for ${code} must not echo ${fragment}: ${message}`);
    }
  }

  // ---- too_many_cross_refs: nine distinct refuse, eight pass, duplicates dedupe

  const nineTerms = Array.from({ length: MAX_FORMULA_CROSS_REFS + 1 }, (_, i) => `sum({TX_01} @group('IT_LOAD_${i}'))`);
  const nine = nineTerms.join(" + ");
  const tooMany = expectFailCode(nine, "too_many_cross_refs", "nine distinct aggregates must refuse", V2);
  assert(tooMany.position === nine.lastIndexOf("sum("), `the ninth aggregate's own position, got ${tooMany.position}`);
  for (const fragment of offending) {
    assert(!formatCalcError(tooMany).includes(fragment), `too_many_cross_refs must not echo ${fragment}`);
  }
  const eight = expectOk(nineTerms.slice(0, MAX_FORMULA_CROSS_REFS).join(" + "), V2);
  assert(eight.crossRefs.length === MAX_FORMULA_CROSS_REFS, `eight distinct aggregates must pass, got ${eight.crossRefs.length}`);
  assert(MAX_FORMULA_CROSS_REFS === 8, "bound moved without updating this test's expectation");

  const twice = expectOk("sum({kw} @site) + sum({kw} @site)", V2);
  assert(twice.crossRefs.length === 1, `the same aggregate twice must dedupe to one cross ref, got ${twice.crossRefs.length}`);
  const twiceQref = expectOk("{TX_01.kwh} * {TX_01.kwh}", V2);
  assert(twiceQref.crossRefs.length === 1, `the same qref twice must dedupe to one cross ref, got ${twiceQref.crossRefs.length}`);
  const sameKeyDifferentScope = expectOk("sum({kw} @group('A')) - sum({kw} @group('B'))", V2);
  assert(sameKeyDifferentScope.crossRefs.length === 2, "the same point key under two scope codes is two cross refs");

  // ---- validateFormula checks LOCAL refs only ----------------------------------
  // A cross reference's asset and point key are resolved by the api host at
  // save and evaluation time; this layer has no membership to check against.

  assert(validateFormula("sum({kw} @site) + {kw}", ["kw"], V2).ok === true, "an aggregate must not be checked against knownRefs");
  assert(validateFormula("{TX_01.kwh} + {a}", ["a"], V2).ok === true, "a qref must not be checked against knownRefs");
  const unknownLocal = validateFormula("sum({kw} @site) + {b}", ["kw"], V2);
  assert(unknownLocal.ok === false, "a local ref outside knownRefs must still refuse under v2");
  if (!unknownLocal.ok) {
    assert(unknownLocal.errors[0]?.code === "unknown_reference", `expected unknown_reference, got ${unknownLocal.errors[0]?.code}`);
    assert(unknownLocal.errors[0]?.position === 18, `expected {b} at 18, got ${unknownLocal.errors[0]?.position}`);
  }

  // ---- purity ------------------------------------------------------------------

  const first = parseFormula("sum({kw} @site) / {TX_01.kwh}", V2);
  const second = parseFormula("sum({kw} @site) / {TX_01.kwh}", V2);
  assert(JSON.stringify(first) === JSON.stringify(second), "parseFormula must be pure under v2");
}
