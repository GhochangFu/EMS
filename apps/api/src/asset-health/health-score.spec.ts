import type { TemplateHealth } from "@bms/shared";

import { type TagCounts, scoreAsset, summariseAssets } from "./health-score";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function tag(pointKey: string, overrides: Partial<TagCounts> = {}): TagCounts {
  return {
    pointKey,
    inRangeCount: 8,
    sampleCount: 10,
    ruleCount: 1,
    skippedRuleCount: 0,
    ...overrides,
  };
}

const bands: TemplateHealth["bands"] = [
  { code: "excellent", label: "Excellent", minScore: 0.9 },
  { code: "good", label: "Good", minScore: 0.75 },
  { code: "fair", label: "Fair", minScore: 0.5 },
  { code: "poor", label: "Poor", minScore: 0.25 },
  { code: "critical", label: "Critical", minScore: 0 },
];

/** Rule 1: `ruleCount === 0` is UNSCORED, whether or not a rule was skipped. */
function testUnruledTagIsNeverScoredAsPerfect(): void {
  const noRuleMatched = tag("kw", { ruleCount: 0, skippedRuleCount: 0, inRangeCount: 0, sampleCount: 0 });
  const everyMatchWasSkipped = tag("kwh", { ruleCount: 0, skippedRuleCount: 3, inRangeCount: 0, sampleCount: 0 });

  const result = scoreAsset([noRuleMatched, everyMatchWasSkipped], undefined);

  assert(result.scoredTags.length === 0, "neither tag should be scored");
  assert(result.unscoredTags.length === 2, "both tags should be unscored");
  const byKey = new Map(result.unscoredTags.map((t) => [t.pointKey, t]));
  assert(byKey.get("kw")?.skippedRuleCount === 0, "the no-rule-matched tag carries skippedRuleCount 0");
  assert(byKey.get("kwh")?.skippedRuleCount === 3, "the all-skipped tag carries its skippedRuleCount");
  assert(result.score === null, "an asset with no scored tag must score null");
}

/** Rule 2: the ratio is inRangeCount / sampleCount, on 0..1. */
function testRatioIsInRangeOverSample(): void {
  const result = scoreAsset([tag("kw", { inRangeCount: 3, sampleCount: 4, ruleCount: 1 })], undefined);
  assert(result.scoredTags.length === 1, "one scored tag expected");
  assert(result.scoredTags[0]?.score === 0.75, `expected ratio 0.75, got ${result.scoredTags[0]?.score}`);
}

/** Rule 3: the RESOLVED weight goes on the wire, an omitted weight resolves to 1. */
function testWeightResolvesToOneWhenOmitted(): void {
  const health: TemplateHealth = { bands, weights: { kw: 5 } };
  const result = scoreAsset(
    [tag("kw", { ruleCount: 1 }), tag("kwh", { ruleCount: 1 })],
    health,
  );
  const byKey = new Map(result.scoredTags.map((t) => [t.pointKey, t]));
  assert(byKey.get("kw")?.weight === 5, `expected authored weight 5, got ${byKey.get("kw")?.weight}`);
  assert(byKey.get("kwh")?.weight === 1, `expected default weight 1, got ${byKey.get("kwh")?.weight}`);
}

/** Rule 4: score is the weighted mean over scored tags. */
function testScoreIsWeightedMean(): void {
  const health: TemplateHealth = { bands, weights: { a: 3, b: 1 } };
  const result = scoreAsset(
    [
      tag("a", { inRangeCount: 10, sampleCount: 10 }), // ratio 1.0, weight 3
      tag("b", { inRangeCount: 0, sampleCount: 10 }), // ratio 0.0, weight 1
    ],
    health,
  );
  // (3*1.0 + 1*0.0) / (3+1) = 0.75
  assert(result.score === 0.75, `expected weighted mean 0.75, got ${result.score}`);
}

/** Rule 5: score is null (not 0) when there is no scored tag at all. */
function testScoreIsNullNotZeroWhenNothingScored(): void {
  const result = scoreAsset([], undefined);
  assert(result.score === null, "an empty tag list must score null");
  assert(result.score !== 0, "null and 0 must not be confused");
}

/**
 * Defensive guard: a ruled tag (`ruleCount > 0`) with `sampleCount === 0` —
 * possible because a matched rule produces no roll-up row at all when a tag
 * has no telemetry in the window — must never divide by zero into `NaN`. It
 * is reported unscored, the same as an unruled tag, rather than putting a
 * `NaN` on a `z.number()` wire field.
 */
function testRuledTagWithNoSamplesIsUnscoredNotNaN(): void {
  const result = scoreAsset(
    [tag("kw", { ruleCount: 2, skippedRuleCount: 0, inRangeCount: 0, sampleCount: 0 })],
    undefined,
  );
  assert(result.scoredTags.length === 0, "a zero-sample tag must not be scored");
  assert(result.unscoredTags.length === 1, "a zero-sample tag must be reported unscored");
  assert(Number.isFinite(result.score) || result.score === null, `score must never be NaN, got ${result.score}`);
  assert(result.score === null, "with no other scored tag, the asset score must be null, not NaN");
}

/** Rule 6: band selection, and the four ways it can be null. */
function testBandSelection(): void {
  const health: TemplateHealth = { bands };

  const excellent = scoreAsset([tag("kw", { inRangeCount: 10, sampleCount: 10 })], health);
  assert(excellent.band?.code === "excellent", `expected excellent band, got ${JSON.stringify(excellent.band)}`);

  const critical = scoreAsset([tag("kw", { inRangeCount: 0, sampleCount: 10 })], health);
  assert(critical.band?.code === "critical", `expected critical band, got ${JSON.stringify(critical.band)}`);

  const boundary = scoreAsset([tag("kw", { inRangeCount: 9, sampleCount: 10 })], health); // score 0.9
  assert(boundary.band?.code === "excellent", `boundary score 0.9 must match "excellent" (minScore <=)`);

  // band null because health is undefined, even though the score is real.
  const noHealth = scoreAsset([tag("kw", { inRangeCount: 10, sampleCount: 10 })], undefined);
  assert(noHealth.score === 1, "sanity: score should be real");
  assert(noHealth.band === null, "band must be null when health is undefined");

  // band null because health.bands is empty, even though the score is real.
  const emptyBands = scoreAsset([tag("kw", { inRangeCount: 10, sampleCount: 10 })], { bands: [] });
  assert(emptyBands.score === 1, "sanity: score should be real");
  assert(emptyBands.band === null, "band must be null when health.bands is empty");

  // band null because score itself is null — not because the score is low.
  const nothingScored = scoreAsset([tag("kw", { ruleCount: 0, inRangeCount: 0, sampleCount: 0 })], health);
  assert(nothingScored.score === null, "sanity: score should be null");
  assert(nothingScored.band === null, "band must be null when score is null");
}

/**
 * Rule 7: determinism — stable, locale-INDEPENDENT pointKey ordering.
 *
 * The fixture is deliberately not all-lowercase-ASCII: `CALCWRITE_C`,
 * `backup_min` and `kw` are real point keys from ADR 0050's own measured
 * fixtures, and they are the case that discriminates a correct plain
 * code-unit sort from `localeCompare`, which a CI Node (20) and a newer local
 * Node (24, different ICU data) can resolve differently for the same two
 * strings. Code-unit order puts every uppercase letter before every
 * lowercase one, so `CALCWRITE_C` sorts before `backup_min`.
 */
function testOutputOrderIsStableByPointKey(): void {
  const scoredInput = [tag("kw"), tag("CALCWRITE_C"), tag("backup_min")];
  const unscoredInput = [
    tag("yankee", { ruleCount: 0 }),
    tag("bravo", { ruleCount: 0 }),
    tag("delta", { ruleCount: 0 }),
  ];
  const result = scoreAsset([...scoredInput, ...unscoredInput], undefined);

  const scoredKeys = result.scoredTags.map((t) => t.pointKey);
  assert(
    JSON.stringify(scoredKeys) === JSON.stringify(["CALCWRITE_C", "backup_min", "kw"]),
    `expected scoredTags in plain code-unit order, got ${JSON.stringify(scoredKeys)}`,
  );

  const unscoredKeys = result.unscoredTags.map((t) => t.pointKey);
  assert(
    JSON.stringify(unscoredKeys) === JSON.stringify(["bravo", "delta", "yankee"]),
    `expected unscoredTags sorted by pointKey, got ${JSON.stringify(unscoredKeys)}`,
  );

  // Same input, computed twice, must produce byte-identical output.
  const again = scoreAsset([...scoredInput, ...unscoredInput], undefined);
  assert(
    JSON.stringify(again) === JSON.stringify(result),
    "scoreAsset must be deterministic for the same input",
  );
}

/** summariseAssets: equal per-asset weighting, and the null/0 distinction again at asset level. */
function testSummaryWeightsEachAssetEqually(): void {
  const summary = summariseAssets([
    { score: 1, band: null, scoredTags: [], unscoredTags: [] },
    { score: 0, band: null, scoredTags: [], unscoredTags: [] },
  ]);
  assert(summary.score === 0.5, `expected mean 0.5 across two equally-weighted assets, got ${summary.score}`);
}

function testSummaryScoreIsNullWhenNoAssetScored(): void {
  const summary = summariseAssets([
    { score: null, band: null, scoredTags: [], unscoredTags: [] },
    { score: null, band: null, scoredTags: [], unscoredTags: [] },
  ]);
  assert(summary.score === null, "summary score must be null, not 0, when nothing scored");
  assert(summary.assetCount === 2, "assetCount counts every input");
  assert(summary.scoredAssetCount === 0, "nothing scored");
  assert(summary.unscoredAssetCount === 2, "both assets are unscored");
}

/** unbandedAssetCount: scored-but-unbanded assets are counted, never dropped. */
function testUnbandedAssetsAreCountedNotDropped(): void {
  const summary = summariseAssets([
    { score: 0.5, band: null, scoredTags: [], unscoredTags: [] }, // scored, no band
    { score: 0.9, band: { code: "excellent", label: "Excellent", minScore: 0.9 }, scoredTags: [], unscoredTags: [] },
  ]);
  assert(summary.scoredAssetCount === 2, "both assets scored");
  assert(summary.unbandedAssetCount === 1, "the bandless asset must be counted as unbanded");
  const total = summary.bandCounts.reduce((sum, b) => sum + b.count, 0);
  assert(
    summary.scoredAssetCount === summary.unbandedAssetCount + total,
    "scoredAssetCount must equal unbandedAssetCount + sum(bandCounts.count)",
  );
}

/** bandCounts: grouped by code, label from first occurrence, sorted by descending minScore. */
function testBandCountsGroupedAndSortedDescending(): void {
  const excellentBand = { code: "excellent", label: "Excellent", minScore: 0.9 };
  const criticalBand = { code: "critical", label: "Critical", minScore: 0 };
  const summary = summariseAssets([
    { score: 0, band: criticalBand, scoredTags: [], unscoredTags: [] },
    { score: 1, band: excellentBand, scoredTags: [], unscoredTags: [] },
    { score: 1, band: excellentBand, scoredTags: [], unscoredTags: [] },
  ]);

  assert(summary.bandCounts.length === 2, `expected 2 band slices, got ${summary.bandCounts.length}`);
  assert(
    summary.bandCounts[0]?.code === "excellent" && summary.bandCounts[1]?.code === "critical",
    `expected excellent before critical (descending minScore), got ${JSON.stringify(summary.bandCounts)}`,
  );
  assert(summary.bandCounts[0]?.count === 2, "excellent must count 2 assets");
  assert(summary.bandCounts[0]?.label === "Excellent", "label must be carried from the band");
}

/** The two invariants that stop an asset being silently dropped, across several shapes. */
function testAssetAccountingInvariantsHoldAcrossInputs(): void {
  const excellentBand = { code: "excellent", label: "Excellent", minScore: 0.9 };
  const inputs: { score: number | null; band: typeof excellentBand | null }[][] = [
    [],
    [{ score: null, band: null }],
    [{ score: 0.5, band: null }],
    [{ score: 1, band: excellentBand }],
    [
      { score: null, band: null },
      { score: 0.5, band: null },
      { score: 1, band: excellentBand },
      { score: 1, band: excellentBand },
    ],
  ];

  for (const input of inputs) {
    const scores = input.map((i) => ({ ...i, scoredTags: [], unscoredTags: [] }));
    const summary = summariseAssets(scores);
    const bandTotal = summary.bandCounts.reduce((sum, b) => sum + b.count, 0);
    assert(
      summary.scoredAssetCount === summary.unbandedAssetCount + bandTotal,
      `invariant 1 broken for ${JSON.stringify(input)}: ${JSON.stringify(summary)}`,
    );
    assert(
      summary.assetCount === summary.scoredAssetCount + summary.unscoredAssetCount,
      `invariant 2 broken for ${JSON.stringify(input)}: ${JSON.stringify(summary)}`,
    );
  }
}

/** Assertions for `E1.3`'s pure health scoring (ADR 0050 + Amendment 1, ADR 0014 §4.6). */
export async function runHealthScoreTests(): Promise<void> {
  testUnruledTagIsNeverScoredAsPerfect();
  testRatioIsInRangeOverSample();
  testWeightResolvesToOneWhenOmitted();
  testScoreIsWeightedMean();
  testScoreIsNullNotZeroWhenNothingScored();
  testRuledTagWithNoSamplesIsUnscoredNotNaN();
  testBandSelection();
  testOutputOrderIsStableByPointKey();
  testSummaryWeightsEachAssetEqually();
  testSummaryScoreIsNullWhenNoAssetScored();
  testUnbandedAssetsAreCountedNotDropped();
  testBandCountsGroupedAndSortedDescending();
  testAssetAccountingInvariantsHoldAcrossInputs();
}
