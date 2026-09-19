import type {
  CalcAggregate,
  CalcAggregateFn,
  CalcCrossRef,
  CalcErrorCode,
  CalcExpr,
  CalcFunctionName,
  CalcParamRef,
  CalcParseError,
  CalcPointRef,
  CalcQualifiedRef,
  CalcScope,
  CalcWindow,
  CalcWindowFnName,
  CalcWindowRead,
  ParseResult,
} from "./ast";
import { crossRefKey } from "./cross-ref";
import {
  CALC_AGGREGATE_FNS,
  CALC_DIALECT,
  CALC_FUNCTION_ARITY,
  CALC_WINDOW_FNS,
  isCrossAssetDialect,
  isParameterDialect,
  isWindowDialect,
  MAX_FORMULA_CROSS_REFS,
  MAX_FORMULA_DEPTH,
  MAX_FORMULA_LENGTH,
  MAX_FORMULA_PARAM_REFS,
  MAX_FORMULA_POINT_REFS,
  MAX_FORMULA_WINDOWS,
  MAX_ROLLING_WINDOW_DAYS,
  type CalcDialect,
} from "./limits";
import { CalcTokenizeError, tokenize, type Token, type TokenKind } from "./tokenizer";
import { parseWindowLiteral, windowKey } from "./window-ref";

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

const WINDOW_FNS: ReadonlySet<string> = new Set(CALC_WINDOW_FNS);

function isCalcWindowFn(name: string): name is CalcWindowFnName {
  return WINDOW_FNS.has(name);
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
 * **The `v2` productions are untouched by `v3`** (ADR 0070 decision 3), by
 * the same construction: `isV2` now means "has cross-asset references", which
 * `v3` also has, so every `v2` branch runs under `v3` unedited, and the one
 * `v3` production — `paramRef := "$" key`, a `param` token becoming a
 * `param` node — sits behind `isV3`. A `param` token cannot exist under
 * `v1` or `v2` (the tokenizer never emits one), so the guard is belt and
 * braces rather than the only defence.
 *
 * Under the window dialect only (ADR 0070 decisions 5 and 6; `E4.1b`),
 * `factor` also admits:
 * `windowCall := ("sum" | "avg" | "min" | "max" | "delta") "(" (pointRef | qualifiedRef) "," window ")"`
 * `hoursCall  := "hours" "(" window ")"`
 * `window     := <n>(m|h|d) | today | this_week | this_month | this_year`
 * The existing names are reused, not shadowed: `sum`/`avg` are the window
 * form when a `comma` follows the point reference and the `v2` aggregate when
 * a `scope` does (one token of lookahead on the token array); `min`/`max` are
 * the window form when the first argument is a bare point reference and a
 * `comma`, `window` pair follows it, the n-ary scalar otherwise. `delta` and
 * `hours` are not in `CALC_FUNCTION_ARITY`, so `v1` and `v2` keep refusing
 * them as `unknown_function`. A `window` token anywhere else is
 * `window_not_allowed`; a window over a scope aggregate is
 * `window_over_aggregate` (ruling 4). All of it behind `isV3W`.
 *
 * Recursive descent, one class of parser per precedence level. `enter`/`exit`
 * bound recursion depth (`MAX_FORMULA_DEPTH`) so a pathological paste fails
 * as a `ParseResult`, not a JS `RangeError`.
 */
class Parser {
  private pos = 0;
  private depth = 0;
  private readonly isV2: boolean;
  private readonly isV3: boolean;
  private readonly isV3W: boolean;

  constructor(
    private readonly tokens: Token[],
    dialect: CalcDialect,
  ) {
    this.isV2 = isCrossAssetDialect(dialect);
    this.isV3 = isParameterDialect(dialect);
    this.isV3W = isWindowDialect(dialect);
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  /** The token `n` ahead of the cursor, or the trailing `eof` sentinel. */
  private peekAhead(n: number): Token {
    return this.tokens[Math.min(this.pos + n, this.tokens.length - 1)];
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
    if (this.isV3W && token.kind === "window") {
      fail("window_not_allowed", token.position);
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
      if (this.isV3W && trailing.kind === "window") {
        fail("window_not_allowed", trailing.position);
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

      // v3 only — a `param` token becomes a `param` node (ADR 0070 decision
      // 4). Checked first because nothing else consumes the kind.
      if (this.isV3 && token.kind === "param") {
        this.advance();
        return { kind: "param", key: token.text, position: token.position };
      }

      // v3 windows only (ADR 0070 decision 5). `delta` and `hours` are window
      // calls whenever they appear; `sum`/`avg` are the window form when the
      // token after the point reference is a `comma` (the v2 aggregate has a
      // `scope` there and falls through to the v2 branch below unchanged);
      // `min`/`max` are decided inside `parseCall` after the first argument.
      if (this.isV3W && token.kind === "ident") {
        if (token.text === "hours") {
          return this.parseHoursCall();
        }
        if (token.text === "delta") {
          return this.parseWindowCall("delta");
        }
        if (
          isCalcAggregateFn(token.text) &&
          this.peekAhead(1).kind === "lparen" &&
          this.peekAhead(2).kind === "ref" &&
          this.peekAhead(3).kind === "comma"
        ) {
          return this.parseWindowCall(token.text);
        }
      }

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
      // v3 windows only — `min({kw}, 24h)` is the window form of `min`/`max`
      // (ADR 0070 decision 5): exactly one argument so far, a `comma`,
      // `window` pair next. The first argument must be a bare point
      // reference; an expression there is refused at the function name.
      if (
        this.isV3W &&
        isCalcWindowFn(nameToken.text) &&
        this.peek().kind === "comma" &&
        this.peekAhead(1).kind === "window"
      ) {
        const first = args[0];
        if (first.kind !== "ref" && first.kind !== "qref") {
          fail("window_needs_point_reference", nameToken.position);
        }
        this.advance(); // the comma
        const window = this.parseWindowLiteralToken(this.advance());
        this.expect("rparen");
        return { kind: "window", fn: nameToken.text, ref: first, window, position: nameToken.position };
      }
      while (this.peek().kind === "comma") {
        this.advance();
        // v3 windows only — a window after a SECOND or later argument is the
        // author reaching for the window form with too many points; name that
        // rather than the generic placement refusal.
        if (this.isV3W && isCalcWindowFn(nameToken.text) && this.peek().kind === "window") {
          fail("window_needs_point_reference", nameToken.position);
        }
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
   * v3 windows only — `windowCall := fn "(" (pointRef | qualifiedRef) "," window ")"`
   * for `sum`, `avg` (entered on the `comma` lookahead) and `delta` (always).
   * Positions: the function name for the node and for a wrong first
   * argument, the offending token for a missing window, the literal for a
   * bad amount or the cap.
   */
  private parseWindowCall(fn: CalcWindowFnName): CalcExpr {
    const nameToken = this.advance(); // the "ident" token itself
    this.expect("lparen");

    const refToken = this.peek();
    if (refToken.kind !== "ref") {
      if (refToken.kind === "eof") {
        fail("unexpected_end", refToken.position);
      }
      fail("window_needs_point_reference", nameToken.position);
    }
    this.advance();
    const ref: CalcPointRef | CalcQualifiedRef =
      refToken.assetCode === undefined
        ? { kind: "ref", pointKey: refToken.text, position: refToken.position }
        : { kind: "qref", assetCode: refToken.assetCode, pointKey: refToken.text, position: refToken.position };

    if (this.peek().kind !== "comma") {
      this.failWindowRequired(this.peek());
    }
    this.advance();
    const window = this.parseWindowLiteralToken(this.advance());
    this.expect("rparen");
    return { kind: "window", fn, ref, window, position: nameToken.position };
  }

  /** v3 windows only — `hoursCall := "hours" "(" window ")"`. */
  private parseHoursCall(): CalcExpr {
    const nameToken = this.advance(); // the "ident" token itself
    this.expect("lparen");
    const window = this.parseWindowLiteralToken(this.advance());
    this.expect("rparen");
    return { kind: "hours", window, position: nameToken.position };
  }

  /** The window literal a window call ends with; anything else in its place
   * is `window_required` at that token (`unexpected_end` if the text ran out). */
  private parseWindowLiteralToken(token: Token): CalcWindow {
    if (token.kind !== "window") {
      this.failWindowRequired(token);
    }
    const window = parseWindowLiteral(token.text);
    if (window === "malformed") {
      fail("malformed_window", token.position);
    }
    if (window === "too_long") {
      fail("window_too_long", token.position);
    }
    return window;
  }

  /** A method, not a local arrow, for the reason `failScope` gives. */
  private failWindowRequired(found: Token): never {
    if (found.kind === "eof") {
      fail("unexpected_end", found.position);
    }
    fail("window_required", found.position);
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

    // v3 windows only — a window wraps one point reference, never a scope
    // aggregate (ADR 0070 ruling 4): `sum({kw} @site, 24h)` is refused at the
    // comma, and the message names the two-layer alternative.
    if (this.isV3W && this.peek().kind === "comma") {
      fail("window_over_aggregate", this.peek().position);
    }

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
  params: CalcParamRef[];
  windows: CalcWindowRead[];
};

/**
 * One walk of the AST, splitting local `{ref}`s from cross-asset nodes,
 * (`v3`) from parameter nodes and (`E4.1b`) collecting window reads. The
 * point inside a window is VISITED, so it lands in `local` or `cross` exactly
 * as a bare reference would — that is what keeps the staleness rule,
 * `unknown_reference`, the cross-ref catalog check, membership and both cycle
 * detectors correct without a change (plan design decision 7).
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
  const params: CalcParamRef[] = [];
  const windows: CalcWindowRead[] = [];
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
      case "param":
        params.push(node);
        return;
      case "window":
        visit(node.ref);
        windows.push(node);
        return;
      case "hours":
        windows.push(node);
        return;
      default:
        assertNever(node);
    }
  };
  visit(expr);
  return { local, cross, params, windows };
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

/** First node per key, in first-appearance order — so the kept node's
 * `position` is the parameter's first occurrence (the one `too_many_param_refs`
 * reports). */
function dedupeParamRefs(nodes: CalcParamRef[]): CalcParamRef[] {
  const seen = new Set<string>();
  const out: CalcParamRef[] = [];
  for (const node of nodes) {
    if (!seen.has(node.key)) {
      seen.add(node.key);
      out.push(node);
    }
  }
  return out;
}

/** First node per `windowKey`, in first-appearance order — so the kept
 * node's `position` is the read's first occurrence (the one `too_many_windows`
 * reports). `24h` and `1440m` over one point are one read. */
function dedupeWindowReads(nodes: CalcWindowRead[]): CalcWindowRead[] {
  const seen = new Set<string>();
  const out: CalcWindowRead[] = [];
  for (const node of nodes) {
    const key = windowKey(node);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(node);
    }
  }
  return out;
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
 * a `v2` one, or with `{ dialect: "bms-calc-v3" }` a `v3` one. Pure — no
 * evaluation, ever (ADR 0036 decision 3): this function's only job is to say
 * whether the text is a legal formula and, if so, which local point keys
 * (`refs`), cross-asset references (`crossRefs`), parameters (`paramRefs`)
 * and window reads (`windowReads`) it names. The vocabulary a `$key` must belong to is a
 * database read and is the api's check, exactly where the cross-asset key
 * check lives (ADR 0070 decision 4).
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

    const { local, cross, params, windows } = collectRefEntries(ast);
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

    const paramNodes = dedupeParamRefs(params);
    if (paramNodes.length > MAX_FORMULA_PARAM_REFS) {
      return {
        ok: false,
        errors: [{ code: "too_many_param_refs", position: paramNodes[MAX_FORMULA_PARAM_REFS].position }],
      };
    }

    const windowReads = dedupeWindowReads(windows);
    if (windowReads.length > MAX_FORMULA_WINDOWS) {
      return {
        ok: false,
        errors: [{ code: "too_many_windows", position: windowReads[MAX_FORMULA_WINDOWS].position }],
      };
    }

    return { ok: true, ast, refs, crossRefs, paramRefs: paramNodes.map((node) => node.key), windowReads };
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
  // here by the `Record<CalcErrorCode, string>` type. `F2.22` rewrote these
  // ten sentences to name the fix, not just the fault.
  unknown_scope: "unknown scope after @ — a scope is site, domain('code') or group('code')",
  unterminated_string: "unterminated quoted code — close the scope's code with a second quote",
  empty_string: "empty quoted code — domain('…') and group('…') need a code between the quotes",
  malformed_qualified_reference:
    "malformed qualified reference — write {ASSET_CODE.point_key}, one dot between the asset code and the point key",
  // `bms-calc-v2` parser codes (ADR 0055; `F2.9` Task 2) — same rule.
  malformed_scope: "malformed scope — @site takes no code; @domain and @group take one quoted code in parentheses",
  scope_required: "an aggregate needs a scope after its point reference: @site, @domain('code') or @group('code')",
  scope_not_allowed: "a scope belongs inside an aggregate only — put the reference in an aggregate, or remove the scope",
  aggregate_needs_point_reference: "an aggregate takes exactly one {point_key} reference, then its scope",
  qualified_reference_in_aggregate:
    "an aggregate cannot take a qualified {ASSET_CODE.point_key} reference — its scope already names the assets",
  too_many_cross_refs: `the formula has more than ${MAX_FORMULA_CROSS_REFS} distinct cross-asset references (aggregates and qualified references)`,
  // `bms-calc-v3` lexical code (ADR 0070 decision 4) — same rule.
  malformed_parameter_reference:
    "malformed parameter reference — write $key, the key of a parameter from the calc parameter vocabulary",
  // `bms-calc-v3` parser code (ADR 0070 decision 4) — same rule.
  too_many_param_refs: `the formula has more than ${MAX_FORMULA_PARAM_REFS} distinct $key parameter references`,
  // `bms-calc-v3` window codes (ADR 0070 decision 5; `E4.1b`) — same rule, and
  // each names the fix.
  malformed_window: "a rolling window is a whole number of minutes, hours or days — 15m, 24h, 7d — and is at least 1",
  window_too_long: `a rolling window is at most ${MAX_ROLLING_WINDOW_DAYS}d`,
  window_required:
    "delta and a windowed sum/avg/min/max need a window after the point reference, and hours needs one alone: 24h, 7d, today, this_week, this_month or this_year",
  window_needs_point_reference: "a window function takes exactly one {point_key} or {ASSET_CODE.point_key} reference, then its window",
  window_over_aggregate:
    "a window takes one point reference, not a scope aggregate — compute the per-asset windowed tag first, then aggregate it with @site",
  window_not_allowed: "a window belongs inside sum, avg, min, max, delta or hours — remove it here",
  too_many_windows: `the formula has more than ${MAX_FORMULA_WINDOWS} distinct window reads`,
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
