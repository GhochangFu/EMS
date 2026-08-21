/**
 * The live formula preview (`F2.5`, ADR 0038 decision 5 — Unit 5).
 *
 * The author types a sample value for each referenced point and sees the
 * computed result — or the evaluator's refusal — as they type. This is a thin
 * adapter over `parseFormula` → `evaluate` from `@bms/shared`, which is a
 * runtime package since ADR 0030, so the browser runs the **same** evaluator
 * the calc engine runs. ADR 0037's consequence forbids a second one, and a
 * preview that disagreed with the engine would be worse than no preview.
 *
 * **This module is pure and must stay pure.** It does not fetch live telemetry:
 * a formula being authored belongs to a template, and a template has no asset
 * until `F2.2` instantiates it, so there is no live reading to read. That is a
 * property no behavioural test can show, so `calc-preview.spec.ts` scans this
 * source for network symbols instead.
 */
import {
  evaluate,
  parseFormula,
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
 */
const REFUSAL_REASONS: Readonly<Record<CalcEvalErrorCode, string>> = {
  missing_input: "no sample value for a referenced point",
  non_finite: "the result is not a finite number",
  invalid_clamp_range: "clamp was given a low bound above its high bound",
};

/**
 * Sample values, keyed by point key.
 *
 * A record rather than a `Map` because that is the shape a controlled form
 * holds. `toInputMap` converts and filters.
 */
export type CalcSampleValues = Readonly<Record<string, number>>;

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
 * Evaluates `expression` over `values`.
 *
 * Every refusal comes from `evaluate` itself, including the position. ADR 0037
 * decision 9 checks finiteness at **every node**, so `{A} / {B}` with `B = 0`
 * refuses at the divide rather than at the root — the author gets pointed at
 * the operator that failed, not at the whole formula.
 */
export function previewFormula(expression: string, values: CalcSampleValues): CalcPreview {
  const parsed = parseFormula(expression);
  if (!parsed.ok) {
    return { state: "unparsed" };
  }

  const result = evaluate(parsed.ast, toInputMap(values));
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
 * The point keys this expression needs a sample value for, deduplicated in
 * first-appearance order.
 *
 * Drives the preview's input rows. Unparsable text asks for nothing — there is
 * no partial ref list worth showing while the expression is still being typed.
 */
export function previewInputKeys(expression: string): string[] {
  const parsed = parseFormula(expression);
  return parsed.ok ? parsed.refs : [];
}
