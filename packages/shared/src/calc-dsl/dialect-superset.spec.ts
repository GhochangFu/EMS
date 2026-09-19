import type { CalcCrossRef, CalcExpr } from "./ast";
import { crossRefKey } from "./cross-ref";
import { evaluate } from "./evaluate";
import { CALC_AGGREGATE_FNS, CALC_DIALECT_V2, CALC_DIALECT_V3, CALC_FUNCTION_ARITY, type CalcDialect } from "./limits";
import { parseFormula, type ParseOptions } from "./parser";
import { V1_CORPUS, V1_REFUSALS_V2_ACCEPTS, V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE } from "./v1-corpus";
import { V2_CORPUS, V2_REFUSALS_V3_ACCEPTS, V2_REFUSALS_WITH_A_DIFFERENT_V3_CODE } from "./v2-corpus";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * ADR 0055 decision 4 and ADR 0070 decision 3 — each `bms-calc` dialect is a
 * strict superset of its predecessor: `v2` over `v1`, and `v3` over `v2`.
 * Every expression that PARSES under the narrower dialect parses under the
 * wider one and evaluates to the same number. `E4.1a` U3 generalises what was
 * originally one `(v1, v2)` check into three pairwise checks —
 * `(v1, v2)`, `(v1, v3)` and `(v2, v3)` — so the transitive claim ("a `v1`
 * formula also means the same thing under `v3`") is checked directly rather
 * than assumed from the other two.
 *
 * **`(v1, v2)` is byte-identical to the original test**: same seed, same `N`,
 * same pool, same assertions — `runPairForNarrowGrammar` is called with the
 * exact generator, corpus and exception lists `F2.9` wrote, and nothing about
 * that pair is weakened by the generalisation.
 *
 * **The property is directional**, exactly as before: it says nothing about a
 * refusal under the narrower dialect becoming legal wider syntax — that is
 * what "superset" means. `V1_REFUSALS_V2_ACCEPTS` / `V2_REFUSALS_V3_ACCEPTS`
 * name the deliberate exceptions; `V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE` /
 * `V2_REFUSALS_WITH_A_DIFFERENT_V3_CODE` name the entries whose refusal is
 * decided *inside* a dialect-gated branch, so the two codes must be pinned,
 * not merely required to differ.
 *
 * **`paramRefs` is asserted `[]` under the wide dialect for every ok
 * result**, on all three pairs. `(v1, v2)`'s generator and corpus never
 * contained a `v2` production either, so that assertion was vacuously true
 * there already; it is meaningful for `(v1, v3)` and `(v2, v3)`, where the
 * generator's alphabet is proven, not merely declared, to contain no `$`.
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

/**
 * `v2`-grammar additions to the pool: asset codes and scope codes, both drawn
 * from inside `^[A-Za-z0-9_-]+$` (ADR 0065) — deliberately narrower than
 * `REF_POOL` above, which over-approximates on purpose (module docblock,
 * unchanged). No entry contains `$`, `.`, `{` or `}` — the alphabet this test
 * exists to prove is `v3`-safe.
 */
const CODE_POOL: readonly string[] = [
  "TX_01",
  "TX_02",
  "IT_LOAD",
  "SITE-A",
  "site_b",
  "CODE1",
  "code-2",
  "A1",
  "Feeder_9",
  "hvac-1",
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
 * refusal floor) without every expression doing so. Unchanged from the
 * original `(v1, v2)` test — reused verbatim for `(v1, v3)` too. */
function genFactorV1(ctx: GenCtx, depth: number): string {
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
    return `-(${genFactorV1(ctx, depth - 1)})`;
  }
  if (r < 0.85) {
    const op = pick(ctx.rng, ["+", "-", "*", "/"] as const);
    const left = genFactorV1(ctx, depth - 1);
    const right = genFactorV1(ctx, depth - 1);
    return `(${left} ${op} ${right})`;
  }

  const fn = pick(ctx.rng, FUNCTION_NAMES);
  const arity = CALC_FUNCTION_ARITY[fn];
  const argc = arity.min + Math.floor(ctx.rng() * (arity.max - arity.min + 1));
  const args: string[] = [];
  for (let i = 0; i < argc; i += 1) {
    args.push(genFactorV1(ctx, depth - 1));
  }
  return `${fn}(${args.join(", ")})`;
}

function genExpressionV1(rng: () => number): string {
  const nodeBudget = { n: 3 + Math.floor(rng() * 120) };
  return genFactorV1({ rng, nodeBudget }, MAX_DEPTH);
}

// ---- v2-grammar generator (for the (v2, v3) pair) --------------------------

function genScope(rng: () => number): string {
  const r = rng();
  if (r < 0.34) {
    return "@site";
  }
  if (r < 0.67) {
    return `@domain('${pick(rng, CODE_POOL)}')`;
  }
  return `@group('${pick(rng, CODE_POOL)}')`;
}

function genQualifiedRef(rng: () => number): string {
  return `{${pick(rng, CODE_POOL)}.${pick(rng, REF_POOL)}}`;
}

function genAggregate(rng: () => number): string {
  const fn = pick(rng, CALC_AGGREGATE_FNS);
  return `${fn}({${pick(rng, REF_POOL)}} ${genScope(rng)})`;
}

/** As `genFactorV1`, plus the two `v2` leaf productions (qualified reference,
 * aggregate) behind `includeV2`. No branch here can ever emit `$` — the
 * property `(v2, v3)`'s corpus check exists to state precisely. */
function genFactorWide(ctx: GenCtx, depth: number, includeV2: boolean): string {
  ctx.nodeBudget.n -= 1;
  const forceLeaf = depth <= 0 || ctx.nodeBudget.n <= 0;
  const r = ctx.rng();

  if (forceLeaf) {
    if (includeV2 && r < 0.3) {
      return ctx.rng() < 0.5 ? genQualifiedRef(ctx.rng) : genAggregate(ctx.rng);
    }
    return r < 0.65 ? genNumber(ctx.rng) : genRef(ctx.rng);
  }
  if (includeV2 && r < 0.12) {
    return genAggregate(ctx.rng);
  }
  if (includeV2 && r < 0.22) {
    return genQualifiedRef(ctx.rng);
  }
  if (r < 0.36) {
    return genNumber(ctx.rng);
  }
  if (r < 0.56) {
    return genRef(ctx.rng);
  }
  if (r < 0.66) {
    return `-(${genFactorWide(ctx, depth - 1, includeV2)})`;
  }
  if (r < 0.88) {
    const op = pick(ctx.rng, ["+", "-", "*", "/"] as const);
    const left = genFactorWide(ctx, depth - 1, includeV2);
    const right = genFactorWide(ctx, depth - 1, includeV2);
    return `(${left} ${op} ${right})`;
  }

  const fn = pick(ctx.rng, FUNCTION_NAMES);
  const arity = CALC_FUNCTION_ARITY[fn];
  const argc = arity.min + Math.floor(ctx.rng() * (arity.max - arity.min + 1));
  const args: string[] = [];
  for (let i = 0; i < argc; i += 1) {
    args.push(genFactorWide(ctx, depth - 1, includeV2));
  }
  return `${fn}(${args.join(", ")})`;
}

function genExpressionV2Grammar(rng: () => number): string {
  const nodeBudget = { n: 3 + Math.floor(rng() * 120) };
  return genFactorWide({ rng, nodeBudget }, MAX_DEPTH, true);
}

/** Walks a `CalcExpr` counting occurrences by `kind`, for the "every
 * production shape appeared" anti-vacuity check. Extended for `E4.1a` U3 with
 * `"param"` and `"qref"` — the two kinds `assertNever` in `parser.ts` forces
 * every exhaustive consumer to decide about; this function is a plain
 * if/else, not a `switch`, so the extension is not compiler-forced, but it is
 * made explicit here rather than left to fall through silently. No generator
 * in this file ever emits a `param` node — the `paramRefs === []` assertions
 * below are what prove that, not this counter — so `counts.param` is expected
 * to stay `0` and is never asserted `> 0`. `E4.1b` U6 extends it again with
 * `"window"` and `"hours"` — no generator in this file ever emits a window
 * token (ADR 0070 decision 2 gates it on `isWindowDialect`), so both stay `0`
 * for the same reason `param` does, and are never asserted `> 0` either. */
function countKinds(node: CalcExpr, counts: Record<string, number>): void {
  counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  if (node.kind === "unary") {
    countKinds(node.operand, counts);
  } else if (node.kind === "binary") {
    countKinds(node.left, counts);
    countKinds(node.right, counts);
  } else if (node.kind === "call") {
    node.args.forEach((arg) => countKinds(arg, counts));
  } else if (node.kind === "window") {
    countKinds(node.ref, counts);
  }
  // "number", "ref", "qref", "aggregate", "param" and "hours" carry no
  // CalcExpr children — nothing further to walk.
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

/** As `randomInputs`, keyed by `crossRefKey` over a list of cross-asset
 * nodes — the map shape the host builds for `evaluate`'s third argument. */
function randomCrossInputs(rng: () => number, crossRefs: readonly CalcCrossRef[]): Map<string, number> {
  const inputs = new Map<string, number>();
  for (const node of crossRefs) {
    const r = rng();
    const key = crossRefKey(node);
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

/** Asserts the same outcome (value, or `{code, position}`) evaluating
 * `narrowAst` and `wideAst` over the same `inputs`/`crossInputs` — near-
 * tautological once the two ASTs are already asserted `JSON.stringify`-equal
 * (the evaluator reads only the AST and the maps), but it is cheap and it
 * also catches non-determinism in `evaluate` itself. */
function assertSameEvaluation(
  narrowAst: CalcExpr,
  wideAst: CalcExpr,
  inputs: Map<string, number>,
  crossInputs: Map<string, number>,
  label: string,
): void {
  const r1 = evaluate(narrowAst, inputs, crossInputs);
  const r2 = evaluate(wideAst, inputs, crossInputs);
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
 * The seeded generator, generalised over a `(narrow, wide)` dialect pair and
 * a `generate` function. `N = 2000` random expressions, each checked for
 * dialect agreement, structural equality when both accept, and matching
 * evaluation. Called once per pair, each with its own freshly-seeded `rng`
 * (`mulberry32(SEED)`), so the `(v1, v2)` call below consumes the RNG in
 * exactly the sequence the original, single-pair test did — byte-identical.
 */
function runGeneratedCorpus(
  rng: () => number,
  narrow: CalcDialect | undefined,
  wide: CalcDialect,
  generate: (rng: () => number) => string,
  pairLabel: string,
): void {
  let okCount = 0;
  let refusalCount = 0;
  const kindCounts: Record<string, number> = {
    number: 0,
    ref: 0,
    unary: 0,
    binary: 0,
    call: 0,
    qref: 0,
    aggregate: 0,
    param: 0,
    window: 0,
    hours: 0,
  };

  const narrowOptions: ParseOptions | undefined = narrow === undefined ? undefined : { dialect: narrow };
  const wideOptions: ParseOptions = { dialect: wide };

  for (let i = 0; i < N; i += 1) {
    const expr = generate(rng);
    const narrowResult = parseFormula(expr, narrowOptions);
    const wideResult = parseFormula(expr, wideOptions);

    assert(
      narrowResult.ok === wideResult.ok,
      `${pairLabel} generated expression #${i} broke dialect agreement on ok: ${JSON.stringify(expr)} — narrow ${narrowResult.ok}, wide ${wideResult.ok}`,
    );

    if (narrowResult.ok && wideResult.ok) {
      okCount += 1;
      assert(
        JSON.stringify(narrowResult.ast) === JSON.stringify(wideResult.ast),
        `${pairLabel} generated #${i} AST mismatch: ${JSON.stringify(expr)}`,
      );
      assert(
        narrowResult.refs.join(",") === wideResult.refs.join(","),
        `${pairLabel} generated #${i} refs mismatch: ${JSON.stringify(expr)}`,
      );
      assert(
        JSON.stringify(narrowResult.crossRefs) === JSON.stringify(wideResult.crossRefs),
        `${pairLabel} generated #${i} crossRefs mismatch: ${JSON.stringify(expr)}`,
      );
      assert(
        wideResult.paramRefs.length === 0,
        `${pairLabel} generated #${i}: the generator's alphabet contains no $, so paramRefs must be [] under the wide dialect: ${JSON.stringify(expr)}`,
      );
      countKinds(narrowResult.ast, kindCounts);
      const inputs = randomInputs(rng, narrowResult.refs);
      const crossInputs = randomCrossInputs(rng, wideResult.crossRefs);
      assertSameEvaluation(narrowResult.ast, wideResult.ast, inputs, crossInputs, `${pairLabel} generated #${i} (${JSON.stringify(expr)})`);
    } else if (!narrowResult.ok && !wideResult.ok) {
      refusalCount += 1;
      // The generator's alphabet never touches a production exclusive to a
      // dialect strictly between narrow and wide, so a narrow-grammar refusal
      // must refuse IDENTICALLY under wide too — a stronger check than the
      // superset property requires, and valid here only because of that
      // alphabet restriction (see module docblock).
      assert(
        narrowResult.errors[0].code === wideResult.errors[0].code && narrowResult.errors[0].position === wideResult.errors[0].position,
        `${pairLabel} generated #${i} refusal mismatch: ${JSON.stringify(expr)} — narrow ${JSON.stringify(narrowResult.errors[0])}, wide ${JSON.stringify(wideResult.errors[0])}`,
      );
    }
  }

  // ---- anti-vacuity ----------------------------------------------------
  assert(okCount >= 1000, `${pairLabel}: expected >= 1000 ok generated expressions, got ${okCount}`);
  assert(refusalCount >= 100, `${pairLabel}: expected >= 100 refusals, got ${refusalCount}`);
  const requiredKinds = ["number", "ref", "unary", "binary", "call"];
  for (const kind of requiredKinds) {
    assert((kindCounts[kind] ?? 0) > 0, `${pairLabel}: production shape "${kind}" never appeared across ${N} generated expressions`);
  }
  if (pairLabel === "(v2, v3)") {
    for (const kind of ["qref", "aggregate"]) {
      assert((kindCounts[kind] ?? 0) > 0, `${pairLabel}: v2 production shape "${kind}" never appeared across ${N} generated expressions`);
    }
  }
}

type DifferentCodeEntry = { readonly expression: string; readonly narrowCode: string; readonly wideCode: string };

/** `V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE` and
 * `V2_REFUSALS_WITH_A_DIFFERENT_V3_CODE` name their two codes `v1Code`/`v2Code`
 * and `v2Code`/`v3Code` respectively — this pairwise runner's own field names
 * are dialect-agnostic (`narrowCode`/`wideCode`), so each corpus's list is
 * mapped once here rather than the runner reading a differently-shaped object
 * per pair. */
function asDifferentCodeEntries<T extends { readonly expression: string }>(
  entries: readonly T[],
  narrowCode: (entry: T) => string,
  wideCode: (entry: T) => string,
): DifferentCodeEntry[] {
  return entries.map((entry) => ({ expression: entry.expression, narrowCode: narrowCode(entry), wideCode: wideCode(entry) }));
}

/**
 * Re-runs every literal in `corpus` under both dialects of the pair. Weaker
 * than `runGeneratedCorpus`'s check, and correctly so: the property is
 * directional (see module docblock), so a corpus entry that REFUSES under the
 * narrow dialect is only required to refuse identically under wide UNLESS it
 * is named in `refusalsWideAccepts`, in which case wide must accept it.
 */
function runCorpusChecks(
  rng: () => number,
  corpus: readonly string[],
  narrow: CalcDialect | undefined,
  wide: CalcDialect,
  refusalsWideAccepts: readonly string[],
  refusalsDifferentCode: readonly DifferentCodeEntry[],
  pairLabel: string,
): void {
  let checkedOk = 0;
  let checkedRefusal = 0;
  let checkedException = 0;
  let checkedDifferentCode = 0;

  const narrowOptions: ParseOptions | undefined = narrow === undefined ? undefined : { dialect: narrow };
  const wideOptions: ParseOptions = { dialect: wide };

  for (const expr of corpus) {
    const narrowResult = parseFormula(expr, narrowOptions);
    const wideResult = parseFormula(expr, wideOptions);
    const isException = refusalsWideAccepts.includes(expr);
    const differentCode = refusalsDifferentCode.find((entry) => entry.expression === expr);

    if (narrowResult.ok) {
      checkedOk += 1;
      assert(wideResult.ok === true, `${pairLabel} corpus entry parses under narrow but not wide: ${JSON.stringify(expr)}`);
      if (wideResult.ok) {
        assert(JSON.stringify(narrowResult.ast) === JSON.stringify(wideResult.ast), `${pairLabel} corpus AST mismatch: ${JSON.stringify(expr)}`);
        assert(narrowResult.refs.join(",") === wideResult.refs.join(","), `${pairLabel} corpus refs mismatch: ${JSON.stringify(expr)}`);
        assert(
          JSON.stringify(narrowResult.crossRefs) === JSON.stringify(wideResult.crossRefs),
          `${pairLabel} corpus crossRefs mismatch: ${JSON.stringify(expr)}`,
        );
        assert(wideResult.paramRefs.length === 0, `${pairLabel} corpus entry must carry no paramRefs under wide: ${JSON.stringify(expr)}`);
        const inputs = randomInputs(rng, narrowResult.refs);
        const crossInputs = randomCrossInputs(rng, wideResult.crossRefs);
        assertSameEvaluation(narrowResult.ast, wideResult.ast, inputs, crossInputs, `${pairLabel} corpus (${JSON.stringify(expr)})`);
      }
    } else if (isException) {
      checkedException += 1;
      assert(wideResult.ok === true, `${JSON.stringify(expr)} is listed as a named narrow-refusal/wide-acceptance but wide also refused it`);
    } else if (differentCode) {
      // The only corpus entries whose narrow outcome is decided inside a
      // dialect-gated parser branch. Both codes are pinned: asserting merely
      // that they differ would pass under exactly the mutation this exists to
      // catch — an ungated wide branch makes narrow refuse with the wide
      // code, and the two then agree.
      checkedDifferentCode += 1;
      assert(
        narrowResult.errors[0].code === differentCode.narrowCode,
        `${pairLabel}: ${JSON.stringify(expr)} must refuse under narrow with ${differentCode.narrowCode} — got ${JSON.stringify(narrowResult.errors[0])}`,
      );
      assert(
        wideResult.ok === false && wideResult.errors[0].code === differentCode.wideCode,
        `${pairLabel}: ${JSON.stringify(expr)} must refuse under wide with ${differentCode.wideCode}, got ${
          wideResult.ok ? "ok" : JSON.stringify(wideResult.errors[0])
        }`,
      );
    } else {
      checkedRefusal += 1;
      assert(
        wideResult.ok === false,
        `${pairLabel}: unexpected dialect flip: ${JSON.stringify(expr)} refuses under narrow and parses under wide, but is not in the accepted-exceptions list`,
      );
      if (!narrowResult.ok && !wideResult.ok) {
        assert(
          narrowResult.errors[0].code === wideResult.errors[0].code && narrowResult.errors[0].position === wideResult.errors[0].position,
          `${pairLabel} corpus refusal mismatch: ${JSON.stringify(expr)}`,
        );
      }
    }
  }

  assert(checkedOk > 0, `${pairLabel}: the corpus produced no ok entries — the corpus or the extraction is broken`);
  assert(checkedRefusal > 0, `${pairLabel}: the corpus produced no ordinary refusals — the corpus or the extraction is broken`);
  assert(
    checkedException === refusalsWideAccepts.length,
    `${pairLabel}: every named exception must actually appear, refuse under narrow, and be found in the corpus`,
  );
  assert(
    checkedDifferentCode === refusalsDifferentCode.length,
    `${pairLabel}: every different-code entry must appear in the corpus and refuse under narrow — ${checkedDifferentCode} of ${refusalsDifferentCode.length} were reached`,
  );
}

/** `(v1, v2)` — byte-identical to the original single-pair test: same
 * generator, same corpus, same exception lists, run first against a freshly
 * seeded rng. */
function runV1V2Pair(): void {
  const rng = mulberry32(SEED);
  const differentCode = asDifferentCodeEntries(V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE, (e) => e.v1Code, (e) => e.v2Code);
  runGeneratedCorpus(rng, undefined, CALC_DIALECT_V2, genExpressionV1, "(v1, v2)");
  runCorpusChecks(rng, V1_CORPUS, undefined, CALC_DIALECT_V2, V1_REFUSALS_V2_ACCEPTS, differentCode, "(v1, v2)");
}

/** `(v1, v3)` — the same `v1`-grammar generator and the same `V1_CORPUS`,
 * checked against `v3` instead of `v2`. The transitive half of decision 3:
 * `v1`'s meaning survives two dialect widenings, not just one. The two
 * "different code" entries (`sum({A})`, `avg({A})`) carry over unchanged —
 * `v2`'s aggregate production runs under `v3` unedited (design decision 1),
 * so `v1`'s `unknown_function` vs `v3`'s `scope_required` is the same pair of
 * codes the `(v1, v2)` check already pins. */
function runV1V3Pair(): void {
  const rng = mulberry32(SEED);
  const differentCode = asDifferentCodeEntries(V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE, (e) => e.v1Code, (e) => e.v2Code);
  runGeneratedCorpus(rng, undefined, CALC_DIALECT_V3, genExpressionV1, "(v1, v3)");
  runCorpusChecks(rng, V1_CORPUS, undefined, CALC_DIALECT_V3, V1_REFUSALS_V2_ACCEPTS, differentCode, "(v1, v3)");
}

/** `(v2, v3)` — the widened generator (qualified refs, aggregates) and
 * `V2_CORPUS`, checked against `v3`. ADR 0070 decision 3's own claim. */
function runV2V3Pair(): void {
  const rng = mulberry32(SEED);
  const differentCode = asDifferentCodeEntries(V2_REFUSALS_WITH_A_DIFFERENT_V3_CODE, (e) => e.v2Code, (e) => e.v3Code);
  runGeneratedCorpus(rng, CALC_DIALECT_V2, CALC_DIALECT_V3, genExpressionV2Grammar, "(v2, v3)");
  runCorpusChecks(rng, V2_CORPUS, CALC_DIALECT_V2, CALC_DIALECT_V3, V2_REFUSALS_V3_ACCEPTS, differentCode, "(v2, v3)");
}

export function runDialectSupersetTests(): void {
  runV1V2Pair();
  runV1V3Pair();
  runV2V3Pair();
}
