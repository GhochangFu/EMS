import type {
  CalcAggregate,
  CalcAggregateFn,
  CalcCrossRef,
  CalcErrorCode,
  CalcExpr,
  CalcFunctionName,
  CalcParseError,
  CalcScope,
  ParseResult,
} from "./ast";
import { crossRefKey } from "./cross-ref";
import {
  CALC_AGGREGATE_FNS,
  CALC_DIALECT,
  CALC_DIALECT_V2,
  CALC_FUNCTION_ARITY,
  MAX_FORMULA_CROSS_REFS,
  MAX_FORMULA_DEPTH,
  MAX_FORMULA_LENGTH,
  MAX_FORMULA_POINT_REFS,
  type CalcDialect,
} from "./limits";
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

/** Compile-time exhaustiveness for a `switch` whose function returns `void`
 * — see `collectRefEntries`. Never reached at runtime, and the message
 * deliberately carries nothing of the node: an AST node holds point keys. */
function assertNever(_value: never): never {
  throw new Error("calc-dsl: unhandled AST node kind");
}

const FUNCTION_NAMES: ReadonlySet<string> = new Set(Object.keys(CALC_FUNCTION_ARITY));

function isCalcFunctionName(name: string): name is CalcFunctionName {
  return FUNCTION_NAMES.has(name);
}

const AGGREGATE_FNS: ReadonlySet<string> = new Set(CALC_AGGREGATE_FNS);

function isCalcAggregateFn(name: string): name is CalcAggregateFn {
  return AGGREGATE_FNS.has(name);
}

/** `dialect` defaults to `bms-calc-v1`; a caller that passes nothing gets the
 * `v1` parser byte-for-byte (ADR 0055 decision 4, held structurally below). */
export interface ParseOptions {
  dialect?: CalcDialect;
}

/**
 * `expression := term (("+" | "-") term)*`
 * `term       := factor (("*" | "/") factor)*`
 * `factor     := number | pointRef | "(" expression ")" | "-" factor | call`
 * `call       := fnName "(" expression ("," expression)* ")"`
 *
 * Under `bms-calc-v2` only (ADR 0055 decision 1), `factor` also admits:
 * `qualifiedRef := "{" assetCode "." pointKey "}"` (one `ref` token carrying
 * `assetCode`), and
 * `aggregate    := aggFn "(" pointRef scope ")"`,
 * `scope        := "@site" | ("@domain" | "@group") "(" string ")"`.
 *
 * **The `v1` productions are untouched by `v2`.** Every `v2` branch is an
 * *added* branch guarded by `isV2`; no `v1` branch is edited or removed, so a
 * caller that passes no dialect cannot reach a `v2` production or raise a
 * `v2` error code. That is how ADR 0055 decisions 3 and 4 are held by
 * construction; the property test (`F2.9` Task 3) is the tripwire.
 *
 * Recursive descent, one class of parser per precedence level. `enter`/`exit`
 * bound recursion depth (`MAX_FORMULA_DEPTH`) so a pathological paste fails
 * as a `ParseResult`, not a JS `RangeError`.
 */
class Parser {
  private pos = 0;
  private depth = 0;
  private readonly isV2: boolean;

  constructor(
    private readonly tokens: Token[],
    dialect: CalcDialect,
  ) {
    this.isV2 = dialect === CALC_DIALECT_V2;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    this.pos += 1;
    return token;
  }

  /** The refusal for a token found where the grammar wanted something else.
   * The `v1` lexer never produces a `scope` token, so the `v2` branch is
   * unreachable under `v1` even without its guard — the guard is there so the
   * superset property reads off the source. */
  private failUnexpected(token: Token): never {
    if (token.kind === "eof") {
      fail("unexpected_end", token.position);
    }
    if (this.isV2 && token.kind === "scope") {
      fail("scope_not_allowed", token.position);
    }
    fail("unexpected_token", token.position);
  }

  private expect(kind: TokenKind): Token {
    const token = this.peek();
    if (token.kind !== kind) {
      this.failUnexpected(token);
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
      if (this.isV2 && trailing.kind === "scope") {
        fail("scope_not_allowed", trailing.position);
      }
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

      // v2 only — a qualified `ref` token becomes a `qref` node, and an
      // identifier naming an aggregate function opens an aggregate. Checked
      // before the v1 branches because a qualified reference is still a `ref`
      // token; under v1 `assetCode` is never set, so the v1 `ref` branch below
      // sees exactly what it always did.
      if (this.isV2) {
        if (token.kind === "ref" && token.assetCode !== undefined) {
          this.advance();
          return { kind: "qref", assetCode: token.assetCode, pointKey: token.text, position: token.position };
        }
        if (token.kind === "ident" && isCalcAggregateFn(token.text)) {
          return this.parseAggregate(token.text);
        }
      }

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

      this.failUnexpected(token);
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

  /**
   * v2 only — `aggregate := aggFn "(" pointRef scope ")"`. The argument is
   * exactly one plain, unqualified point reference: an aggregate names the
   * member point, not an expression over it, and the member set is the
   * scope's, not one asset's. Positions: the function name for the node, the
   * offending token for a refusal.
   */
  private parseAggregate(fn: CalcAggregateFn): CalcAggregate {
    const nameToken = this.advance(); // the "ident" token itself
    this.expect("lparen");

    const refToken = this.peek();
    if (refToken.kind !== "ref") {
      if (refToken.kind === "eof") {
        fail("unexpected_end", refToken.position);
      }
      fail("aggregate_needs_point_reference", refToken.position);
    }
    if (refToken.assetCode !== undefined) {
      fail("qualified_reference_in_aggregate", refToken.position);
    }
    this.advance();

    const scopeToken = this.peek();
    if (scopeToken.kind !== "scope") {
      if (scopeToken.kind === "eof") {
        fail("unexpected_end", scopeToken.position);
      }
      fail("scope_required", scopeToken.position);
    }
    this.advance();
    const scope = this.parseScopeArgument(scopeToken);

    this.expect("rparen");
    return { kind: "aggregate", fn, pointKey: refToken.text, scope, position: nameToken.position };
  }

  /**
   * v2 only — `scope := "@site" | ("@domain" | "@group") "(" string ")"`.
   * `@site` takes no argument; the other two take exactly one string. A
   * malformed scope is reported at the scope keyword, because that is the
   * thing the author wrote wrong; a truncated one is `unexpected_end`.
   */
  private parseScopeArgument(scopeToken: Token): CalcScope {
    const kind = scopeToken.text.slice(1); // the lexer admits only CALC_SCOPE_KINDS after `@`
    if (kind === "site") {
      if (this.peek().kind === "lparen") {
        this.failScope(scopeToken, this.peek());
      }
      return { kind: "site" };
    }
    if (kind !== "domain" && kind !== "group") {
      this.failScope(scopeToken, scopeToken); // unreachable: `unknown_scope` is the lexer's
    }

    if (this.peek().kind !== "lparen") {
      this.failScope(scopeToken, this.peek());
    }
    this.advance();
    const code = this.peek();
    if (code.kind !== "string") {
      this.failScope(scopeToken, code);
    }
    this.advance();
    if (this.peek().kind !== "rparen") {
      this.failScope(scopeToken, this.peek());
    }
    this.advance();
    return { kind, code: code.text };
  }

  /** A method, not a local arrow: control-flow narrowing after a
   * never-returning call needs a declared `never` on the callee itself. */
  private failScope(scopeToken: Token, found: Token): never {
    if (found.kind === "eof") {
      fail("unexpected_end", found.position);
    }
    fail("malformed_scope", scopeToken.position);
  }
}

type RefEntries = {
  local: { pointKey: string; position: number }[];
  cross: CalcCrossRef[];
};

/**
 * One walk of the AST, splitting local `{ref}`s from cross-asset nodes.
 *
 * **The `default: assertNever(node)` is load-bearing.** `visit` returns
 * `void`, so TypeScript does NOT flag a missing `case` here: a new `CalcExpr`
 * kind would fall through silently, never reach either list, and a
 * cross-asset reference would vanish from `crossRefs` with every test of the
 * old kinds still green. (Contrast `evalNode` in `./evaluate`, whose
 * `CalcEvalResult` return type makes its switch exhaustive-checked for free.)
 * `assertNever(node)` turns the omission into a compile error, because `node`
 * is only `never` once every kind has a case.
 */
function collectRefEntries(expr: CalcExpr): RefEntries {
  const local: RefEntries["local"] = [];
  const cross: CalcCrossRef[] = [];
  const visit = (node: CalcExpr): void => {
    switch (node.kind) {
      case "number":
        return;
      case "ref":
        local.push({ pointKey: node.pointKey, position: node.position });
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
      case "qref":
        cross.push(node);
        return;
      case "aggregate":
        cross.push(node);
        return;
      default:
        assertNever(node);
    }
  };
  visit(expr);
  return { local, cross };
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

/** First node per `crossRefKey`, in first-appearance order — so the kept
 * node's `position` is the reference's first occurrence. */
function dedupeCrossRefs(nodes: CalcCrossRef[]): CalcCrossRef[] {
  const seen = new Set<string>();
  const out: CalcCrossRef[] = [];
  for (const node of nodes) {
    const key = crossRefKey(node);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(node);
    }
  }
  return out;
}

/**
 * Parses a `bms-calc-v1` expression — or, with `{ dialect: "bms-calc-v2" }`,
 * a `v2` one. Pure — no evaluation, ever (ADR 0036 decision 3): this
 * function's only job is to say whether the text is a legal formula and, if
 * so, which local point keys (`refs`) and cross-asset references
 * (`crossRefs`) it names.
 */
export function parseFormula(expression: string, options?: ParseOptions): ParseResult {
  const dialect = options?.dialect ?? CALC_DIALECT;
  if (expression.length > MAX_FORMULA_LENGTH) {
    return { ok: false, errors: [{ code: "too_long", position: MAX_FORMULA_LENGTH }] };
  }

  try {
    const tokens = tokenize(expression, { dialect });
    if (tokens.length === 1) {
      // only the eof sentinel — empty or all-whitespace input
      return { ok: false, errors: [{ code: "empty_expression", position: 0 }] };
    }

    const ast = new Parser(tokens, dialect).parseProgram();

    const { local, cross } = collectRefEntries(ast);
    const refs = dedupeInFirstAppearanceOrder(local);
    if (refs.length > MAX_FORMULA_POINT_REFS) {
      const overflowKey = refs[MAX_FORMULA_POINT_REFS];
      const overflowPosition = local.find((e) => e.pointKey === overflowKey)?.position ?? 0;
      return { ok: false, errors: [{ code: "too_many_refs", position: overflowPosition }] };
    }

    const crossRefs = dedupeCrossRefs(cross);
    if (crossRefs.length > MAX_FORMULA_CROSS_REFS) {
      return {
        ok: false,
        errors: [{ code: "too_many_cross_refs", position: crossRefs[MAX_FORMULA_CROSS_REFS].position }],
      };
    }

    return { ok: true, ast, refs, crossRefs };
  } catch (error) {
    if (error instanceof CalcTokenizeError || error instanceof CalcParseFailure) {
      return { ok: false, errors: [error.parseError] };
    }
    throw error;
  }
}

/**
 * Parses `expression` and additionally checks every LOCAL `{ref}` against
 * `knownRefs` by name. Name-only and pure — it knows nothing about
 * `template_points.kind`. The derived-references-derived rule (ADR 0036
 * decision 7) needs point kinds, which are a `template_points` concept, not
 * a DSL one, so that check lives in `apps/api`, not here.
 *
 * A cross-asset reference (`crossRefs`) is deliberately not checked: its
 * asset and point key resolve against another asset's declarations, which
 * only the api host can see, at save and evaluation time (ADR 0055
 * decision 8).
 */
export function validateFormula(
  expression: string,
  knownRefs: Iterable<string>,
  options?: ParseOptions,
): ParseResult {
  const result = parseFormula(expression, options);
  if (!result.ok) {
    return result;
  }

  const known = new Set(knownRefs);
  for (const entry of collectRefEntries(result.ast).local) {
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
  // `bms-calc-v2` lexical codes (ADR 0055) — one line each, no echo, forced
  // here by the `Record<CalcErrorCode, string>` type. Author guidance beyond
  // this is `F2.22`'s.
  unknown_scope: "unknown scope",
  unterminated_string: "unterminated string",
  empty_string: "empty string",
  malformed_qualified_reference: "malformed qualified point reference",
  // `bms-calc-v2` parser codes (ADR 0055; `F2.9` Task 2) — same rule.
  malformed_scope: "malformed scope",
  scope_required: "an aggregate needs a scope after its point reference",
  scope_not_allowed: "a scope is only allowed inside an aggregate",
  aggregate_needs_point_reference: "an aggregate takes exactly one point reference",
  qualified_reference_in_aggregate: "an aggregate cannot take a qualified point reference",
  too_many_cross_refs: "the formula has too many distinct cross-asset references",
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
