import type { HealthBand, HealthBandCount, HealthUnscoredTag } from "@bms/shared";

/**
 * `E1.3` Unit 8 — the pure rendering rules for the asset health surface (ADR
 * 0050 + Amendment 1). Kept out of the `.tsx` files so each rule the ADR
 * carries is a plain function a spec can call without a DOM, following
 * `widget-value.ts`'s split between "what to say" (here) and "how to draw it"
 * (the components).
 *
 * **Every rule below exists to keep one of the contract's four absences from
 * collapsing into another.** See `packages/shared/src/contracts/health.ts`'s
 * docblock for the four; this file is where each one earns a distinct string
 * rather than a shared fallback.
 */

/**
 * `score` is `0..1` on the wire (Amendment 1 decision 2) — this is the ONLY
 * place that multiplies by 100. `null` renders the em dash the rest of the UI
 * uses for "nothing to show", never `"0%"`: a real zero and an absent score
 * are different facts (ADR 0050's absence 1) and must print differently.
 */
export function formatHealthScorePercent(score: number | null, decimals = 0): string {
  if (score === null || !Number.isFinite(score)) {
    return "—";
  }
  return `${(score * 100).toFixed(decimals)}%`;
}

/**
 * `band: null` reads as "the template configures no bands", never as "no
 * data" — the asset in front of this string HAS a score (ADR 0050 Amendment 1
 * decision 3). The cut-point is rendered through `formatHealthScorePercent`
 * rather than compared against a percentage: `band.minScore` is `0..1`, the
 * same unit as `score`, and the two must never be compared across units.
 */
export function healthBandDisplay(band: HealthBand | null): string {
  if (band === null) {
    return "Unconfigured";
  }
  return `${band.label} · ≥ ${formatHealthScorePercent(band.minScore)}`;
}

/**
 * A tag excluded from the ratio (ADR 0050's absence 3) reads differently
 * depending on WHY. `skippedRuleCount === 0` is the ordinary case — no rule
 * matches this tag at all. Above zero means every matching rule carried a
 * NULL `operator`/`threshold_value` (Amendment 1 decision 7) — an operator
 * wrote a rule that silently does nothing, which is the inflation this
 * message exists to surface rather than hide behind one "unscored" label.
 */
export function unscoredTagMessage(tag: HealthUnscoredTag): string {
  return tag.skippedRuleCount > 0
    ? `${tag.pointKey}: ${tag.skippedRuleCount} rule${tag.skippedRuleCount === 1 ? "" : "s"} could not be evaluated`
    : `${tag.pointKey}: no threshold rule configured`;
}

/** `computedAt: null` means the roll-up has not covered this scope yet — say
 * that, never a fabricated `now`. An unparseable timestamp renders the same
 * em dash the rest of this surface uses, never `"Invalid Date"`. */
export function formatHealthComputedAt(computedAt: string | null): string {
  if (computedAt === null) {
    return "Not yet computed";
  }
  const at = new Date(computedAt);
  if (Number.isNaN(at.getTime())) {
    return "—";
  }
  return at.toLocaleString();
}

/**
 * How much of the requested window the figures beside it actually rest on.
 *
 * `state` is three-valued because `F4.72` (ADR 0050 Amendment 2 decision 1)
 * says two of the three must not render as each other. `coveredBuckets: 0` is
 * `"empty"` — nothing has been scored. `0 < coveredBuckets < expectedBuckets`
 * is `"partial"` — a REAL score, correct over the buckets it has, covering less
 * of the window than the reader asked for. Rendering the second as the first
 * hides a score that is right.
 */
export type HealthWindowCoverage = {
  readonly state: "empty" | "partial" | "complete";
  /** The pair, always printable — two integers, never a ratio. */
  readonly detail: string;
  /** `null` when complete: there is nothing to warn about. */
  readonly warning: string | null;
};

/**
 * The coverage state, from the two integers the contract carries.
 *
 * **The two integers are printed as a pair and never divided.** That is the
 * contract's own rule (`inRangeCount` beside `sampleCount`): `1439 / 1440` and
 * `1 / 1` are different facts and a single percentage loses which one you hold.
 *
 * `coveredBuckets >= expectedBuckets` is complete rather than an error. Covered
 * exceeding expected would mean the level's bucket width and the ladder
 * disagree, which is `assertBucketCount`'s job on the server; a renderer that
 * turned it into a warning would report a server defect as a data gap.
 */
export function healthWindowCoverage(
  coveredBuckets: number,
  expectedBuckets: number,
): HealthWindowCoverage {
  const detail = `${coveredBuckets} / ${expectedBuckets} buckets`;
  if (coveredBuckets >= expectedBuckets) {
    return { state: "complete", detail, warning: null };
  }
  if (coveredBuckets <= 0) {
    return {
      state: "empty",
      detail,
      warning: "No rolled-up bucket in this window — nothing here has been scored yet.",
    };
  }
  return {
    state: "partial",
    detail,
    warning:
      `Partial window: this figure covers ${coveredBuckets} of ${expectedBuckets} buckets. ` +
      "The score is real; the window behind it is not yet whole.",
  };
}

/** One donut slice, plus its share of the WHOLE asset count. */
export type HealthDonutSlice = {
  readonly code: string;
  readonly label: string;
  readonly count: number;
  /** `null` when `assetCount` is `0` — nothing to take a share of. */
  readonly percent: number | null;
};

/**
 * `bandCounts` turned into slices with a share against `assetCount` — the
 * client's own "count and share against a total asset count" (ADR 0050
 * Context). **The share is against the TOTAL, not against the sum of banded
 * counts** — a slice's percentage plus `unbandedAssetCount`'s and
 * `unscoredAssetCount`'s shares therefore add to (approximately) 100%, and no
 * caller may fold those two counts into this array: they are not slices,
 * they are why the slices do not already cover every asset.
 */
export function healthDonutSlices(
  bandCounts: readonly HealthBandCount[],
  assetCount: number,
): HealthDonutSlice[] {
  return bandCounts.map((band) => ({
    code: band.code,
    label: band.label,
    count: band.count,
    percent: assetCount > 0 ? (band.count / assetCount) * 100 : null,
  }));
}
