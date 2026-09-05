import type { CalcErrorCode } from "./ast";
import { CALC_FUNCTION_ARITY, MAX_FORMULA_DEPTH, MAX_FORMULA_LENGTH, MAX_FORMULA_POINT_REFS } from "./limits";

/**
 * The `bms-calc-v1` expression corpus — every literal string `parser.spec.ts`
 * and `evaluate.spec.ts` feed to `parseFormula` un-dialected (directly, or
 * through `expectOk`/`expectFailCode`/`evalExpr`, all of which call it with
 * no `options`). Extracted, not invented: `F2.9` Task 3 (ADR 0055 decision 4)
 * re-runs this exact list under both dialects so the property test checks
 * what those two specs already prove `v1` does, rather than a hand-picked
 * subset. Both specs import this module and loop over it (additively,
 * alongside their existing inline assertions) so a corpus entry is at least
 * exercised in both places — though nothing *forces* a new literal added to
 * either spec to be added here too; that gap is recorded in this task's
 * build report, not hidden.
 *
 * The arity-probe and bound-probe entries are *computed*, not copied as
 * numbers, from the same constants (`CALC_FUNCTION_ARITY`,
 * `MAX_FORMULA_LENGTH`, `MAX_FORMULA_POINT_REFS`, `MAX_FORMULA_DEPTH`) the
 * two specs read — so this list cannot go stale if a bound moves.
 *
 * **One entry is a deliberate exception, not a mistake:** `sum({kw} @site)`
 * refuses under `v1` (`unexpected_character` at the `@`, `parser.spec.ts`'s
 * own "the v1 refusal that must survive v2" case) and PARSES under `v2` (it
 * is the ADR's own aggregate example). ADR 0055 decision 4 is directional —
 * every expression that *parses* under `v1` parses under `v2` with the same
 * meaning; it makes no claim about a `v1` refusal, and a `v1` refusal
 * becoming legal `v2` syntax is exactly what "a strict superset" means.
 * `dialect-superset.spec.ts` checks this entry against
 * `V1_REFUSALS_V2_ACCEPTS` by name, instead of asserting blanket `ok`
 * agreement over the whole corpus (which would be wrong for this one entry).
 *
 * **`sum({A})` and `avg({A})` are a second kind of exception**, added by
 * `F2.9` and listed in `V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE`: they refuse
 * under both dialects, with a different code on each. They are the only corpus
 * entries whose `v1` outcome is decided inside a dialect-gated parser branch,
 * which is why they are here — see that constant's docblock.
 */

function arityProbeExpressions(): string[] {
  const out: string[] = [];
  for (const [fn, arity] of Object.entries(CALC_FUNCTION_ARITY)) {
    const arg = "{A}";
    out.push(`${fn}(${Array(arity.min).fill(arg).join(",")})`);
    out.push(`${fn}(${Array(arity.max).fill(arg).join(",")})`);
    if (arity.min > 0) {
      const belowMin = `${fn}(${Array(arity.min - 1).fill(arg).join(",")})`;
      out.push(belowMin || `${fn}()`);
    }
    out.push(`${fn}(${Array(arity.max + 1).fill(arg).join(",")})`);
  }
  return out;
}

const TWENTY_ONE_REFS = Array.from({ length: MAX_FORMULA_POINT_REFS + 1 }, (_, i) => `{P${i}}`).join("+");
const TWENTY_REFS_REPEATED = Array.from({ length: MAX_FORMULA_POINT_REFS }, (_, i) => `{P${i}}`)
  .concat(Array.from({ length: MAX_FORMULA_POINT_REFS }, (_, i) => `{P${i}}`))
  .join("+");
const DEEPLY_NESTED = "(".repeat(MAX_FORMULA_DEPTH + 1) + "1" + ")".repeat(MAX_FORMULA_DEPTH + 1);
const TOO_LONG = "1".repeat(MAX_FORMULA_LENGTH + 1);

export const V1_CORPUS: readonly string[] = [
  // ---- parser.spec.ts, runParserTests ----------------------------------
  "2 + 3 * 4",
  "10 - 3 - 2",
  "(2 + 3) * 4",
  "({SUB_METER_1_KWH} + {SUB_METER_2_KWH}) / {TOTAL_KWH}",
  "sum({kw} @site)", // see V1_REFUSALS_V2_ACCEPTS above
  "clamp({A}, 0, 100)",
  "abs({A})",
  "min(max({A}, {B}), 5)",
  "pow({A}, 2)",
  "2 +",
  "2 3",
  "",
  "   ",
  "2 + {A} * 3",
  // `F2.9` — the two v2 aggregate keywords applied as if they were v1
  // functions. See `V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE`.
  "sum({A})",
  "avg({A})",
  ...arityProbeExpressions(),
  TOO_LONG,
  TWENTY_ONE_REFS,
  TWENTY_REFS_REPEATED,
  DEEPLY_NESTED,
  // ---- evaluate.spec.ts, runEvaluateTests -------------------------------
  "round({A})",
  "-{A}",
  "min({A} * {B}, 5)",
  "({A} * {B}) - ({A} * {B})",
  "{A} / {B}",
  "clamp({A}, 10, 5)",
  "clamp({A}, 5, 10)",
  "{A}",
  "{A} + {B}",
  "min({A}, {B})",
  "max({A}, {B})",
  "({A} + {B}) / 2",
];

/** Corpus entries that refuse under `v1` but PARSE under `v2` — see the
 * module docblock. Checked by name in `dialect-superset.spec.ts`, never by
 * blanket `ok` agreement over the whole corpus. */
export const V1_REFUSALS_V2_ACCEPTS: readonly string[] = ["sum({kw} @site)"];

/**
 * Corpus entries that refuse under **both** dialects, with a **different code
 * on each** — and the codes, pinned.
 *
 * The third and last shape a corpus entry can have, added by `F2.9` after
 * review found the refusal half of `dialect-superset.spec.ts` proved nothing:
 * every refusal the generator produced was `too_many_refs` or `too_long`, both
 * decided in `parseFormula` **outside** the dialect branches, so the
 * "identical refusal under both dialects" assertion never reached code that
 * could branch on dialect.
 *
 * `sum` and `avg` are `v2` aggregate keywords and are not `v1` functions.
 * Applied like a `v1` call they refuse under both dialects and for genuinely
 * different reasons — `unknown_function` at the identifier under `v1`,
 * `scope_required` at the closing paren under `v2`, because `v2` opened an
 * aggregate and found no `@scope`. Pinning **both** codes is what makes this
 * list a tripwire rather than bookkeeping: a `v2` branch that stopped being
 * gated on the dialect would make `v1` refuse with `scope_required` too, and
 * an assertion that only required the two codes to *differ* would pass on the
 * agreement it had just lost.
 *
 * ADR 0055 decision 4 is directional and says nothing about a refusal, so this
 * list asserts nothing the decision forbids. Decision 3 is the one it guards:
 * a `v1` formula keeps its exact current meaning, and `sum({A})` meaning
 * "unknown function" is part of that meaning.
 */
export const V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE: readonly {
  readonly expression: string;
  readonly v1Code: CalcErrorCode;
  readonly v2Code: CalcErrorCode;
}[] = [
  { expression: "sum({A})", v1Code: "unknown_function", v2Code: "scope_required" },
  { expression: "avg({A})", v1Code: "unknown_function", v2Code: "scope_required" },
];
