import type { CalcCrossRef, CalcScope } from "./ast";

/**
 * The ONE canonical key for a cross-asset reference (ADR 0055; plan design
 * decision 4). Three consumers build or look up this string and never see
 * each other do it: the parser's `crossRefs` dedupe, the evaluator's
 * `crossInputs` lookup, and the api host that fills `crossInputs` before
 * `evaluate` runs. All three go through this function, so the form is defined
 * exactly once.
 *
 * Forms:
 * - qualified reference `{TX_01.kwh}` → `TX_01.kwh`
 * - aggregate `sum({kw} @site)` → `sum(kw)@site`
 * - aggregate `sum({kw} @group('IT_LOAD'))` → `sum(kw)@group:IT_LOAD`
 *
 * The aggregate form always contains `(`; the qualified form introduces none
 * of its own. The two can therefore meet only through an asset code or point
 * key that itself contains `(`…`)@`, which no catalog-shaped code does — the
 * charset row the plan's Q1 ruling names makes that structural. `position`
 * is deliberately not part of the key: the same reference at two offsets is
 * one input.
 */
export function crossRefKey(node: CalcCrossRef): string {
  if (node.kind === "qref") {
    return `${node.assetCode}.${node.pointKey}`;
  }
  return `${node.fn}(${node.pointKey})@${scopeKey(node.scope)}`;
}

function scopeKey(scope: CalcScope): string {
  return scope.kind === "site" ? "site" : `${scope.kind}:${scope.code}`;
}
