/**
 * The live formula preview (`F2.5`, ADR 0038 decision 5 — Unit 5; `F2.22`
 * item 6 for `bms-calc-v2`).
 *
 * The author types a sample value for each referenced point — and, under
 * `bms-calc-v2`, one per cross-asset reference — and sees the computed result
 * or the evaluator's refusal as they type. This is a thin adapter over
 * `parseFormula` → `evaluate` from `@bms/shared`, which is a runtime package
 * since ADR 0030, so the browser runs the **same** evaluator the calc engine
 * runs, under the same dialect. ADR 0037's consequence forbids a second one,
 * and a preview that disagreed with the engine would be worse than no preview.
 *
 * Under `v2` an aggregate such as `sum({kw} @site)` is **one** input, not a
 * member list (`F2.22` plan design decision 1): its member set is resolved
 * only by the database, which this module may not reach (below), so the
 * author supplies the aggregate's value. `previewCrossRefs` lists the nodes
 * that need one; the cross map is keyed by `crossRefKey(node)` from
 * `@bms/shared` — the key `evaluate` itself looks up (`evaluate.ts`) — so a
 * panel built on this module and the evaluator cannot disagree on the key.
 *
 * The panel that renders this module is T8 of
 * `docs/plans/f2.22-calc-v2-authoring.md`. When this docblock was written no
 * panel existed: `previewFormula` had no caller outside its spec (plan
 * finding 1). T8 owns this sentence once it lands.
 *
 * **This module is pure and must stay pure.** It does not fetch live telemetry:
 * a formula being authored belongs to a template, and a template has no asset
 * until `F2.2` instantiates it, so there is no live reading to read. That is a
 * property no behavioural test can show, so
 * `tests/adr-0038-formula-editor.test.ts` scans this source for network
 * symbols instead. **Not `calc-preview.spec.ts`**, which this line used to
 * name: that file exercises the functions and holds no scan, so a reader who
 * trusted it could delete the `tests/` file believing the guarantee was still
 * covered. The scan lives under `tests/` because `apps/web`'s tsconfig carries
 * no `node` types, so `node:fs` does not typecheck here.
 */
import {
  CALC_DIALECT,
  evaluate,
  parseFormula,
  type CalcCrossRef,
  type CalcDialect,
  type CalcEvalErrorCode,
} from "@bms/shared";

/**
 * What the preview panel renders.
 *
 * `"unparsed"` is silent on purpose and is **not** an error state. The linter
 * already underlines a parse error at its own offset (Unit 4 →
 * `formula-editor.tsx`); a preview that repeated the message in a panel would
 * say the same thing twice while the author is still mid-word.
 */
export type CalcPreview =
  | { state: "ok"; value: number }
  | { state: "refused"; code: CalcEvalErrorCode; message: string; position: number }
  | { state: "unparsed" };

/**
 * The three refusals, in the author's words.
 *
 * Phrased and formatted like `formatCalcError` (`parser.ts:296`) —
 * `"<reason> at character <n>"` — so the preview panel and the inline linter
 * read as one voice rather than as two subsystems.
 *
 * They name **no** source text, matching the no-input-echo rule ADR 0036 set
 * for `CalcParseError`. `position` is what the caller uses to point at the
 * offending node; the message stays a description of the failure.
 *
 * `missing_input` covers both maps: a `{ref}` absent from `values`, or a
 * cross-asset node absent from `crossValues` (`v2`). The sentence names both,
 * because a `v2` author told only "referenced point" would look for a `{ref}`
 * row that is not there.
 */
const REFUSAL_REASONS: Readonly<Record<CalcEvalErrorCode, string>> = {
  missing_input: "no sample value for a referenced point or cross-asset reference",
  non_finite: "the result is not a finite number",
  invalid_clamp_range: "clamp was given a low bound above its high bound",
};

/**
 * Sample values. Keyed by local point key for `values`, and by
 * `crossRefKey(node)` for `CalcPreviewOptions.crossValues` — one record per
 * map, as `evaluate` takes one map per namespace, so a local key can never
 * shadow a cross-asset reference or be shadowed by one.
 *
 * A record rather than a `Map` because that is the shape a controlled form
 * holds. `toInputMap` converts and filters.
 */
export type CalcSampleValues = Readonly<Record<string, number>>;

/**
 * `dialect` defaults to `bms-calc-v1`, so a caller that passes nothing gets
 * the `v1` preview it always had. `crossValues` is read only by a `v2` AST —
 * a `v1` AST has no cross-asset node — and is keyed by `crossRefKey(node)`
 * for each node `previewCrossRefs` returns.
 */
export type CalcPreviewOptions = {
  readonly dialect?: CalcDialect;
  readonly crossValues?: CalcSampleValues;
};

/**
 * Builds the evaluator's input map, dropping values that are not finite
 * numbers.
 *
 * A text input mid-edit produces `Number("") === NaN` and `Number("-") === NaN`.
 * Passing those through would refuse with `non_finite` **at the reference**,
 * which reads as "your formula overflows" when the truth is "you have not
 * finished typing". Dropping them refuses with `missing_input` at the same
 * offset instead, which is the prompt the author actually needs.
 *
 * Built from `Object.entries`, so inherited and prototype keys are never
 * consulted.
 */
function toInputMap(values: CalcSampleValues): Map<string, number> {
  const inputs = new Map<string, number>();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      inputs.set(key, value);
    }
  }
  return inputs;
}

/**
 * Evaluates `expression` over `values` — and, under `bms-calc-v2`, over
 * `options.crossValues` for its cross-asset references.
 *
 * Every refusal comes from `evaluate` itself, including the position. ADR 0037
 * decision 9 checks finiteness at **every node**, so `{A} / {B}` with `B = 0`
 * refuses at the divide rather than at the root — the author gets pointed at
 * the operator that failed, not at the whole formula. A cross-asset node with
 * no sample value refuses with `missing_input` at the node, as a `{ref}` does.
 */
export function previewFormula(
  expression: string,
  values: CalcSampleValues,
  options?: CalcPreviewOptions,
): CalcPreview {
  const parsed = parseFormula(expression, { dialect: options?.dialect ?? CALC_DIALECT });
  if (!parsed.ok) {
    return { state: "unparsed" };
  }

  const result = evaluate(parsed.ast, toInputMap(values), toInputMap(options?.crossValues ?? {}));
  if (result.ok) {
    // `evaluate` already normalises `-0` to `0` at every node
    // (`evaluate.ts:19`), so this value is passed through untouched. Do not
    // re-normalise here: two owners of one rule is how they drift.
    return { state: "ok", value: result.value };
  }

  return {
    state: "refused",
    code: result.code,
    message: `${REFUSAL_REASONS[result.code]} at character ${result.position}`,
    position: result.position,
  };
}

/**
 * The **local** point keys this expression needs a sample value for,
 * deduplicated in first-appearance order — `parsed.refs`, whose meaning is
 * unchanged under `v2` (`F2.22` Q3b). A cross-asset node contributes nothing
 * here: the `kw` in `sum({kw} @site)` is the aggregate's member key, and the
 * `kwh` in `{TX_01.kwh}` belongs to `TX_01`. Those rows come from
 * `previewCrossRefs`.
 *
 * Drives the preview's input rows. Unparsable text asks for nothing — there is
 * no partial ref list worth showing while the expression is still being typed.
 */
export function previewInputKeys(expression: string, dialect: CalcDialect = CALC_DIALECT): string[] {
  const parsed = parseFormula(expression, { dialect });
  return parsed.ok ? parsed.refs : [];
}

/**
 * The cross-asset references this expression needs a sample value for — one
 * node per distinct `crossRefKey`, first-appearance order (`parsed.crossRefs`).
 * Always `[]` under `v1`, where no cross-asset node parses, and for unparsable
 * text, for the same reason `previewInputKeys` asks for nothing then.
 *
 * Drives the preview's cross-asset rows. The caller keys each row's value by
 * `crossRefKey(node)` when it builds `CalcPreviewOptions.crossValues`.
 */
export function previewCrossRefs(expression: string, dialect: CalcDialect = CALC_DIALECT): CalcCrossRef[] {
  const parsed = parseFormula(expression, { dialect });
  return parsed.ok ? parsed.crossRefs : [];
}
