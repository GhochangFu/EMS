import type { CalcErrorCode, CalcParseError } from "./ast";

export type TokenKind =
  | "number"
  | "ref"
  | "ident"
  | "plus"
  | "minus"
  | "star"
  | "slash"
  | "lparen"
  | "rparen"
  | "comma"
  | "eof";

/**
 * `text` holds the identifier/point-key text for `ident`/`ref` tokens, and
 * the operator glyph otherwise. `numberValue` is set only for `number`.
 */
export interface Token {
  kind: TokenKind;
  position: number;
  text: string;
  numberValue?: number;
}

/** Internal — carries a `CalcParseError`, never source text. Caught and
 * converted to a `ParseResult` at the `parseFormula`/`validateFormula`
 * boundary in `./parser`. */
export class CalcTokenizeError extends Error {
  constructor(public readonly parseError: CalcParseError) {
    super(`calc-dsl tokenize error: ${parseError.code}`);
  }
}

function fail(code: CalcErrorCode, position: number): never {
  throw new CalcTokenizeError({ code, position });
}

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";
const isIdentStart = (ch: string): boolean => /[a-zA-Z_]/.test(ch);
const isIdentChar = (ch: string): boolean => /[a-zA-Z0-9_]/.test(ch);
const isWhitespace = (ch: string): boolean => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

const SINGLE_CHAR_TOKENS: Readonly<Record<string, TokenKind>> = {
  "+": "plus",
  "-": "minus",
  "*": "star",
  "/": "slash",
  "(": "lparen",
  ")": "rparen",
  ",": "comma",
};

/**
 * Tokenizes the whole expression up front. Throws `CalcTokenizeError` on the
 * first lexical error — `position` only, per the no-input-echo gate (ADR
 * 0036 §"Not in this ADR" / the `parseStoredContent` `issue.code === "custom"`
 * passthrough precedent this repo already has one incident with).
 */
export function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const n = expression.length;
  let i = 0;

  while (i < n) {
    const ch = expression[i];

    if (isWhitespace(ch)) {
      i += 1;
      continue;
    }

    const start = i;

    const single = SINGLE_CHAR_TOKENS[ch];
    if (single) {
      tokens.push({ kind: single, position: start, text: ch });
      i += 1;
      continue;
    }

    if (ch === "{") {
      i += 1;
      const refStart = i;
      while (i < n && expression[i] !== "{" && expression[i] !== "}") {
        i += 1;
      }
      if (i >= n || expression[i] === "{") {
        fail("unterminated_reference", start);
      }
      const pointKey = expression.slice(refStart, i);
      i += 1; // consume "}"
      if (pointKey.length === 0) {
        fail("empty_reference", start);
      }
      tokens.push({ kind: "ref", position: start, text: pointKey });
      continue;
    }

    if (isDigit(ch)) {
      let j = i + 1;
      while (j < n && isDigit(expression[j])) {
        j += 1;
      }
      if (j < n && expression[j] === ".") {
        j += 1;
        const digitsStart = j;
        while (j < n && isDigit(expression[j])) {
          j += 1;
        }
        if (j === digitsStart) {
          fail("malformed_number", start);
        }
      }
      // no exponent form, and no second decimal point — either glued straight
      // onto the literal is malformed, not a separate token
      if (j < n && (isIdentStart(expression[j]) || expression[j] === ".")) {
        fail("malformed_number", start);
      }
      const text = expression.slice(start, j);
      const numberValue = Number(text);
      // A long enough run of digits overflows to Infinity — still a "number"
      // syntactically, but CalcNumber.value: number promises a real one to
      // every downstream consumer (F2.4's evaluator, F2.5's AST preview).
      if (!Number.isFinite(numberValue)) {
        fail("malformed_number", start);
      }
      tokens.push({ kind: "number", position: start, text, numberValue });
      i = j;
      continue;
    }

    if (ch === ".") {
      // `\d+(\.\d+)?` requires a leading digit — a bare `.5` is out of grammar
      fail("malformed_number", start);
    }

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentChar(expression[j])) {
        j += 1;
      }
      tokens.push({ kind: "ident", position: start, text: expression.slice(start, j) });
      i = j;
      continue;
    }

    fail("unexpected_character", start);
  }

  tokens.push({ kind: "eof", position: n, text: "" });
  return tokens;
}
