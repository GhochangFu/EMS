import type { CalcAggregate, CalcQualifiedRef } from "./ast";
import { crossRefKey } from "./cross-ref";
import { CALC_DIALECT_V2 } from "./limits";
import { parseFormula } from "./parser";

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

  assert(crossRefKey(qref("TX_01", "kwh")) === "q:TX_01.kwh", `qref key must be q:TX_01.kwh, got ${crossRefKey(qref("TX_01", "kwh"))}`);
  assert(
    crossRefKey(aggregate("sum", "kw", { kind: "site" })) === "a:sum(kw)@site",
    `site aggregate key must be a:sum(kw)@site, got ${crossRefKey(aggregate("sum", "kw", { kind: "site" }))}`,
  );
  assert(
    crossRefKey(aggregate("sum", "kw", { kind: "group", code: "IT_LOAD" })) === "a:sum(kw)@group:IT_LOAD",
    `group aggregate key must be a:sum(kw)@group:IT_LOAD, got ${crossRefKey(aggregate("sum", "kw", { kind: "group", code: "IT_LOAD" }))}`,
  );
  assert(
    crossRefKey(aggregate("avg", "kw", { kind: "domain", code: "hvac" })) === "a:avg(kw)@domain:hvac",
    `domain aggregate key must be a:avg(kw)@domain:hvac, got ${crossRefKey(aggregate("avg", "kw", { kind: "domain", code: "hvac" }))}`,
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
  // The two forms are disjoint because of the **kind prefix**, and for no other
  // reason. The old argument here — an aggregate key always contains `(`, a
  // qref key introduces none of its own, so the two meet only through a code
  // containing `(`…`)@`, "which no catalog-shaped code does" — was refuted:
  // nothing enforces that charset (the tokenizer admits every character but
  // `{` and `}` inside braces; `bms.assets.code` has no regex at the column or
  // at the write boundary), and `runCrossRefCollisionTests` below shows the
  // collision reached through `parseFormula`. The pool therefore now includes
  // `(`, `)`, `@` and `:` — the exact characters the refuted claim assumed
  // away — so the property is asserted over inputs that would break it if the
  // prefix were removed. The Q1 charset row is still owed, for *resolution*.
  //
  // `.` stays out of the pool: it is the qualified form's own separator.

  const codePool = [
    "TX_01",
    "kw",
    "kwh",
    "a-b",
    "c/d",
    "e f",
    "IT_LOAD",
    "sum",
    "avg",
    "site",
    "group:IT_LOAD",
    "sum(kw)@site",
    "sum(kw)@group:IT_LOAD",
    "(",
    ")@",
    "x)@domain:y",
  ];
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
        assert(key.startsWith("a:"), `every aggregate key must carry the "a:" kind prefix, got ${key}`);
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
      assert(key.startsWith("q:"), `every qref key must carry the "q:" kind prefix, got ${key}`);
      assert(!aggregateKeys.has(key), `qref key ${key} collides with an aggregate key`);
    }
  }
  assert(qrefCount === codePool.length * codePool.length, "anti-vacuity: the qref cross-product must have run");
}

/**
 * **The collision is reachable through the parser, so the key must be
 * injective by construction** (security review of PR 1, MEDIUM).
 *
 * The docblock used to argue the two forms could only meet through a code
 * containing `(`, `)` or `@`, "which no catalog-shaped code does". Nothing in
 * the repository enforces that charset: the tokenizer accepts every character
 * except `{` and `}` inside braces, `bms.assets.code` is
 * `varchar(64).notNull().unique()` with no regex, and the write boundary is
 * `z.string().min(2).max(64)` with no regex either. A claim that rests on a
 * convention nobody enforces is not an invariant.
 *
 * What it costs when it breaks: `dedupeCrossRefs` keeps the first node per key
 * and drops the rest, silently. The dropped node then never reaches
 * `crossRefs`, so PR 2's decision-12 location check never sees it, and at
 * evaluation one key serves both nodes — an aggregate returns one asset's
 * value, or a qualified reference returns a site sum. A wrong number, with
 * nothing counted: the class of failure ADR 0037 decision 9 exists to prevent.
 *
 * The one-character kind prefix makes it structural instead. The pair below is
 * the exact one the reviewer executed.
 */
export function runCrossRefCollisionTests(): void {
  const formula = "{sum(kw)@domain:x.y} + sum({kw} @domain('x.y'))";
  const parsed = parseFormula(formula, { dialect: CALC_DIALECT_V2 });
  assert(parsed.ok, `the colliding pair must parse under ${CALC_DIALECT_V2}, or the case is vacuous`);
  if (!parsed.ok) return;

  assert(
    parsed.crossRefs.length === 2,
    `a qref and an aggregate are two references and must survive the dedupe as two — the ` +
      `dropped one reaches no save-time check and no evaluation-time lookup. Got ` +
      `${parsed.crossRefs.length}: ${parsed.crossRefs.map(crossRefKey).join("|")}`,
  );

  const kinds = parsed.crossRefs.map((node) => node.kind).join("|");
  assert(
    kinds === "qref|aggregate",
    `and both kinds must be present, in first-appearance order. Got: ${kinds}`,
  );

  // The property the prefix buys, stated directly: two nodes of different
  // kinds cannot share a key whatever their codes contain. `q:` and `a:` are
  // the whole of the argument — no charset assumption is left in it.
  const [first, second] = parsed.crossRefs;
  assert(
    first !== undefined && second !== undefined && crossRefKey(first) !== crossRefKey(second),
    `the two keys must differ, got ${first && crossRefKey(first)} and ${second && crossRefKey(second)}`,
  );

  // Deduping still works within a kind — the prefix must not have turned every
  // node into its own entry, which would pass the assertion above vacuously.
  const repeated = parseFormula("sum({kw} @site) + sum({kw} @site)", { dialect: CALC_DIALECT_V2 });
  assert(
    repeated.ok && repeated.crossRefs.length === 1,
    `the same aggregate written twice is still one input, got ${
      repeated.ok ? repeated.crossRefs.length : "a parse failure"
    }`,
  );
}
