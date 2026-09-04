import type { CalcAggregate, CalcQualifiedRef } from "./ast";
import { crossRefKey } from "./cross-ref";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const qref = (assetCode: string, pointKey: string): CalcQualifiedRef => ({
  kind: "qref",
  assetCode,
  pointKey,
  position: 0,
});

const aggregate = (
  fn: CalcAggregate["fn"],
  pointKey: string,
  scope: CalcAggregate["scope"],
): CalcAggregate => ({ kind: "aggregate", fn, pointKey, scope, position: 0 });

/**
 * `crossRefKey` is the one canonical key shared by the parser's dedupe, the
 * evaluator's `crossInputs` lookup and (PR 2) the api host that fills that
 * map. Three consumers agree on a string they never see each other build, so
 * the exact forms are pinned here rather than left to each caller's memory.
 */
export function runCrossRefKeyTests(): void {
  // ---- 1. the three canonical forms, as the plan states them ------------------

  assert(crossRefKey(qref("TX_01", "kwh")) === "TX_01.kwh", `qref key must be TX_01.kwh, got ${crossRefKey(qref("TX_01", "kwh"))}`);
  assert(
    crossRefKey(aggregate("sum", "kw", { kind: "site" })) === "sum(kw)@site",
    `site aggregate key must be sum(kw)@site, got ${crossRefKey(aggregate("sum", "kw", { kind: "site" }))}`,
  );
  assert(
    crossRefKey(aggregate("sum", "kw", { kind: "group", code: "IT_LOAD" })) === "sum(kw)@group:IT_LOAD",
    `group aggregate key must be sum(kw)@group:IT_LOAD, got ${crossRefKey(aggregate("sum", "kw", { kind: "group", code: "IT_LOAD" }))}`,
  );
  assert(
    crossRefKey(aggregate("avg", "kw", { kind: "domain", code: "hvac" })) === "avg(kw)@domain:hvac",
    `domain aggregate key must be avg(kw)@domain:hvac, got ${crossRefKey(aggregate("avg", "kw", { kind: "domain", code: "hvac" }))}`,
  );

  // ---- 2. every field is load-bearing — nodes differing in one field differ in key

  const base = aggregate("sum", "kw", { kind: "group", code: "IT_LOAD" });
  const variants: { label: string; node: CalcAggregate }[] = [
    { label: "scope code", node: aggregate("sum", "kw", { kind: "group", code: "IT_LOAD_2" }) },
    { label: "scope kind", node: aggregate("sum", "kw", { kind: "domain", code: "IT_LOAD" }) },
    { label: "function", node: aggregate("avg", "kw", { kind: "group", code: "IT_LOAD" }) },
    { label: "point key", node: aggregate("sum", "kwh", { kind: "group", code: "IT_LOAD" }) },
  ];
  for (const { label, node } of variants) {
    assert(crossRefKey(node) !== crossRefKey(base), `two aggregates differing only in ${label} must not share a key`);
  }
  assert(crossRefKey(qref("TX_01", "kwh")) !== crossRefKey(qref("TX_02", "kwh")), "qrefs differing in asset code must differ");
  assert(crossRefKey(qref("TX_01", "kwh")) !== crossRefKey(qref("TX_01", "kw")), "qrefs differing in point key must differ");

  // ---- 3. position never reaches the key — the same reference at two offsets is one entry

  assert(
    crossRefKey({ ...base, position: 40 }) === crossRefKey(base),
    "position must not be part of the key, or the parser's dedupe would never fire",
  );

  // ---- 4. a qref key and an aggregate key cannot coincide ----------------------
  //
  // The two FORMS are disjoint by construction: an aggregate key always
  // contains `(` (it is `fn(` + key + `)@` + scope), and a qref key is
  // `assetCode.pointKey`, which introduces no `(` of its own. So the only way
  // the two could meet is an asset code or point key that itself contains
  // `(`…`)@`. Catalog-shaped codes never do, and the follow-up row the plan's
  // Q1 ruling names constrains the charset; until then this holds over every
  // code without a `(`, which is every real one. Asserted over a pool that
  // includes every legal `v1` key character except `.` (the qualified
  // separator) so the check is not vacuous on `[a-z_]` alone.

  const codePool = ["TX_01", "kw", "kwh", "a-b", "c/d", "e f", "IT_LOAD", "sum", "avg", "site", "group:IT_LOAD"];
  const scopes: CalcAggregate["scope"][] = [
    { kind: "site" },
    { kind: "group", code: "IT_LOAD" },
    { kind: "domain", code: "hvac" },
    { kind: "group", code: "a.b" },
  ];
  const aggregateKeys = new Set<string>();
  for (const fn of ["sum", "avg"] as const) {
    for (const pointKey of codePool) {
      for (const scope of scopes) {
        const key = crossRefKey(aggregate(fn, pointKey, scope));
        assert(key.includes("("), `every aggregate key must contain "(", got ${key}`);
        aggregateKeys.add(key);
      }
    }
  }
  assert(aggregateKeys.size === 2 * codePool.length * scopes.length, "aggregate keys must be pairwise distinct over the pool");

  let qrefCount = 0;
  for (const assetCode of codePool) {
    for (const pointKey of codePool) {
      const key = crossRefKey(qref(assetCode, pointKey));
      qrefCount += 1;
      assert(!key.includes("("), `a qref key over catalog-shaped codes must not contain "(", got ${key}`);
      assert(!aggregateKeys.has(key), `qref key ${key} collides with an aggregate key`);
    }
  }
  assert(qrefCount === codePool.length * codePool.length, "anti-vacuity: the qref cross-product must have run");
}
