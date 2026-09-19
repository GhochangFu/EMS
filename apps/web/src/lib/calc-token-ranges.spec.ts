/**
 * Token-to-range mapping for both calc dialects (`F2.5` ADR 0038 for the
 * module; `F2.9` ADR 0055 for the `v2` widths).
 *
 * `calc-token-ranges.ts` owns two facts about the tokenizer that two modules
 * depend on: that a `ref` token's `text` excludes its braces, and (since `v2`)
 * that a `string` token's `text` excludes its quotes and a qualified `ref`'s
 * `text` excludes both the braces and its `assetCode.` prefix. Every `to`
 * below is a literal read off a red first run, never recomputed here from the
 * derivation the module uses.
 */
import { CALC_DIALECT_V2, CALC_DIALECT_V3, tokenize } from "@bms/shared";

import { safeTokenize, tokenRange } from "./calc-token-ranges";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Case 1 — a `v1` ref keeps its width; nothing here moved for `v1`. */
export function runV1RefRangeTests(): void {
  const text = "{A}";
  const [ref] = tokenize(text);
  const range = tokenRange(text, ref);
  assert(range.from === 0 && range.to === 3, `v1 {A} must span 0..3, got ${range.from}..${range.to}`);
}

/** Case 2 — a qualified ref's range covers the braces AND the `CODE.` prefix. */
export function runQualifiedRefRangeTests(): void {
  const text = "{TX_01.kwh}";
  const [ref] = tokenize(text, { dialect: CALC_DIALECT_V2 });
  assert(ref.kind === "ref" && ref.assetCode === "TX_01", "sanity: the token must be a qualified ref");
  const range = tokenRange(text, ref);
  assert(range.from === 0 && range.to === 11, `{TX_01.kwh} must span 0..11, got ${range.from}..${range.to}`);
  assert(text.slice(range.from, range.to) === text, "the range must cover the whole reference");
}

/** Case 3 — a string's range covers its quotes; a scope's range is its text. */
export function runStringAndScopeRangeTests(): void {
  const string = "'IT_LOAD'";
  const [stringToken] = tokenize(string, { dialect: CALC_DIALECT_V2 });
  assert(stringToken.kind === "string", `sanity: expected a string token, got ${stringToken.kind}`);
  const stringRange = tokenRange(string, stringToken);
  assert(
    stringRange.from === 0 && stringRange.to === 9,
    `'IT_LOAD' at 0 must span 0..9, got ${stringRange.from}..${stringRange.to}`,
  );

  const aggregate = "sum({kw} @site)";
  const scopeToken = tokenize(aggregate, { dialect: CALC_DIALECT_V2 }).find((t) => t.kind === "scope");
  assert(scopeToken !== undefined, "sanity: expected a scope token");
  if (scopeToken) {
    const scopeRange = tokenRange(aggregate, scopeToken);
    assert(
      scopeRange.from === 9 && scopeRange.to === 14,
      `@site must span 9..14, got ${scopeRange.from}..${scopeRange.to}`,
    );
    assert(aggregate.slice(scopeRange.from, scopeRange.to) === "@site", "the scope range must cover `@site`");
  }
}

/**
 * Case 4 — `safeTokenize` threads the dialect, and defaults to `v1`.
 *
 * The keystroke path swallows a `CalcTokenizeError` into `[]`, so a dialect
 * that did not reach `tokenize` would show up as "nothing to highlight" rather
 * than as a thrown error — which is exactly the failure this case exists for.
 */
export function runSafeTokenizeDialectTests(): void {
  const text = "sum({kw} @site)";
  assert(safeTokenize(text).length === 0, "with no dialect the call is v1, and `@` does not lex under v1");
  const tokens = safeTokenize(text, CALC_DIALECT_V2);
  assert(
    tokens.map((t) => t.kind).join(",") === "ident,lparen,ref,scope,rparen,eof",
    `under v2 the same text lexes, got ${tokens.map((t) => t.kind).join(",")}`,
  );
}

/** Case 5 — a `param` token's range covers the `$` its `text` drops (ADR 0070). */
export function runParamRangeTests(): void {
  const text = "$energy";
  const [param] = tokenize(text, { dialect: CALC_DIALECT_V3 });
  assert(param.kind === "param", `sanity: expected a param token, got ${param.kind}`);
  const range = tokenRange(text, param);
  assert(range.from === 0 && range.to === 7, `$energy at 0 must span 0..7, got ${range.from}..${range.to}`);
  assert(text.slice(range.from, range.to) === "$energy", "the param range must cover the $ and the key");
}

/** Case 6 — a `window` token's range is the literal as written (ADR 0070, `E4.1b`). */
export function runWindowRangeTests(): void {
  const text = "delta({kwh}, today)";
  const tokens = tokenize(text, { dialect: CALC_DIALECT_V3 });
  const window = tokens[4];
  assert(window.kind === "window", `sanity: expected a window token at index 4, got ${window.kind}`);
  const range = tokenRange(text, window);
  assert(range.from === 13 && range.to === 18, `today at 13 must span 13..18, got ${range.from}..${range.to}`);
  assert(text.slice(range.from, range.to) === "today", "the window range must cover the word");

  const [rolling] = tokenize("1440m", { dialect: CALC_DIALECT_V3 });
  const rollingRange = tokenRange("1440m", rolling);
  assert(rollingRange.from === 0 && rollingRange.to === 5, `1440m must span 0..5, got ${rollingRange.from}..${rollingRange.to}`);
}
