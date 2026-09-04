import type { CalcExpr } from "./ast";
import { evaluate } from "./evaluate";
import { CALC_DIALECT_V2, CALC_FUNCTION_ARITY } from "./limits";
import { parseFormula } from "./parser";
import { V1_CORPUS, V1_REFUSALS_V2_ACCEPTS } from "./v1-corpus";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * ADR 0055 decision 4 — `bms-calc-v2` is a strict superset of `bms-calc-v1`:
 * every expression that PARSES under `v1` parses under `v2` and evaluates to
 * the same number. This is `F2.9` PR 1's single most important test, because
 * decision 3 freezes `v1`'s meaning forever and this is what proves the `v2`
 * work did not move it. The property is held structurally (every `v2`
 * production is an added branch behind a dialect check — see the docblocks
 * on `tokenize` and `Parser`); this test is the tripwire, not the guarantee.
 *
 * **The property is directional.** It says nothing about a `v1` refusal — a
 * `v1` refusal becoming legal `v2` syntax is exactly what "superset" means.
 * `runDialectSupersetTests`'s generator only ever emits `v1`-grammar text
 * (never `@`, `'`, or `.`), so its refusals are v1-grammar-shaped (bad arity,
 * too many refs, too deep, …) and are asserted to refuse IDENTICALLY under
 * both dialects — a stronger check than the property requires, valid here
 * because nothing in the generator's alphabet can reach a `v2`-only branch.
 * The `v1-corpus.ts` check below is weaker and correct: it only requires
 * agreement when `v1` parses, with one named, deliberate exception.
 *
 * **Ref-pool scope (design decision 10; ADR 0055 Q1).** The pool below
 * includes `-`, `/` and a space — all legal `v1` point-key characters
 * (`tokenizer.spec.ts` proves `{a.b-c/d e}` tokenizes intact as one `v1`
 * ref). It excludes `.`, because `v2`'s qualified-reference form splits a
 * `{…}` body at the FIRST `.`, so a `v1` point key containing `.` would
 * change meaning under `v2` — no seeded or stock catalog code has one
 * (design decision 10), and this test proves the superset property only for
 * point keys WITHOUT a dot. It also excludes `{` and `}`, which the
 * tokenizer's brace scanner treats as a reference terminator under both
 * dialects (irrelevant to the property, and they only inflate the refusal
 * count against the anti-vacuity floor). A pool of `[a-z0-9_]` alone would
 * make the mutation this task's build gate requires (§below) survive
 * undetected — the whole point of this test.
 */

const SEED = 0xf2_9c;
const N = 2000;
const MAX_DEPTH = 12;

const REF_POOL: readonly string[] = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k1",
  "k2",
  "k3",
  "k4",
  "k5",
  "k6",
  "k7",
  "k8",
  "k9",
  "k10",
  "sub-meter",
  "chw/flow",
  "total kwh",
  "aux-power",
  "line/1",
  "m11",
  "m12",
  "m13",
  "m14",
  "m15",
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function genNumber(rng: () => number): string {
  const intPart = Math.floor(rng() * 1000);
  if (rng() < 0.4) {
    return String(intPart);
  }
  const digits = 1 + Math.floor(rng() * 3);
  const frac = Math.floor(rng() * 10 ** digits)
    .toString()
    .padStart(digits, "0");
  return `${intPart}.${frac}`;
}

function genRef(rng: () => number): string {
  return `{${pick(rng, REF_POOL)}}`;
}

type GenCtx = { rng: () => number; nodeBudget: { n: number } };

const FUNCTION_NAMES = Object.keys(CALC_FUNCTION_ARITY) as (keyof typeof CALC_FUNCTION_ARITY)[];

/** Builds one random `v1`-grammar expression string. `depth` bounds
 * recursion (≤ 12, per this task's spec); `ctx.nodeBudget` additionally
 * bounds total node count, so a large budget occasionally produces enough
 * distinct refs to exceed `MAX_FORMULA_POINT_REFS` (the anti-vacuity
 * refusal floor) without every expression doing so. */
function genFactor(ctx: GenCtx, depth: number): string {
  ctx.nodeBudget.n -= 1;
  const forceLeaf = depth <= 0 || ctx.nodeBudget.n <= 0;
  const r = ctx.rng();

  if (forceLeaf) {
    return r < 0.5 ? genNumber(ctx.rng) : genRef(ctx.rng);
  }
  if (r < 0.2) {
    return genNumber(ctx.rng);
  }
  if (r < 0.48) {
    return genRef(ctx.rng);
  }
  if (r < 0.6) {
    return `-(${genFactor(ctx, depth - 1)})`;
  }
  if (r < 0.85) {
    const op = pick(ctx.rng, ["+", "-", "*", "/"] as const);
    const left = genFactor(ctx, depth - 1);
    const right = genFactor(ctx, depth - 1);
    return `(${left} ${op} ${right})`;
  }

  const fn = pick(ctx.rng, FUNCTION_NAMES);
  const arity = CALC_FUNCTION_ARITY[fn];
  const argc = arity.min + Math.floor(ctx.rng() * (arity.max - arity.min + 1));
  const args: string[] = [];
  for (let i = 0; i < argc; i += 1) {
    args.push(genFactor(ctx, depth - 1));
  }
  return `${fn}(${args.join(", ")})`;
}

function genExpression(rng: () => number): string {
  const nodeBudget = { n: 3 + Math.floor(rng() * 120) };
  return genFactor({ rng, nodeBudget }, MAX_DEPTH);
}

/** Walks a `v1`-shaped `CalcExpr` (never `qref`/`aggregate` — the generator's
 * alphabet cannot produce either) counting occurrences by `kind`, for the
 * "every production shape appeared" anti-vacuity check. */
function countKinds(node: CalcExpr, counts: Record<string, number>): void {
  counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  if (node.kind === "unary") {
    countKinds(node.operand, counts);
  } else if (node.kind === "binary") {
    countKinds(node.left, counts);
    countKinds(node.right, counts);
  } else if (node.kind === "call") {
    node.args.forEach((arg) => countKinds(arg, counts));
  }
}

/** A random input map over `refs`: values in ±1e3, a 5 % chance a key is
 * missing entirely, and a 5 % chance it is exactly `0` — both edge cases the
 * evaluator treats specially (`missing_input`; `-0` normalisation). */
function randomInputs(rng: () => number, refs: readonly string[]): Map<string, number> {
  const inputs = new Map<string, number>();
  for (const key of refs) {
    const r = rng();
    if (r < 0.05) {
      continue;
    }
    if (r < 0.1) {
      inputs.set(key, 0);
      continue;
    }
    inputs.set(key, rng() * 2000 - 1000);
  }
  return inputs;
}

/** Asserts the same outcome (value, or `{code, position}`) evaluating `v1Ast`
 * and `v2Ast` over the same `inputs` — near-tautological once `v1Ast` and
 * `v2Ast` are already asserted `JSON.stringify`-equal (the evaluator reads
 * only the AST and the maps), but it is cheap and it also catches
 * non-determinism in `evaluate` itself. */
function assertSameEvaluation(v1Ast: CalcExpr, v2Ast: CalcExpr, inputs: Map<string, number>, label: string): void {
  const r1 = evaluate(v1Ast, inputs);
  const r2 = evaluate(v2Ast, inputs);
  assert(r1.ok === r2.ok, `${label}: evaluate ok must agree, got ${JSON.stringify(r1)} vs ${JSON.stringify(r2)}`);
  if (r1.ok && r2.ok) {
    assert(Object.is(r1.value, r2.value), `${label}: evaluate value must be Object.is-equal, got ${r1.value} vs ${r2.value}`);
  } else if (!r1.ok && !r2.ok) {
    assert(
      r1.code === r2.code && r1.position === r2.position,
      `${label}: evaluate refusal must match, got ${JSON.stringify(r1)} vs ${JSON.stringify(r2)}`,
    );
  }
}

/**
 * The seeded generator: `N = 2000` random `v1`-grammar expressions, each
 * checked for dialect agreement, structural equality when both accept, and
 * matching evaluation.
 */
function runGeneratedCorpus(rng: () => number): void {
  let okCount = 0;
  let refusalCount = 0;
  const kindCounts: Record<string, number> = { number: 0, ref: 0, unary: 0, binary: 0, call: 0 };

  for (let i = 0; i < N; i += 1) {
    const expr = genExpression(rng);
    const v1 = parseFormula(expr);
    const v2 = parseFormula(expr, { dialect: CALC_DIALECT_V2 });

    assert(
      v1.ok === v2.ok,
      `generated expression #${i} broke dialect agreement on ok: ${JSON.stringify(expr)} — v1 ${v1.ok}, v2 ${v2.ok}`,
    );

    if (v1.ok && v2.ok) {
      okCount += 1;
      assert(JSON.stringify(v1.ast) === JSON.stringify(v2.ast), `generated #${i} AST mismatch: ${JSON.stringify(expr)}`);
      assert(v1.refs.join(",") === v2.refs.join(","), `generated #${i} refs mismatch: ${JSON.stringify(expr)}`);
      assert(v2.crossRefs.length === 0, `generated #${i}: a v1-grammar expression must carry no crossRefs under v2`);
      countKinds(v1.ast, kindCounts);
      const inputs = randomInputs(rng, v1.refs);
      assertSameEvaluation(v1.ast, v2.ast, inputs, `generated #${i} (${JSON.stringify(expr)})`);
    } else if (!v1.ok && !v2.ok) {
      refusalCount += 1;
      // The generator's alphabet never touches a v2-only branch (no `@`,
      // `'`, `.`), so a v1-grammar refusal must refuse IDENTICALLY under v2
      // — a stronger check than decision 4 requires, and valid here only
      // because of that alphabet restriction (see module docblock).
      assert(
        v1.errors[0].code === v2.errors[0].code && v1.errors[0].position === v2.errors[0].position,
        `generated #${i} refusal mismatch: ${JSON.stringify(expr)} — v1 ${JSON.stringify(v1.errors[0])}, v2 ${JSON.stringify(v2.errors[0])}`,
      );
    }
  }

  // ---- anti-vacuity ----------------------------------------------------
  assert(okCount >= 1000, `expected >= 1000 ok generated expressions, got ${okCount}`);
  assert(refusalCount >= 100, `expected >= 100 refusals, got ${refusalCount}`);
  for (const kind of ["number", "ref", "unary", "binary", "call"]) {
    assert((kindCounts[kind] ?? 0) > 0, `production shape "${kind}" never appeared across ${N} generated expressions`);
  }
}

/**
 * Re-runs every literal in `v1-corpus.ts` under both dialects. Weaker than
 * `runGeneratedCorpus`'s check, and correctly so: the property is
 * directional (see module docblock), so a corpus entry that REFUSES under
 * `v1` is only required to refuse identically under `v2` UNLESS it is named
 * in `V1_REFUSALS_V2_ACCEPTS`, in which case `v2` must accept it.
 */
function runV1CorpusChecks(rng: () => number): void {
  let checkedOk = 0;
  let checkedRefusal = 0;
  let checkedException = 0;

  for (const expr of V1_CORPUS) {
    const v1 = parseFormula(expr);
    const v2 = parseFormula(expr, { dialect: CALC_DIALECT_V2 });
    const isException = V1_REFUSALS_V2_ACCEPTS.includes(expr);

    if (v1.ok) {
      checkedOk += 1;
      assert(v2.ok === true, `corpus entry parses under v1 but not v2: ${JSON.stringify(expr)}`);
      if (v2.ok) {
        assert(JSON.stringify(v1.ast) === JSON.stringify(v2.ast), `corpus AST mismatch: ${JSON.stringify(expr)}`);
        assert(v1.refs.join(",") === v2.refs.join(","), `corpus refs mismatch: ${JSON.stringify(expr)}`);
        assert(v2.crossRefs.length === 0, `corpus entry must carry no crossRefs under v2: ${JSON.stringify(expr)}`);
        const inputs = randomInputs(rng, v1.refs);
        assertSameEvaluation(v1.ast, v2.ast, inputs, `corpus (${JSON.stringify(expr)})`);
      }
    } else if (isException) {
      checkedException += 1;
      assert(v2.ok === true, `${JSON.stringify(expr)} is listed as a named v1-refusal/v2-acceptance but v2 also refused it`);
    } else {
      checkedRefusal += 1;
      assert(
        v2.ok === false,
        `unexpected dialect flip: ${JSON.stringify(expr)} refuses under v1 and parses under v2, but is not in V1_REFUSALS_V2_ACCEPTS`,
      );
      if (!v1.ok && !v2.ok) {
        assert(
          v1.errors[0].code === v2.errors[0].code && v1.errors[0].position === v2.errors[0].position,
          `corpus refusal mismatch: ${JSON.stringify(expr)}`,
        );
      }
    }
  }

  assert(checkedOk > 0, "the v1 corpus produced no ok entries — the corpus or the extraction is broken");
  assert(checkedRefusal > 0, "the v1 corpus produced no ordinary refusals — the corpus or the extraction is broken");
  assert(
    checkedException === V1_REFUSALS_V2_ACCEPTS.length,
    "every named exception in V1_REFUSALS_V2_ACCEPTS must actually appear, refuse under v1, and be found in the corpus",
  );
}

export function runDialectSupersetTests(): void {
  const rng = mulberry32(SEED);
  runGeneratedCorpus(rng);
  runV1CorpusChecks(rng);
}
