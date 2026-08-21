import type { CalcErrorCode, CalcExpr, CalcFunctionName, CalcParseError, ParseResult } from "./ast";
import { CALC_FUNCTION_ARITY, MAX_FORMULA_DEPTH, MAX_FORMULA_LENGTH, MAX_FORMULA_POINT_REFS } from "./limits";
import { CalcTokenizeError, tokenize, type Token, type TokenKind } from "./tokenizer";

/** Internal — carries a `CalcParseError`, never source text. Caught at the
 * `parseFormula` boundary below. */
class CalcParseFailure extends Error {
  constructor(public readonly parseError: CalcParseError) {
    super(`calc-dsl parse error: ${parseError.code}`);
  }
}

function fail(code: CalcErrorCode, position: number): never {
  throw new CalcParseFailure({ code, position });
}

const FUNCTION_NAMES: ReadonlySet<string> = new Set(Object.keys(CALC_FUNCTION_ARITY));

function isCalcFunctionName(name: string): name is CalcFunctionName {
  return FUNCTION_NAMES.has(name);
}

/**
 * `expression := term (("+" | "-") term)*`
 * `term       := factor (("*" | "/") factor)*`
 * `factor     := number | pointRef | "(" expression ")" | "-" factor | call`
 * `call       := fnName "(" expression ("," expression)* ")"`
 *
 * Recursive descent, one class of parser per precedence level. `enter`/`exit`
 * bound recursion depth (`MAX_FORMULA_DEPTH`) so a pathological paste fails
 * as a `ParseResult`, not a JS `RangeError`.
 */
class Parser {
  private pos = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    this.pos += 1;
    return token;
  }

  private expect(kind: TokenKind): Token {
    const token = this.peek();
    if (token.kind !== kind) {
      fail(token.kind === "eof" ? "unexpected_end" : "unexpected_token", token.position);
    }
    return this.advance();
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > MAX_FORMULA_DEPTH) {
      fail("too_deep", this.peek().position);
    }
  }

  private exit(): void {
    this.depth -= 1;
  }

  parseProgram(): CalcExpr {
    const expr = this.parseExpression();
    const trailing = this.peek();
    if (trailing.kind !== "eof") {
      fail("trailing_input", trailing.position);
    }
    return expr;
  }

  private parseExpression(): CalcExpr {
    this.enter();
    try {
      let left = this.parseTerm();
      for (;;) {
        const token = this.peek();
        if (token.kind !== "plus" && token.kind !== "minus") {
          return left;
        }
        this.advance();
        const right = this.parseTerm();
        left = { kind: "binary", op: token.kind === "plus" ? "+" : "-", left, right, position: token.position };
      }
    } finally {
      this.exit();
    }
  }

  private parseTerm(): CalcExpr {
    this.enter();
    try {
      let left = this.parseFactor();
      for (;;) {
        const token = this.peek();
        if (token.kind !== "star" && token.kind !== "slash") {
          return left;
        }
        this.advance();
        const right = this.parseFactor();
        left = { kind: "binary", op: token.kind === "star" ? "*" : "/", left, right, position: token.position };
      }
    } finally {
      this.exit();
    }
  }

  private parseFactor(): CalcExpr {
    this.enter();
    try {
      const token = this.peek();

      if (token.kind === "number") {
        this.advance();
        return { kind: "number", value: token.numberValue as number };
      }

      if (token.kind === "ref") {
        this.advance();
        return { kind: "ref", pointKey: token.text, position: token.position };
      }

      if (token.kind === "minus") {
        this.advance();
        return { kind: "unary", op: "-", operand: this.parseFactor(), position: token.position };
      }

      if (token.kind === "lparen") {
        this.advance();
        const inner = this.parseExpression();
        this.expect("rparen");
        return inner;
      }

      if (token.kind === "ident") {
        return this.parseCall();
      }

      fail(token.kind === "eof" ? "unexpected_end" : "unexpected_token", token.position);
    } finally {
      this.exit();
    }
  }

  private parseCall(): CalcExpr {
    const nameToken = this.advance(); // the "ident" token itself
    this.expect("lparen");

    const args: CalcExpr[] = [];
    if (this.peek().kind !== "rparen") {
      args.push(this.parseExpression());
      while (this.peek().kind === "comma") {
        this.advance();
        args.push(this.parseExpression());
      }
    }
    this.expect("rparen");

    if (!isCalcFunctionName(nameToken.text)) {
      fail("unknown_function", nameToken.position);
    }
    const arity = CALC_FUNCTION_ARITY[nameToken.text];
    if (args.length < arity.min || args.length > arity.max) {
      fail("bad_arity", nameToken.position);
    }

    return { kind: "call", fn: nameToken.text, args, position: nameToken.position };
  }
}

function collectRefEntries(expr: CalcExpr): { pointKey: string; position: number }[] {
  const out: { pointKey: string; position: number }[] = [];
  const visit = (node: CalcExpr): void => {
    switch (node.kind) {
      case "number":
        return;
      case "ref":
        out.push({ pointKey: node.pointKey, position: node.position });
        return;
      case "unary":
        visit(node.operand);
        return;
      case "binary":
        visit(node.left);
        visit(node.right);
        return;
      case "call":
        node.args.forEach(visit);
        return;
    }
  };
  visit(expr);
  return out;
}

function dedupeInFirstAppearanceOrder(entries: { pointKey: string }[]): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const entry of entries) {
    if (!seen.has(entry.pointKey)) {
      seen.add(entry.pointKey);
      refs.push(entry.pointKey);
    }
  }
  return refs;
}

/**
 * Parses a `bms-calc-v1` expression. Pure — no evaluation, ever (ADR 0036
 * decision 3): this function's only job is to say whether the text is a
 * legal formula and, if so, which point keys it references.
 */
export function parseFormula(expression: string): ParseResult {
  if (expression.length > MAX_FORMULA_LENGTH) {
    return { ok: false, errors: [{ code: "too_long", position: MAX_FORMULA_LENGTH }] };
  }

  try {
    const tokens = tokenize(expression);
    if (tokens.length === 1) {
      // only the eof sentinel — empty or all-whitespace input
      return { ok: false, errors: [{ code: "empty_expression", position: 0 }] };
    }

    const ast = new Parser(tokens).parseProgram();

    const refEntries = collectRefEntries(ast);
    const refs = dedupeInFirstAppearanceOrder(refEntries);
    if (refs.length > MAX_FORMULA_POINT_REFS) {
      const overflowKey = refs[MAX_FORMULA_POINT_REFS];
      const overflowPosition = refEntries.find((e) => e.pointKey === overflowKey)?.position ?? 0;
      return { ok: false, errors: [{ code: "too_many_refs", position: overflowPosition }] };
    }

    return { ok: true, ast, refs };
  } catch (error) {
    if (error instanceof CalcTokenizeError || error instanceof CalcParseFailure) {
      return { ok: false, errors: [error.parseError] };
    }
    throw error;
  }
}

/**
 * Parses `expression` and additionally checks every `{ref}` against
 * `knownRefs` by name. Name-only and pure — it knows nothing about
 * `template_points.kind`. The derived-references-derived rule (ADR 0036
 * decision 7) needs point kinds, which are a `template_points` concept, not
 * a DSL one, so that check lives in `apps/api`, not here.
 */
export function validateFormula(expression: string, knownRefs: Iterable<string>): ParseResult {
  const result = parseFormula(expression);
  if (!result.ok) {
    return result;
  }

  const known = new Set(knownRefs);
  for (const entry of collectRefEntries(result.ast)) {
    if (!known.has(entry.pointKey)) {
      return { ok: false, errors: [{ code: "unknown_reference", position: entry.position }] };
    }
  }

  return result;
}

const ERROR_MESSAGES: Readonly<Record<CalcErrorCode, string>> = {
  empty_expression: "the formula is empty",
  too_long: "the formula is too long",
  too_many_refs: "the formula references too many distinct points",
  too_deep: "the formula is nested too deeply",
  unexpected_character: "unexpected character",
  malformed_number: "malformed number",
  unterminated_reference: "unterminated point reference",
  empty_reference: "empty point reference",
  unexpected_token: "unexpected token",
  unexpected_end: "unexpected end of formula",
  trailing_input: "unexpected content after the formula",
  unknown_function: "unknown function",
  bad_arity: "wrong number of arguments",
  unknown_reference: "reference to an unknown point",
};

/**
 * Renders a `CalcParseError` for an author-facing message. Never includes any
 * fragment of the source expression, the point key, or the function name —
 * `parseStoredContent`'s `issue.code === "custom"` passthrough echoed raw
 * input straight to a caller once already (`asset-templates.service.ts`);
 * every calc-dsl message stays on the safe side of that lesson.
 */
export function formatCalcError(error: CalcParseError): string {
  return `${ERROR_MESSAGES[error.code]} at character ${error.position}`;
}
