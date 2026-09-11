/**
 * The live formula preview (`F2.5`, ADR 0038 decision 5 — Unit 5; `F2.22`
 * item 6 for `bms-calc-v2`, cases 5 onward).
 *
 * Every literal below was read off a probe of the real `parseFormula` →
 * `evaluate` pair and then pasted, never recomputed here from the same
 * derivation the module uses. The one exception is the cross-asset key in
 * case 5, which is deliberately **not** a literal: it is `crossRefKey(node)`
 * over the node the real parser returned, because a hand-typed key would pass
 * against a module that keyed the same wrong way.
 *
 * The positions matter as much as the values. ADR 0037 decision 9 refuses at
 * **the node that produced the non-finite value**, not at the root, and a
 * preview that reported the root would look correct in every screenshot while
 * pointing the author at the wrong half of their expression.
 */
import { CALC_DIALECT_V2, crossRefKey, parseFormula, type CalcCrossRef } from "@bms/shared";

import { previewCrossRefs, previewFormula, previewInputKeys } from "./calc-preview";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The first cross-asset node of `expression`, read off the real parser under
 * `v2`. Case 5 keys its cross map by `crossRefKey` of this node — the key
 * `evaluate` reads — rather than by a string typed here.
 */
function aggregateNodeOf(expression: string): CalcCrossRef {
  const parsed = parseFormula(expression, { dialect: CALC_DIALECT_V2 });
  if (!parsed.ok) {
    throw new Error(`sanity: ${JSON.stringify(expression)} must parse under v2, got ${JSON.stringify(parsed.errors)}`);
  }
  const node = parsed.crossRefs[0];
  if (node === undefined || node.kind !== "aggregate") {
    throw new Error(`sanity: the first cross reference must be the aggregate, got ${JSON.stringify(node)}`);
  }
  return node;
}

/** Case 1 — the ordinary path. */
export function runPreviewComputesTests(): void {
  const preview = previewFormula("{A} * {B}", { A: 2, B: 3 });
  assert(preview.state === "ok", `expected ok, got ${JSON.stringify(preview)}`);
  if (preview.state !== "ok") {
    return;
  }
  assert(preview.value === 6, `2 * 3 must be 6, got ${preview.value}`);
}

/**
 * Case 2 — a point with no sample value yet.
 *
 * This is the state the preview spends most of its life in: the author has
 * typed the formula and is still filling the inputs. It must read as a prompt,
 * not as a crash and not as a wrong number.
 */
export function runMissingInputTests(): void {
  const preview = previewFormula("{A} * {B}", { A: 2 });
  assert(preview.state === "refused", `expected refused, got ${JSON.stringify(preview)}`);
  if (preview.state !== "refused") {
    return;
  }
  assert(preview.code === "missing_input", `code must be missing_input, got ${preview.code}`);
  assert(preview.position === 6, `must point at the second ref (offset 6), got ${preview.position}`);
  assert(preview.message.length > 0, "a refusal must carry a message the author can read");
}

/**
 * Case 2b — a half-typed number is a missing value, not a bad one.
 *
 * `Number("1.")` is `1`, but `Number("")` and `Number("-")` are `NaN`. Passing
 * `NaN` through would refuse with `non_finite` at the *reference*, which reads
 * as "your formula overflows" when the truth is "you have not finished typing".
 */
export function runNonFiniteInputIsTreatedAsMissingTests(): void {
  const preview = previewFormula("{A} * {B}", { A: 2, B: Number.NaN });
  assert(preview.state === "refused", `expected refused, got ${JSON.stringify(preview)}`);
  if (preview.state !== "refused") {
    return;
  }
  assert(preview.code === "missing_input", `a NaN sample must read as missing, got ${preview.code}`);
}

/**
 * Case 3 — division by zero is refused at the divide, and never shown.
 *
 * Raw JavaScript produces `Infinity` here, so the failure mode this guards
 * against is a preview that cheerfully renders that as a result.
 */
export function runDivisionByZeroTests(): void {
  assert(1 / 0 === Number.POSITIVE_INFINITY, "sanity: raw JavaScript would produce Infinity here");

  const preview = previewFormula("{A} / {B}", { A: 1, B: 0 });
  assert(preview.state === "refused", `expected refused, got ${JSON.stringify(preview)}`);
  if (preview.state !== "refused") {
    return;
  }
  assert(preview.code === "non_finite", `code must be non_finite, got ${preview.code}`);
  assert(
    preview.position === 4,
    `must refuse at the divide operator (offset 4), not at the root — got ${preview.position}`,
  );
}

/**
 * Case 4 — negative zero normalises to zero.
 *
 * `-0 === 0` is `true`, so an equality assertion would pass whether or not the
 * normalisation ran. `Object.is` is the only form that gates this.
 */
export function runNegativeZeroTests(): void {
  assert(-0 === 0, "sanity: === cannot tell -0 from 0, which is why Object.is is used below");
  assert(Object.is(-1 * 0, -0), "sanity: raw JavaScript produces -0 here");

  const preview = previewFormula("{A} * 0", { A: -1 });
  assert(preview.state === "ok", `expected ok, got ${JSON.stringify(preview)}`);
  if (preview.state !== "ok") {
    return;
  }
  assert(
    Object.is(preview.value, 0),
    `must be positive zero, got ${Object.is(preview.value, -0) ? "-0" : String(preview.value)}`,
  );
}

/** Case 4b — a bad `clamp` range is its own refusal, not a non-finite one. */
export function runInvalidClampRangeTests(): void {
  const preview = previewFormula("clamp({A}, 5, 1)", { A: 3 });
  assert(preview.state === "refused", `expected refused, got ${JSON.stringify(preview)}`);
  if (preview.state !== "refused") {
    return;
  }
  assert(
    preview.code === "invalid_clamp_range",
    `code must be invalid_clamp_range, got ${preview.code}`,
  );
}

/**
 * Case 4c — text that does not parse is silent, not an error.
 *
 * The linter already underlines a parse error in place. A preview that repeated
 * it would say the same thing twice, in a panel, while the author is mid-word.
 */
export function runUnparsedIsSilentTests(): void {
  for (const expression of ["{A} +", "{A", "2 @ 3", ""]) {
    const preview = previewFormula(expression, { A: 1 });
    assert(
      preview.state === "unparsed",
      `${JSON.stringify(expression)} must be unparsed, got ${JSON.stringify(preview)}`,
    );
  }
}

/** The input keys the preview needs values for, in first-appearance order. */
export function runPreviewInputKeyTests(): void {
  const keys = previewInputKeys("{B} + {A} * {B}");
  assert(
    keys.join(",") === "B,A",
    `expected deduplicated source order B,A — got ${JSON.stringify(keys)}`,
  );
  assert(previewInputKeys("{A} +").length === 0, "unparsable text asks for no inputs");
}

/**
 * Case 5 — `bms-calc-v2`: one sample value per cross-asset reference.
 *
 * The author types the aggregate's value, not its members (`F2.22` plan
 * design decision 1): the member set is resolved only by the database, which
 * this module may not reach. The cross map is keyed by `crossRefKey(node)`,
 * the key `evaluate` looks up (`evaluate.ts`), and the node comes from the
 * real parser — so this case cannot agree with the module on a key the
 * evaluator would refuse. `10 / 2`: the aggregate's sample over the local one.
 */
export function runV2PreviewComputesTests(): void {
  const expression = "sum({kw} @site) / {kw}";
  const node = aggregateNodeOf(expression);
  const preview = previewFormula(
    expression,
    { kw: 2 },
    { dialect: CALC_DIALECT_V2, crossValues: { [crossRefKey(node)]: 10 } },
  );
  assert(preview.state === "ok", `expected ok, got ${JSON.stringify(preview)}`);
  if (preview.state !== "ok") {
    return;
  }
  assert(preview.value === 5, `10 / 2 must be 5, got ${preview.value}`);
}

/**
 * Case 5b — the aggregate has no sample value yet.
 *
 * Refused at the aggregate. Its `position` is the offset of its function-name
 * token (`ast.ts`, `CalcAggregate`), and `sum` opens this expression, so the
 * measured offset is `0` — read off the real pair, not an unset default. The
 * message names the cross-asset reference: a `v2` author told "referenced
 * point" would look for a `{ref}` row that is not there.
 */
export function runV2MissingCrossInputTests(): void {
  const preview = previewFormula("sum({kw} @site) / {kw}", { kw: 2 }, { dialect: CALC_DIALECT_V2 });
  assert(preview.state === "refused", `expected refused, got ${JSON.stringify(preview)}`);
  if (preview.state !== "refused") {
    return;
  }
  assert(preview.code === "missing_input", `code must be missing_input, got ${preview.code}`);
  assert(preview.position === 0, `must point at the aggregate (offset 0), got ${preview.position}`);
  assert(
    preview.message === "no sample value for a referenced point or cross-asset reference at character 0",
    `the refusal must name the cross-asset reference, got ${JSON.stringify(preview.message)}`,
  );
}

/**
 * Case 6 — which rows the preview asks for, under each dialect.
 *
 * `previewCrossRefs` lists the cross-asset references in source order,
 * `aggregate` then `qref`, under `v2`. Under the default dialect the same
 * text does not tokenize (`@` is `unexpected_character` under `v1`), so the
 * answer is `[]` — and that is the gate on the default: a module that
 * defaulted to `v2` would return two entries there. A plain `v1` formula
 * names no cross reference either.
 *
 * The local list stays local (Q3b). The `{kw}` inside `sum({kw} @site)` is
 * the aggregate's member key and the `kwh` inside `{TX_01.kwh}` belongs to
 * `TX_01`; neither is a row the author fills, so `previewInputKeys` lists
 * nothing for that expression — measured `[]`, not the `["kw"]` the plan
 * wrote. The positive control is an expression with a local `{kw}` beside
 * the aggregate, where `kw` is listed exactly once.
 */
export function runPreviewCrossRefsTests(): void {
  const expression = "sum({kw} @site) + {TX_01.kwh}";
  const kinds = previewCrossRefs(expression, CALC_DIALECT_V2).map((node) => node.kind);
  assert(
    kinds.join(",") === "aggregate,qref",
    `expected the aggregate then the qualified reference, in source order — got ${JSON.stringify(kinds)}`,
  );
  assert(
    previewCrossRefs(expression).length === 0,
    "the default dialect is v1, under which a cross-asset reference does not parse",
  );
  assert(previewCrossRefs("{A} * {B}").length === 0, "a v1 formula names no cross-asset reference");
  assert(previewCrossRefs("sum({kw} @site) +", CALC_DIALECT_V2).length === 0, "unparsable text asks for nothing");

  const localKeys = previewInputKeys(expression, CALC_DIALECT_V2);
  assert(
    localKeys.length === 0,
    `neither a member key nor another asset's key is a local input — got ${JSON.stringify(localKeys)}`,
  );
  const withLocal = previewInputKeys("sum({kw} @site) / {kw}", CALC_DIALECT_V2);
  assert(withLocal.join(",") === "kw", `the local {kw} is listed once under v2 — got ${JSON.stringify(withLocal)}`);
}
