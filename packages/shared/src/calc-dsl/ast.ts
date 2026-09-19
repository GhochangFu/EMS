/**
 * The `bms-calc-v1` grammar (ADR 0036), the `bms-calc-v2` additions to it
 * (ADR 0055) and, since ADR 0070, the `bms-calc-v3` additions to that.
 *
 * **The `v1` and `v2` shapes are frozen.** They are the public AST surface
 * `F2.4`/`F2.5`/`F2.6`/`F2.8`/`F2.9` build against, and ADR 0055 decision 3
 * and ADR 0070 decision 3 say each dialect keeps its meaning forever —
 * changing an existing shape here is a breaking change for every consumer.
 * **The `v2` and `v3` additions are additive and named:** a new member of a
 * union or a new error code, never an edit to an existing one. A consumer
 * that exhausts a union must decide what a new kind means for it, which is
 * the point of adding a kind rather than an optional field (ADR 0055
 * decision 2; plan design decision 2).
 */

import type { CALC_AGGREGATE_FNS, CALC_WINDOW_FNS, CalcCalendarWindow } from "./limits";

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

// ---- bms-calc-v2 (ADR 0055 decision 1) ------------------------------------
//
// Two new node kinds, on purpose, rather than an optional `assetCode` on
// `ref`: an exhaustive consumer must then decide what a cross-asset
// reference means for it, instead of silently treating one as local. Neither
// carries a resolved asset id or a member set — resolution is the host's, at
// evaluation time (ADR 0055 decision 8; plan design decision 4).

/** `sum` / `avg` — the vocabulary is `CALC_AGGREGATE_FNS` in `./limits`. */
export type CalcAggregateFn = (typeof CALC_AGGREGATE_FNS)[number];

/** `@site` takes no argument; `@domain('…')` and `@group('…')` name a code
 * that the host resolves against the owning asset's location. */
export type CalcScope = { kind: "site" } | { kind: "domain"; code: string } | { kind: "group"; code: string };

/** `{CODE.key}` — `position` is the 0-based offset of the opening `{`, as for
 * `ref`. `pointKey` is the text after the first `.`; `assetCode` the text
 * before it. */
export type CalcQualifiedRef = { kind: "qref"; assetCode: string; pointKey: string; position: number };

/** `fn({key} @scope)` — `position` is the 0-based offset of the function-name
 * token, as for `call`. `pointKey` is always an unqualified key: the parser
 * refuses `{CODE.key}` inside an aggregate. */
export type CalcAggregate = {
  kind: "aggregate";
  fn: CalcAggregateFn;
  pointKey: string;
  scope: CalcScope;
  position: number;
};

/** The two node kinds the host must resolve before `evaluate` runs. The
 * canonical string form of one is `crossRefKey` in `./cross-ref`. */
export type CalcCrossRef = CalcQualifiedRef | CalcAggregate;

// ---- bms-calc-v3 (ADR 0070 decision 4) ------------------------------------
//
// One new node kind, on purpose, rather than an optional field on `ref`, for
// the reason the `v2` block gives: an exhaustive consumer must decide what a
// parameter means for it. `collectRefEntries`'s `assertNever` and `evalNode`'s
// return type both turn the omission into a compile error.

/** `$key` — `position` is the 0-based offset of the `$`; `key` is the
 * vocabulary code without the `$`. The host resolves it against the
 * parameter store (nearest scope, effective at the tick) before `evaluate`
 * runs, into the fourth map; the node carries no value and no scope. */
export type CalcParamRef = { kind: "param"; key: string; position: number };

// ---- bms-calc-v3 windows (ADR 0070 decisions 5 and 6; `E4.1b`) -------------
//
// Two new node kinds, on purpose, rather than one kind with a nullable `ref`:
// `hours(window)` takes no point, and a consumer that exhausts the union must
// decide what each means for it. Neither carries a value, a zone or a read
// plan — the host resolves every window read against the continuous
// aggregates (and, for `delta`, two index probes) into the fifth map before
// `evaluate` runs, keyed by `windowKey` in `./window-ref`.

/** `sum` / `avg` / `min` / `max` / `delta` — the vocabulary is `CALC_WINDOW_FNS`. */
export type CalcWindowFnName = (typeof CALC_WINDOW_FNS)[number];

/** A rolling window is a duration in minutes ending at the tick (`24h` →
 * 1440); a calendar window is the elapsed part of the named period in the
 * owning asset's location's zone. */
export type CalcWindow = { kind: "rolling"; minutes: number } | { kind: "calendar"; period: CalcCalendarWindow };

/** `fn({key}, window)` / `fn({CODE.key}, window)` — `position` is the 0-based
 * offset of the function-name token, as for `call`. `ref` is exactly one
 * point reference, own or qualified, never a scope aggregate (ruling 4); it
 * also joins `refs` / `crossRefs` as the same node would bare. */
export type CalcWindowFn = {
  kind: "window";
  fn: CalcWindowFnName;
  ref: CalcPointRef | CalcQualifiedRef;
  window: CalcWindow;
  position: number;
};

/** `hours(window)` — the elapsed hours the window covers, for prorating a
 * daily baseline. `position` is the function-name token. */
export type CalcHours = { kind: "hours"; window: CalcWindow; position: number };

/** The two node kinds the host must resolve into the fifth map. */
export type CalcWindowRead = CalcWindowFn | CalcHours;

export type CalcExpr =
  | CalcNumber
  | CalcPointRef
  | CalcUnary
  | CalcBinary
  | CalcCall
  | CalcQualifiedRef
  | CalcAggregate
  | CalcParamRef
  | CalcWindowFn
  | CalcHours;

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
  | "unknown_reference"
  // `bms-calc-v2` lexical codes (ADR 0055). Additive — a `v1` call can never
  // produce one, because every `v2` production sits behind a dialect check in
  // the tokenizer.
  | "unknown_scope"
  | "unterminated_string"
  | "empty_string"
  | "malformed_qualified_reference"
  // `bms-calc-v2` parser codes (ADR 0055; `F2.9` Task 2). Same rule: every
  // production that raises one is behind the parser's dialect check.
  | "malformed_scope"
  | "scope_required"
  | "scope_not_allowed"
  | "aggregate_needs_point_reference"
  | "qualified_reference_in_aggregate"
  | "too_many_cross_refs"
  // `bms-calc-v3` lexical code (ADR 0070 decision 4). Same rule again: the
  // `$key` production sits behind the tokenizer's dialect check, so neither a
  // `v1` nor a `v2` call can produce it.
  | "malformed_parameter_reference"
  // `bms-calc-v3` parser code (ADR 0070 decision 4): the `MAX_FORMULA_PARAM_REFS`
  // bound, on the `too_many_cross_refs` pattern.
  | "too_many_param_refs"
  // `bms-calc-v3` window codes (ADR 0070 decision 5; `E4.1b`). Same rule: a
  // `window` token exists only under the window dialect, and every production
  // that raises one of these sits behind the parser's dialect check.
  | "malformed_window"
  | "window_too_long"
  | "window_required"
  | "window_needs_point_reference"
  | "window_over_aggregate"
  | "window_not_allowed"
  | "too_many_windows";

/**
 * `position` is a 0-based character offset into the expression. Never carries
 * source text, a point key, or a function name — a stored formula can be
 * arbitrary pre-authorship content and this error is sometimes surfaced
 * verbatim to a caller (see `formatCalcError`).
 */
export type CalcParseError = { code: CalcErrorCode; position: number };

/**
 * `refs` keeps its `v1` meaning — the LOCAL point keys, deduped, in
 * first-appearance order. `crossRefs` is the `v2` addition: every distinct
 * cross-asset node (by `crossRefKey`), first-appearance order, and always `[]`
 * under `v1` (plan design decision 3). `paramRefs` is the `v3` addition
 * (ADR 0070 decision 4): every distinct `$key`, first-appearance order, and
 * always `[]` under `v1` and `v2`. `windowReads` is the `E4.1b` addition
 * (ADR 0070 decision 5): every distinct window read (by `windowKey`),
 * first-appearance order, always `[]` under `v1` and `v2`; the point inside
 * each read is ALSO in `refs` or `crossRefs`. Four lists, because a local
 * key, a cross reference, a parameter and a window read are served from four
 * different maps at evaluation time.
 */
export type ParseResult =
  | {
      ok: true;
      ast: CalcExpr;
      refs: string[];
      crossRefs: CalcCrossRef[];
      paramRefs: string[];
      windowReads: CalcWindowRead[];
    }
  | { ok: false; errors: CalcParseError[] };
