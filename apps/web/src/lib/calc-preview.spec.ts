/**
 * The live formula preview (`F2.5`, ADR 0038 decision 5 — Unit 5).
 *
 * Every literal below was read off a probe of the real `parseFormula` →
 * `evaluate` pair and then pasted, never recomputed here from the same
 * derivation the module uses.
 *
 * The positions matter as much as the values. ADR 0037 decision 9 refuses at
 * **the node that produced the non-finite value**, not at the root, and a
 * preview that reported the root would look correct in every screenshot while
 * pointing the author at the wrong half of their expression.
 */
import { previewFormula, previewInputKeys } from "./calc-preview";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
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
