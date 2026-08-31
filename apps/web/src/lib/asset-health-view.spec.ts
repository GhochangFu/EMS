import { expect } from "vitest";

import {
  formatHealthComputedAt,
  formatHealthScorePercent,
  healthBandDisplay,
  healthDonutSlices,
  healthWindowCoverage,
  unscoredTagMessage,
} from "./asset-health-view";

/**
 * `E1.3` Unit 8 — one function per rendering rule the ADR 0050 + Amendment 1
 * contract carries. Vitest entry point is the sibling `.test.ts` (ADR 0014).
 */

/** ADR 0050 absence 1 — a real zero and an absent score must print differently. */
export function nullScoreAndZeroScoreRenderDifferently(): void {
  const nullText = formatHealthScorePercent(null);
  const zeroText = formatHealthScorePercent(0);
  expect(nullText, "an absent score renders the em dash, never a formatted percentage").toBe("—");
  expect(zeroText, "a real zero renders as a real zero percent").toBe("0%");
  expect(nullText, "the two must be visibly different strings").not.toBe(zeroText);
}

/** The score is `0..1` on the wire — the conversion happens exactly once, at this edge. */
export function scoreIsMultipliedByOneHundredOnlyHere(): void {
  expect(formatHealthScorePercent(0.5)).toBe("50%");
  expect(formatHealthScorePercent(0.823, 1)).toBe("82.3%");
  expect(formatHealthScorePercent(1)).toBe("100%");
}

/**
 * `band: null` is "unconfigured", never "no data" — and a non-null band's
 * `minScore` is converted through the same `0..1` → percent edge as `score`,
 * never compared against a percentage directly.
 */
export function bandNullReadsAsUnconfiguredNotNoData(): void {
  const unconfigured = healthBandDisplay(null);
  expect(unconfigured, "an unconfigured template must not say 'no data'").toBe("Unconfigured");
  expect(unconfigured.toLowerCase().includes("no data")).toBe(false);

  const fair = healthBandDisplay({ code: "fair", label: "Fair", minScore: 0.4 });
  expect(fair, "the cut-point renders through the same 0..1 -> percent conversion as score").toBe(
    "Fair · ≥ 40%",
  );
}

/** `skippedRuleCount === 0` and `> 0` are different facts and must read as different sentences. */
export function unscoredTagMessageDistinguishesSkippedFromNeverMatched(): void {
  const neverMatched = unscoredTagMessage({ pointKey: "kw", skippedRuleCount: 0 });
  const skipped = unscoredTagMessage({ pointKey: "kw", skippedRuleCount: 2 });
  expect(neverMatched).toBe("kw: no threshold rule configured");
  expect(skipped).toBe("kw: 2 rules could not be evaluated");
  expect(neverMatched, "the two facts must not share one sentence").not.toBe(skipped);
  // Singular/plural is not asserted arbitrarily: a "1 rules" reads as broken.
  expect(unscoredTagMessage({ pointKey: "kw", skippedRuleCount: 1 })).toBe(
    "kw: 1 rule could not be evaluated",
  );
}

/**
 * A slice's share is against the TOTAL asset count, not against the sum of
 * banded counts — and an empty enterprise reports `percent: null` rather than
 * dividing by zero.
 */
export function donutSliceShareIsAgainstTheTotalAssetCount(): void {
  const slices = healthDonutSlices(
    [
      { code: "excellent", label: "Excellent", count: 112 },
      { code: "good", label: "Good", count: 86 },
    ],
    265,
  );
  expect(slices[0].percent).toBeCloseTo((112 / 265) * 100, 5);
  expect(slices[1].percent).toBeCloseTo((86 / 265) * 100, 5);
  // Not against the sum of the two bands shown (198), which would overstate
  // each slice's share once unbanded/unscored assets exist.
  expect(slices[0].percent).not.toBeCloseTo((112 / 198) * 100, 5);

  const empty = healthDonutSlices([{ code: "excellent", label: "Excellent", count: 0 }], 0);
  expect(empty[0].percent, "zero assets has no share to report, not a divide-by-zero NaN/Infinity").toBe(
    null,
  );
}

/** `computedAt: null` says the roll-up has not covered this scope, never a fabricated `now`. */
export function computedAtNullSaysNotYetComputedNeverANow(): void {
  expect(formatHealthComputedAt(null)).toBe("Not yet computed");
  const real = formatHealthComputedAt("2026-08-30T03:59:00.000Z");
  expect(real).not.toBe("Not yet computed");
  expect(real).not.toBe("—");
  // An unparseable timestamp must not print the literal "Invalid Date".
  expect(formatHealthComputedAt("not-a-date")).toBe("—");
}

/**
 * `F4.72` — the three coverage states, and the one that must never be rendered
 * as another.
 *
 * ADR 0050 Amendment 2 decision 1: `coveredBuckets: 0` is "nothing to show" and
 * `0 < coveredBuckets < expectedBuckets` is "a real score over less than the
 * window you asked for". The second rendered as the first hides a score that is
 * correct over the buckets it has.
 */
export function partialWindowIsItsOwnStateNotTheEmptyOne(): void {
  const empty = healthWindowCoverage(0, 1_440);
  const partial = healthWindowCoverage(720, 1_440);
  const complete = healthWindowCoverage(1_440, 1_440);

  expect(empty.state).toBe("empty");
  expect(partial.state, "a half-covered window is partial, never empty").toBe("partial");
  expect(complete.state).toBe("complete");

  expect(
    partial.warning,
    "a partial window warns, or the reader cannot tell it from a whole one",
  ).not.toBe(null);
  expect(complete.warning, "a whole window has nothing to warn about").toBe(null);
  expect(
    partial.warning,
    "the partial sentence must not be the empty one — that is the collapse the ADR forbids",
  ).not.toBe(empty.warning);
}

/**
 * The pair is printed as a pair. The contract carries two integers rather than
 * a ratio for the reason `inRangeCount`/`sampleCount` does — `1439 / 1440` and
 * `1 / 1` are different facts, and a single percentage loses which one is held.
 */
export function coverageIsPrintedAsTwoIntegersNeverARatio(): void {
  const nearlyWhole = healthWindowCoverage(1_439, 1_440);
  const oneOfOne = healthWindowCoverage(1, 1);

  expect(nearlyWhole.detail).toBe("1439 / 1440 buckets");
  expect(oneOfOne.detail).toBe("1 / 1 buckets");
  expect(
    nearlyWhole.detail,
    "two windows that round to the same percentage must still print differently",
  ).not.toBe(oneOfOne.detail);
  // Neither string may be the quotient the ADR refuses to put on the wire.
  expect(nearlyWhole.detail).not.toContain("%");
  expect(nearlyWhole.detail).not.toContain("99.9");
}

/**
 * Covered past expected reads as complete, not as a warning.
 *
 * That state means the level's bucket width and `F3.35`'s ladder disagree,
 * which is `assertBucketCount`'s job on the server. A renderer that warned here
 * would report a server defect to an operator as a data gap.
 */
export function coverageBeyondTheExpectedCountReadsAsComplete(): void {
  const over = healthWindowCoverage(1_441, 1_440);
  expect(over.state).toBe("complete");
  expect(over.warning).toBe(null);
}

/**
 * An API image older than this contract must not produce an amber banner
 * reading "covers undefined of undefined buckets".
 *
 * This is reachable in production and only there: `checkResponse` throws in
 * dev and test, but logs and returns the ORIGINAL payload in production (ADR
 * 0030 decision 5), so both fields arrive `undefined` during any rolling
 * deploy where the API image lags the web bundle. Every comparison against
 * `undefined` is false, which without a guard lands on `partial` — the loudest
 * of the three states, on every healthy asset at once.
 *
 * The cast is the point of the test: the runtime case the types forbid is
 * exactly the one the network can deliver.
 */
export function anAbsentCoveragePairSaysNothingRatherThanUndefined(): void {
  const absent = healthWindowCoverage(
    undefined as unknown as number,
    undefined as unknown as number,
  );
  expect(absent.state, "an absent pair is its own state, not a silent complete").toBe("unknown");
  expect(absent.warning, "an unknown coverage must not warn about a window it cannot see").toBe(null);
  expect(absent.detail, "the em dash is this file's idiom for a value that is not there").toBe("—");
  expect(absent.detail).not.toContain("undefined");
  expect(absent.detail).not.toContain("NaN");

  // One field alone is the same fact: a payload half-way through a contract
  // change tells you nothing about coverage either.
  const half = healthWindowCoverage(399, undefined as unknown as number);
  expect(half.state).toBe("unknown");
  expect(half.warning).toBe(null);
}

/**
 * The partial sentence must not claim a score, because the state is reachable
 * with `score: null`.
 *
 * Counter rows exist for a tag whose every matching rule is unevaluatable, so
 * coverage is non-zero while `scoreAsset` returns null. A card in that state
 * would print an em dash above a sentence insisting the score is real.
 */
export function thePartialSentenceDoesNotClaimAScore(): void {
  const partial = healthWindowCoverage(399, 1_440);
  expect(partial.warning).not.toBe(null);
  expect(
    partial.warning?.toLowerCase(),
    "the sentence must not assert a score that may be null",
  ).not.toContain("the score is real");
  expect(partial.warning, "it still names both integers").toContain("399 of 1440 buckets");
}
