import type { CalcErrorCode, CalcExpr, CalcParseError, ParseResult } from "./ast";
import { crossRefKey } from "./cross-ref";
import { windowKey } from "./window-ref";
import {
  CALC_DIALECT_V2,
  CALC_DIALECT_V3,
  MAX_FORMULA_PARAM_REFS,
  MAX_FORMULA_WINDOWS,
  CALC_FUNCTION_ARITY,
  MAX_FORMULA_CROSS_REFS,
  MAX_FORMULA_DEPTH,
  MAX_FORMULA_LENGTH,
  MAX_FORMULA_POINT_REFS,
} from "./limits";
import { formatCalcError, parseFormula, validateFormula, type ParseOptions } from "./parser";
import { V1_CORPUS, V1_REFUSALS_V2_ACCEPTS, V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE } from "./v1-corpus";
import { V2_CORPUS, V2_REFUSALS_V3_ACCEPTS, V2_REFUSALS_WITH_A_DIFFERENT_V3_CODE } from "./v2-corpus";

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

  // ---- the v1 guard on the two v2 aggregate keywords (ADR 0055 decision 3) ----
  // `sum` and `avg` open an aggregate under `v2`. Under `v1` they are not
  // functions at all, so they must reach the ordinary call path and be refused
  // as unknown, at the identifier.
  //
  // This is an **absolute `v1` assertion**, not a dialect-agreement one, and
  // that is the whole point of it: the mutation it exists to catch — dropping
  // the `isV2` gate in `parseFactor` — makes `v1` refuse with `scope_required`
  // exactly as `v2` does, so every agreement check in
  // `dialect-superset.spec.ts` stays green while `v1`'s meaning has moved.
  // `V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE` pins the same pair from the corpus
  // side.
  const v1Sum = expectFailCode("sum({A})", "unknown_function", "v1 guard: sum is not a v1 function");
  assert(v1Sum.position === 0, `the unknown function must be reported at the identifier, got ${v1Sum.position}`);
  expectFailCode("avg({A})", "unknown_function", "v1 guard: avg is not a v1 function");
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

  // ---- v1-corpus.ts smoke check (F2.9 Task 3, ADR 0055 decision 4) ------------
  // The full superset property is `dialect-superset.spec.ts`'s job; this loop
  // only proves every literal this spec feeds `parseFormula` also lives in
  // that shared corpus and still parses to a `ParseResult` here, so the
  // corpus cannot silently stop importing without failing this spec too.
  for (const expression of V1_CORPUS) {
    const result = parseFormula(expression);
    assert(
      typeof result.ok === "boolean",
      `v1-corpus.ts entry must parse to a ParseResult here too: ${JSON.stringify(expression)}`,
    );
  }
  assert(
    V1_REFUSALS_V2_ACCEPTS.every((expression) => V1_CORPUS.includes(expression)),
    "every V1_REFUSALS_V2_ACCEPTS entry must itself be a V1_CORPUS entry",
  );
  assert(
    V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE.every((entry) => V1_CORPUS.includes(entry.expression)),
    "every V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE entry must itself be a V1_CORPUS entry — " +
      "an entry the corpus never holds is checked by nothing",
  );
}

const V2: ParseOptions = { dialect: CALC_DIALECT_V2 };
const V3: ParseOptions = { dialect: CALC_DIALECT_V3 };

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
    ratio.crossRefs.map(crossRefKey).join("|") === "a:sum(kw)@site|a:sum(kw)@group:IT_LOAD",
    `cross ref keys in first-appearance order, got ${ratio.crossRefs.map(crossRefKey).join("|")}`,
  );

  const balance = expectOk("{TX_01.kwh} - {TX_02.kwh}", V2);
  assert(
    balance.crossRefs.length === 2 && balance.crossRefs.every((node) => node.kind === "qref"),
    `a balance must carry two qrefs, got ${JSON.stringify(balance.crossRefs)}`,
  );
  assert(
    balance.crossRefs.map(crossRefKey).join("|") === "q:TX_01.kwh|q:TX_02.kwh",
    `qref keys must be q:CODE.key — the "q:" prefix is what keeps a qref key off an ` +
      `aggregate key whatever the codes contain. Got ${balance.crossRefs.map(crossRefKey).join("|")}`,
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

  // ---- v2-corpus.ts smoke check (E4.1a U3, ADR 0070 decision 3) ---------------
  // The full v2→v3 superset property is `dialect-superset.spec.ts`'s job; this
  // loop only proves every literal this spec feeds `parseFormula` under v2 also
  // lives in that shared corpus and still parses to a ParseResult here, so the
  // corpus cannot silently stop importing without failing this spec too.
  for (const expression of V2_CORPUS) {
    const result = parseFormula(expression, V2);
    assert(
      typeof result.ok === "boolean",
      `v2-corpus.ts entry must parse to a ParseResult here too: ${JSON.stringify(expression)}`,
    );
  }
  assert(
    V2_REFUSALS_V3_ACCEPTS.every((expression) => V2_CORPUS.includes(expression)),
    "every V2_REFUSALS_V3_ACCEPTS entry must itself be a V2_CORPUS entry",
  );
  assert(
    V2_REFUSALS_WITH_A_DIFFERENT_V3_CODE.every((entry) => V2_CORPUS.includes(entry.expression)),
    "every V2_REFUSALS_WITH_A_DIFFERENT_V3_CODE entry must itself be a V2_CORPUS entry — " +
      "an entry the corpus never holds is checked by nothing",
  );
}

// ---- F2.22: author-facing wording for the ten v2 error codes ------------------
// The ten codes, enumerated from ast.ts, not the F2.22 deferral list. Keeping
// the old one-liners here (rather than deleting them) is what lets assertion
// (a) prove the rewording actually landed, and not merely that a string exists.
const V2_ERROR_CODES = [
  "unknown_scope",
  "unterminated_string",
  "empty_string",
  "malformed_qualified_reference",
  "malformed_scope",
  "scope_required",
  "scope_not_allowed",
  "aggregate_needs_point_reference",
  "qualified_reference_in_aggregate",
  "too_many_cross_refs",
] as const satisfies readonly CalcErrorCode[];

// `Record<(typeof V2_ERROR_CODES)[number], string>`, not `Record<string,
// string>` — a missing or mistyped key here is a compile error, not a
// silent `undefined` that would make assertion (a) pass vacuously for that
// code (it compares against `` `${OLD[code]} at character 0` ``, and
// `${undefined} at character 0` still fails to equal the new message).
const OLD: Readonly<Record<(typeof V2_ERROR_CODES)[number], string>> = {
  unknown_scope: "unknown scope",
  unterminated_string: "unterminated string",
  empty_string: "empty string",
  malformed_qualified_reference: "malformed qualified point reference",
  malformed_scope: "malformed scope",
  scope_required: "an aggregate needs a scope after its point reference",
  scope_not_allowed: "a scope is only allowed inside an aggregate",
  aggregate_needs_point_reference: "an aggregate takes exactly one point reference",
  qualified_reference_in_aggregate: "an aggregate cannot take a qualified point reference",
  too_many_cross_refs: "the formula has too many distinct cross-asset references",
};

/**
 * Ten codes, three claims each: the sentence changed from the `F2.9` one-liner
 * (a — the rewording landed), it echoes none of `parser.spec.ts`'s own no-echo
 * fragments (b), and it still ends with the fixed `at character N` suffix (c).
 */
export function runV2ErrorWordingTests(): void {
  const offending = ["IT_LOAD", "TX_01", "foo"];
  for (const code of V2_ERROR_CODES) {
    const message = formatCalcError({ code, position: 0 });
    assert(message !== `${OLD[code]} at character 0`, `${code}: the F2.9 one-liner must have been reworded`);
    for (const fragment of offending) {
      assert(!message.includes(fragment), `${code}: must not echo ${fragment}: ${message}`);
    }
    assert(!message.includes("sum"), `${code}: must not name the sum function: ${message}`);
    assert(!message.includes("avg"), `${code}: must not name the avg function: ${message}`);
    assert(message.endsWith("at character 0"), `${code}: must end with the fixed position suffix, got ${JSON.stringify(message)}`);
  }
}

/**
 * The `bms-calc-v3` half (ADR 0070 decisions 3 and 4; `E4.1a` U2). One added
 * production — `$key` parses to a `param` node — and a third list,
 * `paramRefs`, beside `refs` and `crossRefs`. Three lists, three namespaces:
 * a local key, a cross reference and a parameter are served from three maps
 * at evaluation time. The `v2` guard is the first assertion: a `$` under
 * `v2` must still fail exactly as it did.
 */
export function runParserV3Tests(): void {
  // ---- v2 guard ----------------------------------------------------------------

  const guard = expectFailCode("{kw} * $f", "unexpected_character", "v2 guard: $ must stay unexpected under v2", V2);
  assert(guard.position === 7, `v2 guard: the refusal is at the $, got ${guard.position}`);

  // ---- the ADR's worked example parses -------------------------------------------

  const cost = expectOk("{kw} * $energy_tariff_per_kwh", V3);
  assert(cost.ast.kind === "binary" && cost.ast.op === "*", "the cost rate must parse to a root binary *");
  if (cost.ast.kind === "binary") {
    assert(cost.ast.left.kind === "ref", `left of * must be a local ref, got ${cost.ast.left.kind}`);
    assert(cost.ast.right.kind === "param", `right of * must be a param, got ${cost.ast.right.kind}`);
    if (cost.ast.right.kind === "param") {
      assert(cost.ast.right.key === "energy_tariff_per_kwh", `param key is the code without the $, got ${cost.ast.right.key}`);
      assert(cost.ast.right.position === 7, `a param's position is its $, got ${cost.ast.right.position}`);
      assert(
        Object.keys(cost.ast.right).sort().join(",") === "key,kind,position",
        `a param node carries key, kind and position only, got ${Object.keys(cost.ast.right).join(",")}`,
      );
    }
  }
  assert(cost.refs.join("|") === "kw", `refs keeps its local meaning, got ${JSON.stringify(cost.refs)}`);
  assert(cost.paramRefs.join("|") === "energy_tariff_per_kwh", `paramRefs lists the key, got ${JSON.stringify(cost.paramRefs)}`);
  assert(cost.crossRefs.length === 0, `a param is not a cross ref, got ${JSON.stringify(cost.crossRefs)}`);

  // ---- three lists, three namespaces -----------------------------------------------

  const mixed = expectOk("sum({kw} @site) * $f + {TX_01.kwh}", V3);
  assert(mixed.crossRefs.length === 2, `two cross refs beside a param, got ${mixed.crossRefs.length}`);
  assert(mixed.paramRefs.join("|") === "f", `one param beside two cross refs, got ${JSON.stringify(mixed.paramRefs)}`);
  assert(mixed.refs.length === 0, `an aggregate's key and a qref are not local refs, got ${JSON.stringify(mixed.refs)}`);

  // ---- paramRefs dedupes in first-appearance order ----------------------------------

  const twice = expectOk("$b + $a + $b", V3);
  assert(twice.paramRefs.join("|") === "b|a", `paramRefs dedupes in first-appearance order, got ${JSON.stringify(twice.paramRefs)}`);

  // ---- a param may sit anywhere a number may ---------------------------------------------

  const nested = expectOk("clamp(-$lo, min($lo, 2), ($hi))", V3);
  assert(nested.paramRefs.join("|") === "lo|hi", `params inside calls, unary and parentheses, got ${JSON.stringify(nested.paramRefs)}`);

  // ---- paramRefs is always [] under v1 and v2 ----------------------------------------------

  assert(expectOk("{kw} + 1").paramRefs.length === 0, "a v1 parse carries an empty paramRefs");
  assert(expectOk("sum({kw} @site)", V2).paramRefs.length === 0, "a v2 parse carries an empty paramRefs");

  // ---- the bound ------------------------------------------------------------------------------

  const atCap = Array.from({ length: MAX_FORMULA_PARAM_REFS }, (_, i) => `$p${i}`).join(" + ");
  assert(expectOk(atCap, V3).paramRefs.length === MAX_FORMULA_PARAM_REFS, "exactly the cap is accepted");
  const overCap = `${atCap} + $p${MAX_FORMULA_PARAM_REFS}`;
  const tooMany = expectFailCode(overCap, "too_many_param_refs", "one distinct key over the cap must fail", V3);
  assert(
    tooMany.position === atCap.length + 3,
    `too_many_param_refs reports the overflowing key's $, got ${tooMany.position} (expected ${atCap.length + 3})`,
  );
  const repeated = Array.from({ length: MAX_FORMULA_PARAM_REFS + 5 }, () => "$same").join(" + ");
  assert(expectOk(repeated, V3).paramRefs.length === 1, "occurrences do not count, distinct keys do");

  // ---- the lexical refusals reach parseFormula as errors ------------------------------------

  assert(expectFailCode("$", "malformed_parameter_reference", "a bare $ fails through parseFormula", V3).position === 0, "at the $");
  assert(expectFailCode("2 + $1", "malformed_parameter_reference", "a leading digit fails", V3).position === 4, "at the $");

  // ---- error wording: one line each, no echo ------------------------------------------------------

  for (const code of ["malformed_parameter_reference", "too_many_param_refs"] as const satisfies readonly CalcErrorCode[]) {
    const message = formatCalcError({ code, position: 7 });
    assert(!message.includes("energy") && !message.includes("p8"), `${code}: must not echo a key: ${message}`);
    assert(message.endsWith("at character 7"), `${code}: must end with the position suffix, got ${JSON.stringify(message)}`);
    assert(message.includes("$"), `${code}: must name the $ syntax so the author knows the fix: ${message}`);
  }

  // ---- purity ---------------------------------------------------------------------------------------

  assert(
    JSON.stringify(parseFormula("{kw} * $f", V3)) === JSON.stringify(parseFormula("{kw} * $f", V3)),
    "two parses of one v3 formula are structurally equal",
  );

  // ---- validateFormula checks local refs only; the vocabulary is the api's ----------------------------

  const valid = validateFormula("{kw} * $unknown_key", ["kw"], V3);
  assert(valid.ok === true, `validateFormula does not know the vocabulary, got ${JSON.stringify(valid)}`);
  const badLocal = validateFormula("{kw} * $f", [], V3);
  assert(badLocal.ok === false && badLocal.errors[0]?.code === "unknown_reference", "a local ref is still checked under v3");

  // ---- everything v2 parses, v3 parses to the same AST ------------------------------------------------

  for (const expression of ["sum({kw} @site) / sum({kw} @group('IT_LOAD'))", "{TX_01.kwh} - {TX_02.kwh}", "({a} + {b}) / 2"]) {
    const underV2 = parseFormula(expression, V2);
    const underV3 = parseFormula(expression, V3);
    assert(underV2.ok && underV3.ok, `${expression} must parse under both`);
    if (underV2.ok && underV3.ok) {
      assert(JSON.stringify(underV2.ast) === JSON.stringify(underV3.ast), `${expression}: same AST under v2 and v3`);
      assert(JSON.stringify(underV2.crossRefs) === JSON.stringify(underV3.crossRefs), `${expression}: same crossRefs`);
    }
  }
}

/**
 * The `v3` window half (ADR 0070 decisions 5 and 6; `E4.1b` plan design
 * decisions 2, 4, 7 and 12). Two new node kinds — `window` (one of the five
 * functions over exactly one point reference and one window literal) and
 * `hours` (a window literal alone) — and a fourth list, `windowReads`,
 * deduped by `windowKey`. The point inside a window joins `refs` /
 * `crossRefs` exactly as it would bare, so every rule hanging off those lists
 * (staleness, `unknown_reference`, the cross-ref catalog check, membership,
 * the cycle detectors) applies unchanged.
 *
 * The assertions marked `v2 guard` pin the codes a `v2` parse gives the same
 * text: a windowed form must stay a `v2` refusal with its `v2` code.
 */
export function runParserWindowTests(): void {
  const kindsOf = (result: Extract<ParseResult, { ok: true }>): string => result.windowReads.map((r) => r.kind).join(",");

  // ---- v2 guard: the same text under v2 -----------------------------------------

  expectFailCode("sum({kw}, today)", "scope_required", "v2 guard: a windowed sum is scope_required under v2", V2);
  expectFailCode("delta({kwh}, today)", "unexpected_token", "v2 guard: delta(…, today) is an unexpected token under v2", V2);
  expectFailCode("hours(today)", "unexpected_token", "v2 guard: hours(today) is an unexpected token under v2", V2);
  expectFailCode("min({kw}, 24h)", "malformed_number", "v2 guard: 24h is a malformed number under v2", V2);
  const v2Aggregate = expectOk("sum({kw} @site)", V2);
  const v3Aggregate = expectOk("sum({kw} @site)", V3);
  assert(
    JSON.stringify(v2Aggregate.ast) === JSON.stringify(v3Aggregate.ast),
    "a v2 scope aggregate has the same AST under v3",
  );
  assert(v2Aggregate.windowReads.length === 0 && v3Aggregate.windowReads.length === 0, "an aggregate is not a window read");
  const v2Result = expectOk("{kw} * 2", V2);
  assert(Array.isArray(v2Result.windowReads) && v2Result.windowReads.length === 0, "windowReads is [] under v2");

  // ---- sum / avg: the window form, told from the aggregate by the comma ----------

  const sum = expectOk("sum({kw}, 24h)", V3);
  assert(sum.ast.kind === "window", `sum({kw}, 24h) parses to a window node, got ${sum.ast.kind}`);
  if (sum.ast.kind === "window") {
    assert(sum.ast.fn === "sum", `fn is sum, got ${sum.ast.fn}`);
    assert(sum.ast.ref.kind === "ref" && sum.ast.ref.pointKey === "kw", `ref is the local {kw}, got ${JSON.stringify(sum.ast.ref)}`);
    assert(
      sum.ast.window.kind === "rolling" && sum.ast.window.minutes === 1440,
      `the window is rolling 1440 minutes, got ${JSON.stringify(sum.ast.window)}`,
    );
    assert(sum.ast.position === 0, `a window node's position is the function name, got ${sum.ast.position}`);
    assert(
      Object.keys(sum.ast).sort().join(",") === "fn,kind,position,ref,window",
      `a window node carries fn, kind, position, ref and window only, got ${Object.keys(sum.ast).join(",")}`,
    );
  }
  assert(sum.refs.join("|") === "kw", `the point inside a window joins refs, got ${JSON.stringify(sum.refs)}`);
  assert(sum.crossRefs.length === 0, "a local window read is not a cross ref");
  assert(sum.paramRefs.length === 0, "a window is not a parameter");
  assert(sum.windowReads.length === 1 && kindsOf(sum) === "window", `one window read, got ${JSON.stringify(sum.windowReads)}`);

  const avgQualified = expectOk("avg({TX_01.kw}, 7d)", V3);
  assert(avgQualified.ast.kind === "window" && avgQualified.ast.ref.kind === "qref", "a qualified point inside a window is a qref");
  assert(avgQualified.crossRefs.length === 1 && avgQualified.crossRefs[0].kind === "qref", "the qualified point joins crossRefs");
  assert(avgQualified.refs.length === 0, "a qualified point is not a local ref");

  // ---- min / max: the window form, told from the n-ary scalar by the second argument ----------

  const min = expectOk("min({kw}, 24h)", V3);
  assert(min.ast.kind === "window" && min.ast.fn === "min", `min({kw}, 24h) is a window node, got ${min.ast.kind}`);
  const minScalar = expectOk("min({kw}, 1)", V3);
  assert(minScalar.ast.kind === "call" && minScalar.ast.fn === "min", `min({kw}, 1) stays a call, got ${minScalar.ast.kind}`);
  const maxThree = expectOk("max({a}, {b}, 3)", V3);
  assert(maxThree.ast.kind === "call" && maxThree.ast.args.length === 3, "the n-ary max is unchanged");
  const needsRef = expectFailCode("min({kw} + 1, 24h)", "window_needs_point_reference", "an expression before a window is refused", V3);
  assert(needsRef.position === 0, `window_needs_point_reference is reported at the function name, got ${needsRef.position}`);
  expectFailCode("max(1, today)", "window_needs_point_reference", "a number before a window is refused", V3);
  expectFailCode("min({a}, {b}, 24h)", "window_needs_point_reference", "two points before a window is not the window form", V3);

  // ---- delta and hours: v3 only, never in CALC_FUNCTION_ARITY -------------------------

  const delta = expectOk("delta({kwh}, this_month)", V3);
  assert(delta.ast.kind === "window" && delta.ast.fn === "delta", "delta is a window node");
  if (delta.ast.kind === "window") {
    assert(
      delta.ast.window.kind === "calendar" && delta.ast.window.period === "this_month",
      `a calendar window carries its period, got ${JSON.stringify(delta.ast.window)}`,
    );
  }
  const deltaNoWindow = expectFailCode("delta({kwh})", "window_required", "delta without a window is refused", V3);
  assert(deltaNoWindow.position === 11, `window_required is reported at the token found instead, got ${deltaNoWindow.position}`);
  expectFailCode("delta({kwh}, 1)", "window_required", "a number is not a window", V3);
  expectFailCode("delta(1, 2)", "window_needs_point_reference", "delta needs a point reference first", V3);
  expectFailCode("delta({kwh}, today", "unexpected_end", "a truncated window call is unexpected_end", V3);
  expectFailCode("delta", "unexpected_end", "a bare delta is unexpected_end", V3);
  assert(!("delta" in CALC_FUNCTION_ARITY) && !("hours" in CALC_FUNCTION_ARITY), "delta and hours are not v1 functions");

  const hours = expectOk("hours(today)", V3);
  assert(hours.ast.kind === "hours", `hours(today) is an hours node, got ${hours.ast.kind}`);
  if (hours.ast.kind === "hours") {
    assert(hours.ast.window.kind === "calendar" && hours.ast.window.period === "today", "hours carries its window");
    assert(hours.ast.position === 0, "an hours node's position is the function name");
    assert(
      Object.keys(hours.ast).sort().join(",") === "kind,position,window",
      `an hours node carries kind, position and window only, got ${Object.keys(hours.ast).join(",")}`,
    );
  }
  assert(hours.refs.length === 0 && hours.windowReads.length === 1 && kindsOf(hours) === "hours", "hours is a window read with no point");
  expectFailCode("hours({kw}, today)", "window_required", "hours takes no point reference", V3);
  expectFailCode("hours(1)", "window_required", "hours(1) is not a window", V3);
  expectFailCode("hours()", "window_required", "hours() is missing its window", V3);
  expectFailCode("hours(today, 24h)", "unexpected_token", "hours takes exactly one window", V3);
  const rollingHours = expectOk("hours(24h)", V3);
  assert(rollingHours.ast.kind === "hours" && rollingHours.ast.window.kind === "rolling", "hours over a rolling window parses");

  // ---- a window wraps one point reference, never a scope aggregate (ruling 4) ---------

  const overAggregate = expectFailCode("sum({kw} @site, 24h)", "window_over_aggregate", "a window over a scope aggregate is refused", V3);
  assert(overAggregate.position === 14, `window_over_aggregate is reported at the comma, got ${overAggregate.position}`);
  expectFailCode("avg({kw} @group('IT'), today)", "window_over_aggregate", "…whatever the scope", V3);

  // ---- a window token anywhere else ----------------------------------------------------

  const stray = expectFailCode("today + 1", "window_not_allowed", "a bare window is refused", V3);
  assert(stray.position === 0, `window_not_allowed is at the window, got ${stray.position}`);
  expectFailCode("abs(24h)", "window_not_allowed", "a window inside a scalar function is refused", V3);
  expectFailCode("{kw} * 24h", "window_not_allowed", "a window as an operand is refused", V3);
  expectFailCode("1 today", "window_not_allowed", "a trailing window is refused", V3);
  expectFailCode("sum({kw}, 24h, 1)", "unexpected_token", "a third argument to a window function is refused", V3);

  // ---- the literal's amount and cap are the parser's ---------------------------------------

  const tooLong = expectFailCode("avg({kw}, 367d)", "window_too_long", "over 366d is refused", V3);
  assert(tooLong.position === 10, `window_too_long is at the literal, got ${tooLong.position}`);
  expectOk("avg({kw}, 366d)", V3);
  expectOk("avg({kw}, 8784h)", V3);
  expectFailCode("avg({kw}, 8785h)", "window_too_long", "the cap counts in minutes, whatever the unit", V3);
  const zero = expectFailCode("avg({kw}, 0h)", "malformed_window", "a zero window is refused", V3);
  assert(zero.position === 10, `malformed_window is at the literal, got ${zero.position}`);
  expectFailCode("hours(0d)", "malformed_window", "a zero window inside hours is refused", V3);

  // ---- windowReads: deduped by windowKey, bounded by MAX_FORMULA_WINDOWS ------------------------

  const deduped = expectOk("avg({kw}, 24h) - avg({kw}, 1440m) + hours(today) + hours(today)", V3);
  assert(
    deduped.windowReads.length === 2,
    `24h and 1440m over the same point are one read and hours(today) twice is one, got ${deduped.windowReads.map(windowKey).join(" | ")}`,
  );
  assert(
    deduped.windowReads.map(windowKey).join(" | ") === "avg({kw}, 1440m) | hours(today)",
    `windowReads is in first-appearance order by canonical key, got ${deduped.windowReads.map(windowKey).join(" | ")}`,
  );
  const distinct = expectOk("avg({kw}, 24h) + avg({kw}, 7d) + avg({kw}, today) + max({kw}, 24h)", V3);
  assert(distinct.windowReads.length === 4, "a different window or function is a different read");

  const eightReads = Array.from({ length: MAX_FORMULA_WINDOWS }, (_, i) => `avg({kw}, ${i + 1}h)`).join(" + ");
  expectOk(eightReads, V3);
  const nineReads = `${eightReads} + avg({kw}, 99h)`;
  const overflow = expectFailCode(nineReads, "too_many_windows", "a ninth distinct read is refused", V3);
  assert(
    overflow.position === eightReads.length + 3,
    `too_many_windows is at the ninth read's function name, got ${overflow.position}`,
  );
  const eightRepeated = `${eightReads} + avg({kw}, 60m)`;
  expectOk(eightRepeated, V3);

  // ---- every error message is free of source text ---------------------------------------------

  const codes: CalcErrorCode[] = [
    "malformed_window",
    "window_too_long",
    "window_required",
    "window_needs_point_reference",
    "window_over_aggregate",
    "window_not_allowed",
    "too_many_windows",
  ];
  for (const code of codes) {
    const text = formatCalcError({ code, position: 3 });
    assert(text.length > 20 && text.endsWith(" at character 3"), `${code} renders a sentence and the position, got ${text}`);
    assert(!text.includes("$"), `${code}'s message carries no source-shaped text`);
  }
  assert(formatCalcError({ code: "window_too_long", position: 0 }).includes("366d"), "the cap's message names 366d");
  assert(formatCalcError({ code: "too_many_windows", position: 0 }).includes(String(MAX_FORMULA_WINDOWS)), "the bound's message names the number");
  assert(
    formatCalcError({ code: "window_over_aggregate", position: 0 }).includes("@site"),
    "window_over_aggregate names the two-layer alternative",
  );

  // ---- purity: the same text parses to the same result twice --------------------------------------

  const once = parseFormula("delta({kwh}, today) / hours(today)", V3);
  const twice = parseFormula("delta({kwh}, today) / hours(today)", V3);
  assert(JSON.stringify(once) === JSON.stringify(twice), "parseFormula is pure");
}

/**
 * Design decision 7's load-bearing case, in its own `it()` so the mutation
 * that skips `node.ref` in `collectRefEntries` reddens THIS assertion and not
 * only the `refs` one above it (`assert` throws, so only the first claim in a
 * block ever reddens).
 */
export function runWindowValidateTests(): void {
  const known = validateFormula("delta({kwh}, today)", ["kwh"], V3);
  assert(known.ok === true, `a known point inside a window validates, got ${JSON.stringify(known)}`);
  const unknown = validateFormula("delta({kwh}, today)", ["kw"], V3);
  assert(unknown.ok === false && unknown.errors[0].code === "unknown_reference", "an unknown point inside a window is unknown_reference");
  if (!unknown.ok) {
    assert(unknown.errors[0].position === 6, `unknown_reference is at the {, got ${unknown.errors[0].position}`);
  }
  const qualifiedUnchecked = validateFormula("avg({TX_01.kw}, 24h)", [], V3);
  assert(qualifiedUnchecked.ok === true, "a qualified point inside a window is not checked by name here (the api host does)");
}
