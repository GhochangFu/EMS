import { tokenize, CalcTokenizeError } from "./tokenizer";
import { CALC_DIALECT_V2 } from "./limits";
import type { CalcErrorCode } from "./ast";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The `v2` option, spelled once. Every call without it is a `v1` call. */
const V2 = { dialect: CALC_DIALECT_V2 } as const;

function expectFailCode(
  expression: string,
  code: CalcErrorCode,
  message: string,
  options?: { dialect?: typeof CALC_DIALECT_V2 },
): void {
  try {
    tokenize(expression, options);
    throw new Error(`expected tokenize(${JSON.stringify(expression)}) to fail: ${message}`);
  } catch (error) {
    assert(error instanceof CalcTokenizeError, message);
    if (error instanceof CalcTokenizeError) {
      assert(
        error.parseError.code === code,
        `${message} — expected code ${code}, got ${error.parseError.code}`,
      );
    }
  }
}

/**
 * The `v1` half. Every call here passes no dialect, and every assertion must
 * stay green byte-for-byte after `bms-calc-v2` (ADR 0055 decision 4 — `v2` is
 * a strict superset, and decision 3 — `v1` keeps its meaning forever). The
 * two assertions marked `v1 guard` are the ones a `v2` production would break
 * if it leaked past its dialect check: `@` must stay an unexpected character,
 * and a `.` inside braces must stay part of the point key.
 */
export function runTokenizerTests(): void {
  // ---- operators, numbers, whitespace --------------------------------------

  const arithmetic = tokenize("2 + 3 * 4");
  assert(
    arithmetic.map((t) => t.kind).join(",") === "number,plus,number,star,number,eof",
    `unexpected token kinds: ${arithmetic.map((t) => t.kind).join(",")}`,
  );
  assert(arithmetic[0].position === 0, "first number token should be at position 0");
  assert(arithmetic[1].position === 2, `plus token should be at position 2, got ${arithmetic[1].position}`);
  assert(arithmetic[3].position === 6, `star token should be at position 6, got ${arithmetic[3].position}`);

  // whitespace between tokens is skipped and never shifts a reported position
  const tabbed = tokenize("2\t+\n3");
  assert(tabbed[1].position === 2, "whitespace between tokens must not shift positions");

  // ---- point references -----------------------------------------------------

  const ref = tokenize("{SUB_METER_1_KWH}");
  assert(ref.length === 2, `expected one ref token + eof, got ${ref.length}`);
  assert(ref[0].kind === "ref", `expected a ref token, got ${ref[0].kind}`);
  assert(ref[0].text === "SUB_METER_1_KWH", `ref text should be exact, got ${JSON.stringify(ref[0].text)}`);
  assert(ref[0].position === 0, "ref token position should be at the opening brace");

  // point keys are unconstrained strings (asset-templates.schema.ts pointKeyCode)
  const weirdKey = tokenize("{a.b-c/d e}");
  assert(weirdKey[0].kind === "ref", "a point key with ./-/space must still tokenize as one ref");
  assert(
    weirdKey[0].text === "a.b-c/d e",
    `weird point key should tokenize intact, got ${JSON.stringify(weirdKey[0].text)}`,
  );
  // v1 guard: the `v2` qualified split (`{CODE.key}`) must not reach a `v1`
  // call — the `.` stays inside the key and no asset code is produced
  assert(
    weirdKey[0].assetCode === undefined,
    `a v1 ref must carry no assetCode, got ${JSON.stringify(weirdKey[0].assetCode)}`,
  );

  expectFailCode("{UNCLOSED", "unterminated_reference", "unclosed brace must fail");
  expectFailCode("{A{B}", "unterminated_reference", "a nested { must fail, not nest");
  expectFailCode("{}", "empty_reference", "an empty reference must fail");

  // ---- numbers ----------------------------------------------------------------

  const decimal = tokenize("1.5");
  assert(decimal[0].kind === "number" && decimal[0].numberValue === 1.5, "1.5 should tokenize as 1.5");

  expectFailCode("1.", "malformed_number", "a trailing dot with no digits must fail");
  expectFailCode(".5", "malformed_number", "a leading dot with no leading digit must fail");
  expectFailCode("1e3", "malformed_number", "the exponent form is out of grammar");

  // a long enough digit run overflows to Infinity — CalcNumber.value: number
  // promises a real number to every consumer of the AST, so this must be
  // caught lexically rather than silently producing a non-finite literal
  expectFailCode("9".repeat(400), "malformed_number", "a digit run overflowing to Infinity must fail");

  // ---- unary minus is not part of the number literal ---------------------------

  const negative = tokenize("-5");
  assert(
    negative.map((t) => t.kind).join(",") === "minus,number,eof",
    `-5 must tokenize as an operator then an unsigned number, got ${negative.map((t) => t.kind).join(",")}`,
  );
  assert(negative[1].numberValue === 5, "the number token after unary minus must be unsigned");

  // ---- unknown characters -------------------------------------------------------

  expectFailCode("2 $ 3", "unexpected_character", "an unknown character must fail");
  // v1 guard: `@` and `'` are `v2` glyphs and must stay out of grammar here
  expectFailCode("2 @ 3", "unexpected_character", "v1 guard: `@` must stay an unexpected character under v1");
  expectFailCode("'IT_LOAD'", "unexpected_character", "v1 guard: a quote must stay an unexpected character under v1");
  try {
    tokenize("2 $ 3");
  } catch (error) {
    assert(error instanceof CalcTokenizeError, "expected a CalcTokenizeError");
    if (error instanceof CalcTokenizeError) {
      assert(
        error.parseError.position === 2,
        `unexpected character should report its own position, got ${error.parseError.position}`,
      );
    }
  }

  // ---- a CalcParseError structurally carries only code + position ------------------
  //
  // No source text, no point key, no function name — checked at the shape level
  // rather than through a rendered message so this spec has no dependency on
  // ./parser (formatCalcError), keeping the tokenizer and parser commits each
  // independently green.

  try {
    tokenize("2 $ 3");
    throw new Error("expected tokenize to fail");
  } catch (error) {
    if (error instanceof CalcTokenizeError) {
      assert(
        Object.keys(error.parseError).sort().join(",") === "code,position",
        `a CalcParseError must carry only code and position, got keys: ${Object.keys(error.parseError).join(",")}`,
      );
    }
  }
}

function failurePosition(expression: string, options?: { dialect?: typeof CALC_DIALECT_V2 }): number {
  try {
    tokenize(expression, options);
  } catch (error) {
    if (error instanceof CalcTokenizeError) {
      return error.parseError.position;
    }
  }
  throw new Error(`expected tokenize(${JSON.stringify(expression)}) to throw a CalcTokenizeError`);
}

/**
 * The `v2` half (ADR 0055 decisions 1, 2 and 4). Three added productions:
 * `@site` / `@domain` / `@group` lex as one `scope` token whose `text` keeps
 * the `@`; `'…'` lexes as a `string` token whose `text` drops the quotes; and
 * a first `.` inside `{…}` splits the reference into `assetCode` and the point
 * key. Everything `v1` lexes, `v2` lexes the same way — asserted on a key that
 * uses every legal `v1` character except `.` (design decision 10, ruling Q1).
 */
export function runTokenizerV2Tests(): void {
  // ---- scope ------------------------------------------------------------------

  const aggregate = tokenize("sum({kw} @site)", V2);
  assert(
    aggregate.map((t) => t.kind).join(",") === "ident,lparen,ref,scope,rparen,eof",
    `sum({kw} @site) under v2, got ${aggregate.map((t) => t.kind).join(",")}`,
  );
  assert(aggregate[3].text === "@site", `scope text keeps the @, got ${JSON.stringify(aggregate[3].text)}`);
  assert(aggregate[3].position === 9, `scope position should be 9, got ${aggregate[3].position}`);
  assert(aggregate[2].assetCode === undefined, "an unqualified ref under v2 carries no assetCode");

  for (const name of ["site", "domain", "group"]) {
    const [scope] = tokenize(`@${name}`, V2);
    assert(scope.kind === "scope" && scope.text === `@${name}`, `@${name} must lex as one scope token`);
  }

  expectFailCode("@foo", "unknown_scope", "an unknown scope name must fail", V2);
  expectFailCode("@", "unknown_scope", "a bare @ names no scope and must fail", V2);
  expectFailCode("@ site", "unknown_scope", "a space between @ and the name is not a scope", V2);
  expectFailCode("@Site", "unknown_scope", "scope names are case-sensitive", V2);
  assert(failurePosition("2 + @foo", V2) === 4, "unknown_scope reports the position of the @");

  // ---- string -----------------------------------------------------------------

  const group = tokenize("@group('IT_LOAD')", V2);
  assert(
    group.map((t) => t.kind).join(",") === "scope,lparen,string,rparen,eof",
    `@group('IT_LOAD') under v2, got ${group.map((t) => t.kind).join(",")}`,
  );
  assert(group[2].text === "IT_LOAD", `string text drops the quotes, got ${JSON.stringify(group[2].text)}`);
  assert(group[2].position === 7, `string position is the opening quote, got ${group[2].position}`);

  expectFailCode("'IT", "unterminated_string", "an unclosed quote must fail", V2);
  expectFailCode("''", "empty_string", "an empty string must fail", V2);
  assert(failurePosition("1 + 'IT", V2) === 4, "unterminated_string reports the opening quote");
  assert(failurePosition("1 + ''", V2) === 4, "empty_string reports the opening quote");

  // ---- qualified reference ----------------------------------------------------

  const qualified = tokenize("{TX_01.kwh}", V2);
  assert(qualified.length === 2, `expected one ref token + eof, got ${qualified.length}`);
  assert(qualified[0].kind === "ref", `a qualified reference is still a ref token, got ${qualified[0].kind}`);
  assert(qualified[0].assetCode === "TX_01", `assetCode should be TX_01, got ${JSON.stringify(qualified[0].assetCode)}`);
  assert(qualified[0].text === "kwh", `text should be the point key only, got ${JSON.stringify(qualified[0].text)}`);
  assert(qualified[0].position === 0, "a qualified ref's position is the opening brace");

  // the FIRST `.` splits; anything after it stays in the key (design decision 10)
  const twoDots = tokenize("{TX.a.b}", V2);
  assert(twoDots[0].assetCode === "TX" && twoDots[0].text === "a.b", "only the first . is the separator");

  expectFailCode("{.kw}", "malformed_qualified_reference", "an empty asset code must fail", V2);
  expectFailCode("{TX.}", "malformed_qualified_reference", "an empty point key after the code must fail", V2);
  expectFailCode("{.}", "malformed_qualified_reference", "a lone . inside braces must fail", V2);
  assert(
    failurePosition("1 + {.kw}", V2) === 4,
    "malformed_qualified_reference reports the opening brace",
  );

  // the `v1` refusals inside braces are unchanged under v2
  expectFailCode("{UNCLOSED", "unterminated_reference", "unclosed brace must still fail under v2", V2);
  expectFailCode("{}", "empty_reference", "an empty reference must still fail under v2", V2);

  // ---- everything v1 lexes, v2 lexes the same way (keys without a `.`) -----

  const v1Key = "{a-b/c d}";
  const underV1 = tokenize(v1Key);
  const underV2 = tokenize(v1Key, V2);
  assert(
    JSON.stringify(underV1) === JSON.stringify(underV2),
    `a v1 key with -, / and space must lex identically under both dialects: ${JSON.stringify(underV2)}`,
  );
  assert(underV2[0].assetCode === undefined, "no . means no assetCode under v2 either");
  expectFailCode("2 $ 3", "unexpected_character", "an unknown character still fails under v2", V2);

  // ---- a CalcParseError still carries only code + position ----------------------

  try {
    tokenize("@foo", V2);
    throw new Error("expected tokenize to fail");
  } catch (error) {
    if (error instanceof CalcTokenizeError) {
      assert(
        Object.keys(error.parseError).sort().join(",") === "code,position",
        `unknown_scope must carry only code and position, got keys: ${Object.keys(error.parseError).join(",")}`,
      );
    }
  }
}
