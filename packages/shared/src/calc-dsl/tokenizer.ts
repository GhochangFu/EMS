import type { CalcErrorCode, CalcParseError } from "./ast";
import { CALC_DIALECT, CALC_DIALECT_V2, CALC_SCOPE_KINDS, type CalcDialect } from "./limits";

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
  // `bms-calc-v2` only (ADR 0055 decision 1): `@site` / `@domain` / `@group`,
  // and the `'…'` argument a domain or group scope takes.
  | "scope"
  | "string"
  | "eof";

/**
 * `text` holds the identifier/point-key text for `ident`/`ref` tokens, and
 * the operator glyph otherwise. `numberValue` is set only for `number`.
 *
 * Under `bms-calc-v2`: a `scope` token's `text` **includes** the `@`
 * (`"@site"`); a `string` token's `text` **excludes** its quotes; and a
 * qualified reference `{CODE.key}` is still a `ref` token whose `text` is the
 * point key alone, with the asset code in `assetCode`. `assetCode` is never
 * set under `v1`, and never set for an unqualified `v2` reference.
 */
export interface Token {
  kind: TokenKind;
  position: number;
  text: string;
  numberValue?: number;
  assetCode?: string;
}

/** `dialect` defaults to `bms-calc-v1`; a caller that passes nothing gets the
 * `v1` lexer byte-for-byte (ADR 0055 decision 4, held structurally below). */
export interface TokenizeOptions {
  dialect?: CalcDialect;
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

const SCOPE_KINDS: ReadonlySet<string> = new Set(CALC_SCOPE_KINDS);

/**
 * Tokenizes the whole expression up front. Throws `CalcTokenizeError` on the
 * first lexical error — `position` only, per the no-input-echo gate (ADR
 * 0036 §"Not in this ADR" / the `parseStoredContent` `issue.code === "custom"`
 * passthrough precedent this repo already has one incident with).
 *
 * **The `v1` loop is untouched by `v2`.** Every `bms-calc-v2` production is an
 * *added* branch guarded by `isV2`; no `v1` branch is edited or removed. That
 * is how ADR 0055 decision 4 (`v2` is a strict superset) and decision 3 (`v1`
 * keeps its meaning forever) are held by construction — a `v1` call cannot
 * reach a `v2` branch, so it cannot produce a `scope` or `string` token, an
 * `assetCode`, or any of the four `v2` error codes. The property test (`F2.9`
 * Task 3) is the tripwire, not the guarantee.
 */
export function tokenize(expression: string, options?: TokenizeOptions): Token[] {
  const isV2 = (options?.dialect ?? CALC_DIALECT) === CALC_DIALECT_V2;
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
      // v2 only — a qualified reference `{CODE.key}` splits at the FIRST `.`
      // (ADR 0055 decision 1; plan design decision 10, ruling Q1). Under v1 a
      // `.` is an ordinary point-key character and this branch is never
      // reached, so `{a.b}` stays one v1 ref with `text === "a.b"`.
      if (isV2) {
        const dot = pointKey.indexOf(".");
        if (dot !== -1) {
          const assetCode = pointKey.slice(0, dot);
          const qualifiedKey = pointKey.slice(dot + 1);
          if (assetCode.length === 0 || qualifiedKey.length === 0) {
            fail("malformed_qualified_reference", start);
          }
          tokens.push({ kind: "ref", position: start, text: qualifiedKey, assetCode });
          continue;
        }
      }
      tokens.push({ kind: "ref", position: start, text: pointKey });
      continue;
    }

    // v2 only — `@site` / `@domain` / `@group` as one `scope` token, `text`
    // keeping the `@`. The name must follow the `@` immediately and be one of
    // `CALC_SCOPE_KINDS`, case-sensitively; anything else (including a bare
    // `@`) is `unknown_scope` at the `@`. Under v1, `@` falls through to
    // `unexpected_character` exactly as before.
    if (isV2 && ch === "@") {
      let j = i + 1;
      while (j < n && isIdentChar(expression[j])) {
        j += 1;
      }
      if (!SCOPE_KINDS.has(expression.slice(i + 1, j))) {
        fail("unknown_scope", start);
      }
      tokens.push({ kind: "scope", position: start, text: expression.slice(start, j) });
      i = j;
      continue;
    }

    // v2 only — `'…'` as one `string` token, `text` without the quotes. No
    // escape form: a domain or group code is a plain catalog code. Under v1 a
    // quote falls through to `unexpected_character` exactly as before.
    if (isV2 && ch === "'") {
      let j = i + 1;
      while (j < n && expression[j] !== "'") {
        j += 1;
      }
      if (j >= n) {
        fail("unterminated_string", start);
      }
      const text = expression.slice(i + 1, j);
      if (text.length === 0) {
        fail("empty_string", start);
      }
      tokens.push({ kind: "string", position: start, text });
      i = j + 1; // consume the closing quote
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
