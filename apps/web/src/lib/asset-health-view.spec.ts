import { expect } from "vitest";

import {
  formatHealthComputedAt,
  formatHealthScorePercent,
  healthBandDisplay,
  healthDonutSlices,
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
