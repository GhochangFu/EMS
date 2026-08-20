import { tokenize, CalcTokenizeError } from "./tokenizer";
import type { CalcErrorCode } from "./ast";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectFailCode(expression: string, code: CalcErrorCode, message: string): void {
  try {
    tokenize(expression);
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
