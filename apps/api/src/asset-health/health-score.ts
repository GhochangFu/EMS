import type {
  HealthBand,
  HealthBandCount,
  HealthSummaryResponse,
  HealthTagScore,
  HealthUnscoredTag,
  TemplateHealth,
} from "@bms/shared";

/**
 * `E1.3` (ADR 0050 + Amendment 1) — the pure half of the asset health score.
 *
 * Everything here is arithmetic over numbers the caller already read. No
 * database call, no clock, no NestJS decorator — the service that runs
 * `telemetry.point_in_range_*` and asset-template reads to produce
 * {@link TagCounts} is a later unit, exactly as `point-aggregate-window.ts` is
 * the pure half of `TelemetryService.pointAggregate`.
 *
 * The four-way absence distinction the wire contract
 * (`packages/shared/src/contracts/health.ts`) documents is enforced here, not
 * only described there: an unruled tag never becomes a scored `1.0`
 * (ADR 0050 decision 3), and a real `0` score is never confused with "nothing
 * scored" (`null`, Amendment 1's Consequences).
 */

/**
 * One tag's roll-up counters for the window being scored — one row (or the
 * zero-row absence) from `telemetry.point_in_range_<level>`.
 *
 * `ruleCount === 0` is the ADR 0050 decision 3 signal: no enabled, published
 * threshold rule matched this tag, so it carries no row in the roll-up
 * relation at all. The caller building this array must supply a `TagCounts`
 * entry for it anyway (`ruleCount: 0, skippedRuleCount: 0, inRangeCount: 0,
 * sampleCount: 0` or similar zero-fill), from the asset's catalog points, so
 * that `scoreAsset` sees the unruled tag rather than never learning it
 * exists — that assembly is the later unit's job, not this one's.
 *
 * **A precondition the assembler must also honour: `sampleCount > 0`
 * whenever `ruleCount > 0`.** A ruled tag with no telemetry in the window has
 * no roll-up row either — `rawRollupSql`/`levelRollupSql` only ever write a
 * row where at least one raw sample landed in the bucket — so there is no
 * `(inRangeCount, sampleCount)` pair to read for it. `scoreAsset` treats such
 * a tag as unscored rather than dividing by zero (see the guard below), but
 * the assembler should not rely on that as its only signal: a tag matched by
 * a rule with zero samples is a different fact from an unruled tag, and if a
 * later surface ever needs to tell the two apart it must do so before this
 * type collapses them.
 */
export type TagCounts = {
  pointKey: string;
  inRangeCount: number;
  sampleCount: number;
  /** Rules that matched this tag and were evaluated. */
  ruleCount: number;
  /** Rules that matched this tag but carried a NULL `operator`/`threshold_value`
   * (Amendment 1 decision 7) — never treated as "did not fire". */
  skippedRuleCount: number;
};

export type AssetScore = {
  /** `0..1`, or `null` when no tag on this asset could be scored (rule 5). */
  score: number | null;
  /**
   * `null` when `health` is absent, `health.bands` is empty, or `score` is
   * `null`. Never `null` merely because the score is low — a scored asset
   * with an unbandable score is reported via {@link AssetScore.score} being
   * non-null and `band` being `null`, not by omission.
   */
  band: HealthBand | null;
  scoredTags: HealthTagScore[];
  unscoredTags: HealthUnscoredTag[];
};

/**
 * Reads a resolved weight for `pointKey`, defaulting to `1`.
 *
 * `Object.hasOwn` rather than a bare `weights[pointKey]` index — the same
 * prototype-key guard `aggregateExpression` and `onboarding-redaction.ts` use.
 * `pointKey` ultimately comes from a `bms.asset_points` catalog row, which is
 * operator-authored free text (`safeKeySchema` at the boundary, not a closed
 * vocabulary here), so a value like `"constructor"` reaching this lookup is
 * not impossible. No caller triggers it today; the guard costs nothing.
 */
/** Stable, locale-independent ordering by `pointKey` — plain UTF-16 code-unit order. */
function comparePointKey(a: { pointKey: string }, b: { pointKey: string }): number {
  return a.pointKey < b.pointKey ? -1 : a.pointKey > b.pointKey ? 1 : 0;
}

function resolvedWeight(health: TemplateHealth | undefined, pointKey: string): number {
  const weights = health?.weights;
  if (weights !== undefined && Object.hasOwn(weights, pointKey)) {
    return weights[pointKey] as number;
  }
  return 1;
}

/**
 * The first band whose `minScore` is at or below `score` — rule 6.
 *
 * No re-sort here: `templateHealthSchema` in
 * `asset-templates-content.schema.ts` validates `health.bands` strictly
 * descending by `minScore` with the last band fixed at `0` before it is ever
 * stored, so the first match in authored order is the correct match, and
 * every `score` in `0..1` matches something. This function does not repeat
 * that validation — it trusts the boundary that already runs it.
 */
function resolveBand(score: number, health: TemplateHealth | undefined): HealthBand | null {
  if (health === undefined || health.bands.length === 0) {
    return null;
  }
  for (const band of health.bands) {
    if (band.minScore <= score) {
      return band;
    }
  }
  // Reachable only if the validator's "last band starts at 0" invariant has
  // been bypassed (a hand-edited row, a future write path that skips it).
  // `null` here is consistent with every other "no classification" case
  // rather than throwing on a read.
  return null;
}

/**
 * Scores one asset from its tags' roll-up counters and its template's
 * `health` configuration.
 *
 * Determinism (rule 7): `scoredTags` and `unscoredTags` are sorted by
 * `pointKey` before they are returned. Without this an object-keyed or
 * `Map`-based accumulator would pass a naive single-input test while
 * producing an order that depends on nothing the caller controls — and this
 * is a wire response, not an internal value, so an unstable order is an API
 * defect, not a style nit.
 */
export function scoreAsset(
  tags: readonly TagCounts[],
  health: TemplateHealth | undefined,
): AssetScore {
  const scoredTags: HealthTagScore[] = [];
  const unscoredTags: HealthUnscoredTag[] = [];

  for (const tag of tags) {
    // Rule 1: `ruleCount === 0` is UNSCORED regardless of `skippedRuleCount` —
    // both "no rule matched at all" (skippedRuleCount 0) and "every matching
    // rule was unevaluatable" (skippedRuleCount > 0) land here, never in
    // `scoredTags` with a fabricated ratio of 1.0.
    //
    // `sampleCount <= 0` is folded into the same branch as a defensive
    // guard, not a documented ADR state: a ruled tag can still have zero
    // samples in the window (no roll-up row was ever written for it — see
    // the `TagCounts` docblock), and scoring it would divide by zero and put
    // a `NaN` on the wire. Reporting it unscored is consistent with rule 5's
    // "null, not a fabricated number" and strictly safer than trusting an
    // assembler to have zero-filled correctly.
    if (tag.ruleCount === 0 || tag.sampleCount <= 0) {
      unscoredTags.push({ pointKey: tag.pointKey, skippedRuleCount: tag.skippedRuleCount });
      continue;
    }

    // Rule 2: the ratio, on 0..1. `sampleCount > 0` is a DB CHECK constraint
    // on every row this reads (`point_in_range_*_counts_check`), so this is
    // not guarded again here — a row that violates it could not exist.
    const ratio = tag.inRangeCount / tag.sampleCount;

    // Rule 3: the RESOLVED weight is what goes on the wire, never the
    // authored (possibly absent) one — a consumer must not have to re-derive
    // the default of 1 to explain a number it is shown.
    const weight = resolvedWeight(health, tag.pointKey);

    scoredTags.push({
      pointKey: tag.pointKey,
      score: ratio,
      weight,
      inRangeCount: tag.inRangeCount,
      sampleCount: tag.sampleCount,
      skippedRuleCount: tag.skippedRuleCount,
    });
  }

  // Plain code-unit comparison, NOT `localeCompare` — `localeCompare` is
  // locale/ICU-dependent (Node 20 in CI vs. a newer local Node can disagree
  // on case- and punctuation-sensitive ordering of the same two strings), so
  // it is not the stable byte order rule 7 requires for a wire response.
  scoredTags.sort(comparePointKey);
  unscoredTags.sort(comparePointKey);

  // Rule 5: `null`, not `0`, when nothing scored. A weighted mean over zero
  // terms is `0/0`, which is `NaN` in JS, not `0` — but the meaning intended
  // is "no data", and collapsing that to a numeric `0` would read as "every
  // sample was out of range", a materially different and worse claim.
  let score: number | null = null;
  if (scoredTags.length > 0) {
    const weightSum = scoredTags.reduce((sum, t) => sum + t.weight, 0);
    const weightedSum = scoredTags.reduce((sum, t) => sum + t.weight * t.score, 0);
    // `weightSum` cannot be `0` here: every resolved weight is either the
    // default `1` or a template-authored weight, and `templateHealthSchema`
    // requires an authored weight to be `.positive()` — so this is not a
    // defensive-but-untested branch, it documents why the division is safe.
    score = weightedSum / weightSum;
  }

  // Rule 6: `band` is `null` whenever `score` is `null` — never independently
  // computed against a fabricated score.
  const band = score === null ? null : resolveBand(score, health);

  return { score, band, scoredTags, unscoredTags };
}

/**
 * The donut summary over a set of already-scored assets.
 *
 * Returns everything `healthSummaryResponseSchema` needs except the four
 * window/currency fields, which belong to the caller that knows what range
 * and level it actually read (ADR 0050 decision 5, Amendment 1 decision 9) —
 * this function is handed only scores, never a window.
 */
export function summariseAssets(
  scores: readonly AssetScore[],
): Omit<
  HealthSummaryResponse,
  // Every field on the contract's shared `windowFields` block. This function is
  // handed only scores, so it can produce none of them — including `F4.72`'s two
  // coverage integers, which describe the read's window rather than its scores.
  | "windowFrom"
  | "windowTo"
  | "bucketSeconds"
  | "computedAt"
  | "coveredBuckets"
  | "expectedBuckets"
> {
  const assetCount = scores.length;

  const scored: (AssetScore & { score: number })[] = [];
  for (const s of scores) {
    if (s.score !== null) {
      scored.push(s as AssetScore & { score: number });
    }
  }
  const scoredAssetCount = scored.length;
  const unscoredAssetCount = assetCount - scoredAssetCount;

  // Amendment 1 decision 3: scored-but-unbanded assets are COUNTED, never
  // dropped from the donut's denominator.
  const unbandedAssetCount = scored.filter((s) => s.band === null).length;

  // Each asset weighted equally — an asset is one asset, unlike a tag inside
  // one asset's own score, which is weighted per `health.weights`.
  const score =
    scored.length === 0 ? null : scored.reduce((sum, s) => sum + s.score, 0) / scored.length;

  // Group by band `code`. A `Map` is used only for the O(1) accumulation —
  // the RESULT is explicitly re-sorted below by `minScore`, so nothing here
  // depends on `Map` iteration order surviving to the response.
  const byCode = new Map<string, { label: string; minScore: number; count: number }>();
  for (const s of scored) {
    if (s.band === null) {
      continue;
    }
    const existing = byCode.get(s.band.code);
    if (existing) {
      existing.count += 1;
    } else {
      // `label` carried from the FIRST occurrence, per the brief: two assets
      // naming the same `code` are assumed to agree, and the first one seen
      // (in the caller's input order) names the slice.
      byCode.set(s.band.code, { label: s.band.label, minScore: s.band.minScore, count: 1 });
    }
  }

  // Sorted by `minScore` descending so the donut reads Excellent-first,
  // regardless of the order assets arrived in or bands were first seen.
  const bandCounts: HealthBandCount[] = [...byCode.entries()]
    .sort(([, a], [, b]) => b.minScore - a.minScore)
    .map(([code, v]) => ({ code, label: v.label, count: v.count }));

  return { score, assetCount, scoredAssetCount, unbandedAssetCount, unscoredAssetCount, bandCounts };
}
