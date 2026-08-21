/**
 * The `bms-calc-v1` grammar (ADR 0036). This module is the frozen public AST
 * surface `F2.4`/`F2.5`/`F2.6`/`F2.8` build against — changing a shape here is
 * a breaking change for all four.
 */

export type CalcFunctionName = "min" | "max" | "abs" | "round" | "clamp";

export type CalcNumber = { kind: "number"; value: number };
/** `position` is a 0-based character offset of the reference's opening `{`. */
export type CalcPointRef = { kind: "ref"; pointKey: string; position: number };
/**
 * `position` on `unary`/`binary`/`call` is the 0-based offset of the node's
 * own operator/function-name token — added for `F2.4` (ADR 0037 decision 9),
 * which refuses a non-finite result at the node that produced it and reports
 * that node's position, not the root's. `number` carries none: the tokenizer
 * already rejects an overflowing literal (`malformed_number`), so a literal
 * can never itself be the site of a non-finite refusal.
 */
export type CalcUnary = { kind: "unary"; op: "-"; operand: CalcExpr; position: number };
export type CalcBinary = {
  kind: "binary";
  op: "+" | "-" | "*" | "/";
  left: CalcExpr;
  right: CalcExpr;
  position: number;
};
export type CalcCall = { kind: "call"; fn: CalcFunctionName; args: CalcExpr[]; position: number };

export type CalcExpr = CalcNumber | CalcPointRef | CalcUnary | CalcBinary | CalcCall;

export type CalcErrorCode =
  | "empty_expression"
  | "too_long"
  | "too_many_refs"
  | "too_deep"
  | "unexpected_character"
  | "malformed_number"
  | "unterminated_reference"
  | "empty_reference"
  | "unexpected_token"
  | "unexpected_end"
  | "trailing_input"
  | "unknown_function"
  | "bad_arity"
  | "unknown_reference";

/**
 * `position` is a 0-based character offset into the expression. Never carries
 * source text, a point key, or a function name — a stored formula can be
 * arbitrary pre-authorship content and this error is sometimes surfaced
 * verbatim to a caller (see `formatCalcError`).
 */
export type CalcParseError = { code: CalcErrorCode; position: number };

export type ParseResult =
  | { ok: true; ast: CalcExpr; refs: string[] }
  | { ok: false; errors: CalcParseError[] };
