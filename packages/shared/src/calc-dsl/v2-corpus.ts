import type { CalcErrorCode } from "./ast";
import { MAX_FORMULA_CROSS_REFS } from "./limits";

/**
 * The `bms-calc-v2` expression corpus — every literal string `parser.spec.ts`
 * (`runParserV2Tests`, `runV2ErrorWordingTests`) and `evaluate.spec.ts`
 * (`runEvaluateV2Tests`) feed to `parseFormula` under `{ dialect:
 * CALC_DIALECT_V2 }` — extracted, the discipline `v1-corpus.ts` states in
 * its own docblock — **plus the two entries the exception lists below need,
 * added by value**: `"{kw} * $energy_tariff_per_kwh"` and `"$"` are not
 * literals any spec feeds `parseFormula` under `v2` (`parser.spec.ts` feeds
 * `"{kw} * $f"` under `v2` and `"$"` under `v3`); they are here so the pinned
 * `v2` refusal and its `v3` counterpart are one corpus entry each.
 * `runV2ErrorWordingTests` itself calls `formatCalcError` on hand-built
 * `{ code, position }` objects, never `parseFormula`, so it contributes no
 * literal here.
 *
 * `E4.1a` U3 (ADR 0070 decision 3) re-runs this list under `bms-calc-v3` the
 * way `dialect-superset.spec.ts` already re-runs `V1_CORPUS` under `v2`: every
 * entry that parses under `v2` must parse to the identical AST, `refs` and
 * `crossRefs` under `v3`, and `paramRefs` must be `[]` — a `v2`-grammar
 * literal never contains a `$`, so it cannot become a parameter reference.
 *
 * The two `nineTerms`/`eight` cap-probe entries are *computed*, not copied as
 * numbers, from `MAX_FORMULA_CROSS_REFS` — the same constant
 * `parser.spec.ts` reads — so this list cannot go stale if the bound moves.
 */

const NINE_TERMS = Array.from(
  { length: MAX_FORMULA_CROSS_REFS + 1 },
  (_, i) => `sum({TX_01} @group('IT_LOAD_${i}'))`,
);

export const V2_CORPUS: readonly string[] = [
  // ---- parser.spec.ts, runParserV2Tests ---------------------------------
  // `F3` two deliberate exceptions, in the `V1_CORPUS` style: `V2_REFUSALS_V3_ACCEPTS`
  // (below) and `V2_REFUSALS_WITH_A_DIFFERENT_V3_CODE` name these two by value.
  "{kw} * $energy_tariff_per_kwh", // see V2_REFUSALS_V3_ACCEPTS below
  "$", // see V2_REFUSALS_WITH_A_DIFFERENT_V3_CODE below
  "sum({kw} @site) / sum({kw} @group('IT_LOAD'))",
  "{TX_01.kwh} - {TX_02.kwh}",
  "sum({kw} @site) + {kw}",
  "({SUB_METER_1_KWH} + {SUB_METER_2_KWH}) / {TOTAL_KWH}",
  "sum({TX_01} @group(foo))",
  "sum({TX_01} @group)",
  "sum({TX_01} @site('IT_LOAD'))",
  "sum({TX_01})",
  "{TX_01.kwh} @group('IT_LOAD')",
  "min({TX_01} @site, 1)",
  "@site + {foo}",
  "sum(foo @group('IT_LOAD'))",
  "avg(1 @site)",
  "sum({TX_01.kwh} @group('IT_LOAD'))",
  NINE_TERMS.join(" + "),
  NINE_TERMS.slice(0, MAX_FORMULA_CROSS_REFS).join(" + "),
  "sum({kw} @site) + sum({kw} @site)",
  "{TX_01.kwh} * {TX_01.kwh}",
  "sum({kw} @group('A')) - sum({kw} @group('B'))",
  "{TX_01.kwh} + {a}",
  "sum({kw} @site) + {b}",
  "sum({kw} @site) / {TX_01.kwh}",
  // ---- evaluate.spec.ts, runEvaluateV2Tests -----------------------------
  "sum({kw} @site) / 2",
  "1 + {TX_01.kwh}",
  "{TX_01.kwh}",
  // ---- E4.1b U6 — valid v2 formulas the U5 v2-guard cases also feed ------
  // (`tokenizer.spec.ts` / `parser.spec.ts` `runParserWindowTests` /
  // `runTokenizerWindowTests` v2-guard lines), plus two bare-integer
  // formulas so the superset property exercises the integer path beside the
  // window lexer, as `V1_CORPUS` already does for `v1`.
  "sum({kw} @site)",
  "min({kw}, 1)",
  "max({a}, {b}, 3)",
  "{kw} * 24",
  "{kw} + 7",
  // ---- E4.1b U6 — the window productions, V2_REFUSALS_V3_ACCEPTS below ---
  "sum({kw}, 24h)",
  "sum({kw}, today)",
  "avg({TX_01.kw}, 24h)",
  "min({kw}, 7d)",
  "max({kw}, this_year)",
  "delta({kwh}, today)",
  "hours(this_month)",
  "hours(24h)",
  // ---- E4.1b U6 — the window gates, V2_REFUSALS_WITH_A_DIFFERENT_V3_CODE below --
  "24h",
  "today",
  "hours(1)",
  "delta(1, 2)",
  "sum({kw} @site, 24h)",
  "min({kw} + 1, 24h)",
];

/**
 * The one `v2` refusal named in ADR 0070's worked example: `$` is `v2`-illegal
 * (`unexpected_character`) and `v3`-legal — the `v3` production the whole row
 * exists to add. Checked by name, exactly as `V1_REFUSALS_V2_ACCEPTS` is.
 */
export const V2_REFUSALS_V3_ACCEPTS: readonly string[] = [
  "{kw} * $energy_tariff_per_kwh",
  // ---- E4.1b U6 — the window productions themselves, ADR 0070 decision 2 --
  "sum({kw}, 24h)",
  "sum({kw}, today)",
  "avg({TX_01.kw}, 24h)",
  "min({kw}, 7d)",
  "max({kw}, this_year)",
  "delta({kwh}, today)",
  "hours(this_month)",
  "hours(24h)",
];

/**
 * The one entry whose `v2` outcome is decided inside the tokenizer's `isV3`
 * guard — the mutation this task's build gate drops to prove it. Both codes
 * are pinned for the reason `V1_REFUSALS_WITH_A_DIFFERENT_V2_CODE` gives: an
 * assertion that only required the two codes to *differ* would still pass once
 * an ungated `$` branch let `v2` refuse with the `v3` code too.
 */
export const V2_REFUSALS_WITH_A_DIFFERENT_V3_CODE: readonly {
  readonly expression: string;
  readonly v2Code: CalcErrorCode;
  readonly v3Code: CalcErrorCode;
}[] = [
  { expression: "$", v2Code: "unexpected_character", v3Code: "malformed_parameter_reference" },
  // ---- E4.1b U6 — the window-token and window-form gates, ADR 0070 decision
  // 2/4. Both codes measured against this build (see the plan's U6 build
  // report) rather than assumed: `24h` and `today` lex as `malformed_number`
  // / `unexpected_end` under `v2` (the window branches are gated on
  // `isV3W`/`isV3`) and as `window_not_allowed` under `v3` (a window with no
  // enclosing window-form call). `hours`/`delta` are not `v1`/`v2` functions
  // at all, so they refuse `unknown_function` there and only gain their `v3`
  // window-form refusals once the identifier is recognised.
  { expression: "24h", v2Code: "malformed_number", v3Code: "window_not_allowed" },
  { expression: "today", v2Code: "unexpected_end", v3Code: "window_not_allowed" },
  { expression: "hours(1)", v2Code: "unknown_function", v3Code: "window_required" },
  { expression: "delta(1, 2)", v2Code: "unknown_function", v3Code: "window_needs_point_reference" },
  // measured: the lexer's glued-suffix rule fires before the parser ever sees
  // the scope comma, so this refuses `malformed_number` under `v2` too — the
  // same code the bare `24h` entry pins, for the same reason.
  { expression: "sum({kw} @site, 24h)", v2Code: "malformed_number", v3Code: "window_over_aggregate" },
  { expression: "min({kw} + 1, 24h)", v2Code: "malformed_number", v3Code: "window_needs_point_reference" },
];
