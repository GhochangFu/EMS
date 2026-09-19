import { tokenize, CalcTokenizeError } from "./tokenizer";
import { CALC_DIALECT_V2, CALC_DIALECT_V3, type CalcDialect } from "./limits";
import type { CalcErrorCode } from "./ast";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The `v2` option, spelled once. Every call without it is a `v1` call. */
const V2 = { dialect: CALC_DIALECT_V2 } as const;
/** The `v3` option, spelled once (ADR 0070). */
const V3 = { dialect: CALC_DIALECT_V3 } as const;

function expectFailCode(
  expression: string,
  code: CalcErrorCode,
  message: string,
  options?: { dialect?: CalcDialect },
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

function failurePosition(expression: string, options?: { dialect?: CalcDialect }): number {
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

/**
 * The `v3` half (ADR 0070 decisions 3 and 4). One added production: `$key`
 * lexes as a `param` token whose `text` is the key **without** the `$` and
 * whose `position` is the `$`. Everything `v2` lexes, `v3` lexes the same way
 * — the `v2` loop is untouched, exactly as the `v1` loop was by `v2`. The
 * assertions marked `v2 guard` are the ones a `v3` production would break if
 * it leaked past its dialect check: `$` must stay an unexpected character
 * under `v1` and under `v2`.
 */
export function runTokenizerV3Tests(): void {
  // ---- v2 guard: `$` is still unexpected under v1 and v2 ----------------------

  expectFailCode("$x", "unexpected_character", "v2 guard: $ must stay unexpected under v1");
  assert(failurePosition("$x") === 0, "v2 guard: the v1 refusal is at the $");
  expectFailCode("$x", "unexpected_character", "v2 guard: $ must stay unexpected under v2", V2);
  assert(failurePosition("$x", V2) === 0, "v2 guard: the v2 refusal is at the $");

  // ---- param ------------------------------------------------------------------

  const tariff = tokenize("{kw} * $energy_tariff_per_kwh", V3);
  assert(
    tariff.map((t) => t.kind).join(",") === "ref,star,param,eof",
    `{kw} * $energy_tariff_per_kwh under v3, got ${tariff.map((t) => t.kind).join(",")}`,
  );
  assert(
    tariff[2].text === "energy_tariff_per_kwh",
    `param text is the key without the $, got ${JSON.stringify(tariff[2].text)}`,
  );
  assert(tariff[2].position === 7, `param position is the $, got ${tariff[2].position}`);
  assert(tariff[2].assetCode === undefined && tariff[2].numberValue === undefined, "a param carries only kind, position and text");

  expectFailCode("$", "malformed_parameter_reference", "a bare $ names no key and must fail", V3);
  expectFailCode("$1", "malformed_parameter_reference", "a key may not start with a digit", V3);
  expectFailCode("$ x", "malformed_parameter_reference", "a space between $ and the key is not a reference", V3);
  assert(failurePosition("2 + $", V3) === 4, "malformed_parameter_reference reports the position of the $");

  // `$a-b` must mean `$a - b`: the reason a key may never contain `-`
  // (plan design decision 5, ruling Q1)
  const minus = tokenize("$a-b", V3);
  assert(
    minus.map((t) => t.kind).join(",") === "param,minus,ident,eof",
    `$a-b lexes as $a - b, got ${minus.map((t) => t.kind).join(",")}`,
  );
  assert(minus[0].text === "a" && minus[2].text === "b", "the key stops at the -");

  // ---- everything v2 lexes, v3 lexes the same way ------------------------------

  const v2Expression = "sum({TX_01.kw} @group('IT_LOAD')) * {a-b/c d}";
  const underV2 = tokenize(v2Expression, V2);
  const underV3 = tokenize(v2Expression, V3);
  assert(
    JSON.stringify(underV2) === JSON.stringify(underV3),
    `a v2 expression must lex identically under v3: ${JSON.stringify(underV3)}`,
  );
  const mixed = tokenize("sum({kw} @site) * $f", V3);
  assert(
    mixed.map((t) => t.kind).join(",") === "ident,lparen,ref,scope,rparen,star,param,eof",
    `a v2 production beside a param under v3, got ${mixed.map((t) => t.kind).join(",")}`,
  );

  // the `v2` refusals are unchanged under v3
  expectFailCode("@foo", "unknown_scope", "an unknown scope must still fail under v3", V3);
  expectFailCode("''", "empty_string", "an empty string must still fail under v3", V3);
  expectFailCode("{.kw}", "malformed_qualified_reference", "an empty asset code must still fail under v3", V3);
  expectFailCode("2 # 3", "unexpected_character", "an unknown character still fails under v3", V3);

  // ---- a CalcParseError still carries only code + position ----------------------

  try {
    tokenize("$", V3);
    throw new Error("expected tokenize to fail");
  } catch (error) {
    if (error instanceof CalcTokenizeError) {
      assert(
        Object.keys(error.parseError).sort().join(",") === "code,position",
        `malformed_parameter_reference must carry only code and position, got keys: ${Object.keys(error.parseError).join(",")}`,
      );
    }
  }
}

/**
 * The `v3` window half (ADR 0070 decision 5; `E4.1b` plan design decision 2).
 * One added token kind, `window`, produced by two productions that both sit
 * behind the window-dialect guard: an integer literal glued to one of `m|h|d`
 * (`24h`, `7d`, `15m`) and one of the four calendar words (`today`,
 * `this_week`, `this_month`, `this_year`). `text` is the literal as written
 * and `position` its first character. The lexer decides the *shape* only —
 * `0h` and `1440m` and `9999d` all lex as `window`; the cap and the zero are
 * the parser's (`window_too_long`, `malformed_window`).
 *
 * The assertions marked `v2 guard` are the ones a leaked production would
 * break: under `v1` and `v2`, `24h` must stay a `malformed_number` (the
 * glued-suffix rule that already exists) and `today` an ordinary `ident`.
 */
export function runTokenizerWindowTests(): void {
  const kinds = (expression: string, options?: { dialect?: CalcDialect }): string =>
    tokenize(expression, options).map((t) => t.kind).join(",");

  // ---- v2 guard: byte-identical under v1 and v2 --------------------------------

  expectFailCode("24h", "malformed_number", "v2 guard: 24h is a malformed number under v1");
  assert(failurePosition("24h") === 0, "v2 guard: the v1 refusal is at the digit");
  expectFailCode("24h", "malformed_number", "v2 guard: 24h is a malformed number under v2", V2);
  assert(failurePosition("24h", V2) === 0, "v2 guard: the v2 refusal is at the digit");
  assert(kinds("today") === "ident,eof", `v2 guard: today is an ident under v1, got ${kinds("today")}`);
  assert(kinds("today", V2) === "ident,eof", `v2 guard: today is an ident under v2, got ${kinds("today", V2)}`);
  assert(kinds("this_month", V2) === "ident,eof", "v2 guard: this_month is an ident under v2");

  // ---- rolling: an integer glued to m|h|d --------------------------------------

  const rolling = tokenize("sum({kw}, 24h)", V3);
  assert(
    rolling.map((t) => t.kind).join(",") === "ident,lparen,ref,comma,window,rparen,eof",
    `sum({kw}, 24h) under v3, got ${rolling.map((t) => t.kind).join(",")}`,
  );
  assert(rolling[4].text === "24h", `a rolling window's text is the literal as written, got ${JSON.stringify(rolling[4].text)}`);
  assert(rolling[4].position === 10, `a rolling window's position is its first digit, got ${rolling[4].position}`);
  assert(
    rolling[4].numberValue === undefined && rolling[4].assetCode === undefined,
    "a window carries only kind, position and text",
  );
  assert(kinds("1440m", V3) === "window,eof", "1440m lexes as a window");
  assert(kinds("7d", V3) === "window,eof", "7d lexes as a window");
  assert(kinds("0h", V3) === "window,eof", "0h lexes as a window — the zero is the parser's to refuse");
  assert(kinds("367d", V3) === "window,eof", "367d lexes as a window — the cap is the parser's to refuse");

  // the shape is exact: a trailing identifier character, a fraction or a
  // space breaks it, and the existing v1 rules take over unchanged
  expectFailCode("24hx", "malformed_number", "24hx is a glued suffix, not a window", V3);
  expectFailCode("24.5h", "malformed_number", "a fraction is never a window", V3);
  expectFailCode("24s", "malformed_number", "s is not a window unit", V3);
  expectFailCode("24H", "malformed_number", "units are lowercase", V3);
  assert(kinds("24 h", V3) === "number,ident,eof", `a space splits 24 h into a number and an ident, got ${kinds("24 h", V3)}`);
  assert(kinds("24", V3) === "number,eof", "a bare integer is still a number under v3");
  assert(kinds("24h+1", V3) === "window,plus,number,eof", `24h+1 lexes as window, plus, number — got ${kinds("24h+1", V3)}`);
  assert(kinds("(24h)", V3) === "lparen,window,rparen,eof", "a window inside parentheses");

  // ---- calendar: the four reserved words -----------------------------------------

  const calendar = tokenize("delta({kwh}, today)", V3);
  assert(
    calendar.map((t) => t.kind).join(",") === "ident,lparen,ref,comma,window,rparen,eof",
    `delta({kwh}, today) under v3, got ${calendar.map((t) => t.kind).join(",")}`,
  );
  assert(calendar[4].text === "today" && calendar[4].position === 13, "a calendar window's text and position");
  assert(kinds("this_week", V3) === "window,eof", "this_week is a window");
  assert(kinds("this_month", V3) === "window,eof", "this_month is a window");
  assert(kinds("this_year", V3) === "window,eof", "this_year is a window");
  assert(kinds("hours(today)", V3) === "ident,lparen,window,rparen,eof", "hours(today): the helper is an ident, its argument a window");

  // the word must be whole and exact — `todays`, `Today` and `this_months`
  // are ordinary identifiers, and `{today}` is a point reference whose text
  // is `today` (the `{…}` branch never consults the word list)
  assert(kinds("todays", V3) === "ident,eof", "todays is an ident");
  assert(kinds("Today", V3) === "ident,eof", "Today is an ident — the words are lowercase");
  assert(kinds("this_months", V3) === "ident,eof", "this_months is an ident");
  const braced = tokenize("{today}", V3);
  assert(braced[0].kind === "ref" && braced[0].text === "today", `{today} is a ref with text today, got ${JSON.stringify(braced[0])}`);

  // ---- everything v2 lexes, v3 lexes the same way (window edition) ---------------

  const v2Expression = "sum({TX_01.kw} @group('IT_LOAD')) * {a-b/c d} + 24 * 7";
  assert(
    JSON.stringify(tokenize(v2Expression, V2)) === JSON.stringify(tokenize(v2Expression, V3)),
    "a v2 expression with bare integers must lex identically under v3",
  );
  const mixed = tokenize("avg({TX_01.kw}, 7d) * $f", V3);
  assert(
    mixed.map((t) => t.kind).join(",") === "ident,lparen,ref,comma,window,rparen,star,param,eof",
    `a qualified ref, a window and a param together, got ${mixed.map((t) => t.kind).join(",")}`,
  );
}
