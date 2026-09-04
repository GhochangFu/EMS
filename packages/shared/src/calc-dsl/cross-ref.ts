import type { CalcCrossRef, CalcScope } from "./ast";

/**
 * The ONE canonical key for a cross-asset reference (ADR 0055; plan design
 * decision 4). Three consumers build or look up this string and never see
 * each other do it: the parser's `crossRefs` dedupe, the evaluator's
 * `crossInputs` lookup, and the api host that fills `crossInputs` before
 * `evaluate` runs. All three go through this function, so the form is defined
 * exactly once.
 *
 * Forms — each carries its node kind as a one-character prefix:
 * - qualified reference `{TX_01.kwh}` → `q:TX_01.kwh`
 * - aggregate `sum({kw} @site)` → `a:sum(kw)@site`
 * - aggregate `sum({kw} @group('IT_LOAD'))` → `a:sum(kw)@group:IT_LOAD`
 *
 * **The prefix is what makes the key injective, and it is not decoration.**
 * This docblock used to argue that the aggregate form always contains `(`
 * while the qualified form introduces none of its own, so the two could meet
 * only through a code containing `(`, `)` or `@` — "which no catalog-shaped
 * code does". That claim was load-bearing and unsupported: the tokenizer
 * accepts every character except `{` and `}` inside braces, `bms.assets.code`
 * is `varchar(64).notNull().unique()` with no regex, and the write boundary is
 * `z.string().min(2).max(64)`, also with no regex. `parseFormula` on
 * `"{sum(kw)@domain:x.y} + sum({kw} @domain('x.y'))"` returned **one**
 * `crossRef`, not two: `dedupeCrossRefs` dropped the aggregate, so it reached
 * no save-time check and no evaluation-time lookup, and one key served both
 * nodes. Discriminating on the kind removes the charset from the argument
 * entirely — two nodes of different kinds cannot collide whatever their codes
 * contain.
 *
 * Within a kind, injectivity still rests on the grammar: a qref key splits at
 * the first `.` (the plan's Q1 ruling), and an aggregate key's `(`, `)@` and
 * `:` come from the production rather than from the code. The Q1 charset row
 * is still owed — it is what settles *resolution*, i.e. which asset or group a
 * code names — and this prefix does not discharge it.
 *
 * `position` is deliberately not part of the key: the same reference at two
 * offsets is one input.
 */
export function crossRefKey(node: CalcCrossRef): string {
  if (node.kind === "qref") {
    return `q:${node.assetCode}.${node.pointKey}`;
  }
  return `a:${node.fn}(${node.pointKey})@${scopeKey(node.scope)}`;
}

function scopeKey(scope: CalcScope): string {
  return scope.kind === "site" ? "site" : `${scope.kind}:${scope.code}`;
}
