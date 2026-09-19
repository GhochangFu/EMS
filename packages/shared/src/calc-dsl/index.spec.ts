import {
  CALC_DIALECT,
  CALC_DIALECT_V2,
  CALC_DIALECT_V3,
  CALC_DIALECTS,
  CalcTokenizeError,
  crossRefKey,
  isCrossAssetDialect,
  isParameterDialect,
  isWindowDialect,
  CALC_WINDOW_FNS,
  CALC_CALENDAR_WINDOWS,
  CALC_ROLLING_UNITS,
  MAX_FORMULA_PARAM_REFS,
  MAX_FORMULA_WINDOWS,
  MAX_ROLLING_WINDOW_DAYS,
  parseFormula,
  tokenize,
} from "./index";
import type { CalcCrossRef, CalcDialect, ParseOptions, Token, TokenKind } from "./index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Guards the calc-dsl barrel's *export surface*, not the tokenizer's behaviour
 * — `tokenizer.spec.ts` owns that. This file exists because `F2.5`'s formula
 * editor imports `tokenize` from `@bms/shared` to drive syntax highlighting
 * (ADR 0038 decision 6: reuse the existing tokenizer, no Lezer grammar), and
 * before `F2.5` the barrel re-exported only `./ast`, `./limits`, four parser
 * symbols and `evaluate`. A re-export that silently narrows is invisible to
 * every existing test, so it gets its own.
 */
export function runCalcDslBarrelTests(): void {
  // ---- 1. tokenize is reachable from the barrel -----------------------------

  assert(typeof tokenize === "function", `tokenize must be exported from the calc-dsl barrel, got ${typeof tokenize}`);

  // ---- 2. CalcTokenizeError is a VALUE, not just a type --------------------
  //
  // The editor catches it with `instanceof` — a partially-typed formula such
  // as "{A" throws on every keystroke and must not break the ViewPlugin. A
  // bare `export type CalcTokenizeError` would still typecheck at every call
  // site and still fail here, which is the whole point of this assertion.

  const thrown = new CalcTokenizeError({ code: "unterminated_reference", position: 0 });
  assert(thrown instanceof Error, "CalcTokenizeError must be exported as a value and extend Error");
  assert(
    thrown.parseError.code === "unterminated_reference",
    `CalcTokenizeError must carry its parseError, got ${thrown.parseError.code}`,
  );

  // ---- 3. the barrel's tokenize is the real one ----------------------------

  const tokens = tokenize("{A} + 1");
  const kinds = tokens.map((t) => t.kind).join(",");
  assert(kinds === "ref,plus,number,eof", `unexpected token kinds through the barrel: ${kinds}`);

  // Asserted here, not only in `tokenizer.spec.ts`, because `F2.5`'s
  // decoration math reads these two fields directly: a `ref` token's range is
  // `position` to `position + text.length + 2`, since `text` excludes the
  // braces. If either fact moved, the editor would highlight the wrong span.
  assert(tokens[0].position === 0, `ref token should start at 0, got ${tokens[0].position}`);
  assert(tokens[0].text === "A", `ref token text should exclude the braces, got ${JSON.stringify(tokens[0].text)}`);

  // ---- 4. Token and TokenKind are usable as types --------------------------
  //
  // Runtime-trivial by design. The real assertion is made by `tsc` at
  // `pnpm typecheck`: if the barrel stops exporting either type, these two
  // annotations stop compiling.

  const first: Token = tokens[0];
  const firstKind: TokenKind = first.kind;
  assert(firstKind === "ref", `expected the annotated TokenKind to be "ref", got ${firstKind}`);

  // ---- 5. the v2 dialect constants and the dialect option are reachable ------
  //
  // `F2.9` (ADR 0055): `CALC_DIALECT` is unchanged so every existing import
  // keeps compiling; `CALC_DIALECT_V2` and the `CALC_DIALECTS` tuple are the
  // additions, and `tokenize` takes `{ dialect }` through the barrel.

  assert(CALC_DIALECT === "bms-calc-v1", `CALC_DIALECT must stay bms-calc-v1, got ${CALC_DIALECT}`);
  assert(CALC_DIALECT_V2 === "bms-calc-v2", `CALC_DIALECT_V2 must be bms-calc-v2, got ${CALC_DIALECT_V2}`);
  // ADR 0070 (`E4.1a`): a third member, in superset order — the picker renders
  // the tuple as it is. `CALC_DIALECT` and `CALC_DIALECT_V2` are unchanged.
  assert(CALC_DIALECT_V3 === "bms-calc-v3", `CALC_DIALECT_V3 must be bms-calc-v3, got ${CALC_DIALECT_V3}`);
  assert(
    CALC_DIALECTS.length === 3 &&
      CALC_DIALECTS[0] === CALC_DIALECT &&
      CALC_DIALECTS[1] === CALC_DIALECT_V2 &&
      CALC_DIALECTS[2] === CALC_DIALECT_V3,
    `CALC_DIALECTS must be [v1, v2, v3] in that order, got ${JSON.stringify(CALC_DIALECTS)}`,
  );
  // The two predicates every dialect gate outside the grammar files reads
  // (plan design decision 14): a literal `=== CALC_DIALECT_V2` silently
  // excludes `v3`.
  assert(
    !isCrossAssetDialect(CALC_DIALECT) && isCrossAssetDialect(CALC_DIALECT_V2) && isCrossAssetDialect(CALC_DIALECT_V3),
    "isCrossAssetDialect is true for v2 and v3 only",
  );
  assert(
    !isParameterDialect(CALC_DIALECT) && !isParameterDialect(CALC_DIALECT_V2) && isParameterDialect(CALC_DIALECT_V3),
    "isParameterDialect is true for v3 only",
  );
  assert(MAX_FORMULA_PARAM_REFS === 8, `MAX_FORMULA_PARAM_REFS must be 8, got ${MAX_FORMULA_PARAM_REFS}`);
  // E4.1b (ADR 0070 decision 5; plan rulings Q1, Q6)
  assert(
    !isWindowDialect(CALC_DIALECT) && !isWindowDialect(CALC_DIALECT_V2) && isWindowDialect(CALC_DIALECT_V3),
    "isWindowDialect is true for v3 only",
  );
  assert(MAX_FORMULA_WINDOWS === 8, `MAX_FORMULA_WINDOWS must be 8 (ruling Q1), got ${MAX_FORMULA_WINDOWS}`);
  assert(MAX_ROLLING_WINDOW_DAYS === 366, `MAX_ROLLING_WINDOW_DAYS must be 366, got ${MAX_ROLLING_WINDOW_DAYS}`);
  assert(
    CALC_WINDOW_FNS.join(",") === "sum,avg,min,max,delta",
    `CALC_WINDOW_FNS must be the five functions in order, got ${JSON.stringify(CALC_WINDOW_FNS)}`,
  );
  assert(
    CALC_CALENDAR_WINDOWS.join(",") === "today,this_week,this_month,this_year",
    `CALC_CALENDAR_WINDOWS must be the four words in order, got ${JSON.stringify(CALC_CALENDAR_WINDOWS)}`,
  );
  assert(
    CALC_ROLLING_UNITS.m === 1 && CALC_ROLLING_UNITS.h === 60 && CALC_ROLLING_UNITS.d === 1440 && Object.keys(CALC_ROLLING_UNITS).length === 3,
    "CALC_ROLLING_UNITS is m/h/d in minutes",
  );
  const windowed = tokenize("delta({kwh}, today)", { dialect: CALC_DIALECT_V3 });
  assert(
    windowed[4].kind === "window" && windowed[4].text === "today",
    `tokenize(text, { dialect: v3 }) must reach the window lexer, got ${JSON.stringify(windowed[4])}`,
  );
  const v3 = tokenize("$f", { dialect: CALC_DIALECT_V3 });
  assert(
    v3[0].kind === "param" && v3[0].text === "f",
    `tokenize(text, { dialect: v3 }) must reach the v3 lexer, got ${JSON.stringify(v3[0])}`,
  );

  const dialect: CalcDialect = CALC_DIALECT_V2;
  const v2 = tokenize("{TX.kw} @site", { dialect });
  const v2Kinds = v2.map((t) => t.kind).join(",");
  assert(v2Kinds === "ref,scope,eof", `tokenize(text, { dialect }) must reach the v2 lexer, got ${v2Kinds}`);
  assert(v2[0].assetCode === "TX", `a qualified ref through the barrel must carry assetCode, got ${v2[0].assetCode}`);

  // ---- 6. crossRefKey and the parser's dialect option are reachable ----------
  //
  // `F2.9` Task 2: the api host (PR 2) builds `crossInputs` with `crossRefKey`
  // through the barrel — a key built any other way would never match the
  // evaluator's lookup, and nothing but this assertion would say so.

  assert(typeof crossRefKey === "function", `crossRefKey must be exported from the calc-dsl barrel, got ${typeof crossRefKey}`);
  const options: ParseOptions = { dialect: CALC_DIALECT_V2 };
  const parsed = parseFormula("sum({kw} @site)", options);
  assert(parsed.ok === true, `parseFormula(text, { dialect }) must reach the v2 parser, got ${JSON.stringify(parsed)}`);
  if (parsed.ok) {
    const first: CalcCrossRef | undefined = parsed.crossRefs[0];
    assert(
      first !== undefined && crossRefKey(first) === "a:sum(kw)@site",
      `the barrel's crossRefKey must build the canonical form, got ${first && crossRefKey(first)}`,
    );
  }
}
