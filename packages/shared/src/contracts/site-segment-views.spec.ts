import {
  ABNORMAL_BELOW_RATIO,
  ABNORMAL_NEAR_ZERO_FRACTION,
  SEGMENT_RANKING_MAX,
  SEGMENT_VIEW_SERIES_MAX,
  siteSegmentViewsQuerySchema,
  siteSegmentViewsSchema,
} from "./site-segment-views";
import { ABNORMAL_RATIO } from "./energy-organization-views";

/**
 * `F4.302` U1 (ADR 0108 Amendment 4, items 4, 5 and 6) — the segment-views contract: the query of
 * `GET /control-room/sites/:locationId/segment-views`, its response and the four constants.
 * Assertions here; the sibling `.test.ts` is the Vitest entry (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const SITE = "40000000-0000-4000-8000-000000000001";
const ASSET = "30000000-0000-4000-8000-000000000001";
const VERDICTS = ["above", "below", "not_comparable", "not_enough_history"] as const;

const entry = (verdict: string) => ({
  assetId: ASSET,
  assetCode: "EM-1",
  assetRtuName: "RTU 1",
  assetLocationName: "Site 1",
  assetName: "Meter 1",
  unit: "kW",
  currentMean: 12.5,
  baselineMean: verdict === "not_enough_history" ? null : 10,
  ratio: verdict === "above" || verdict === "below" ? 1.25 : null,
  verdict,
  baselineWindows: 4,
});

export const SEGMENT_VIEWS_FIXTURE = {
  locationId: SITE,
  timeZone: "Asia/Kolkata",
  generatedAt: "2026-11-02T05:00:00.000Z",
  level: "5m",
  bucket: "5m",
  current: { from: "2026-11-01T05:00:00.000Z", to: "2026-11-02T05:00:00.000Z", durationHours: 24 },
  compare: null,
  segments: [{ domain: "seg-a", label: "Segment A", assetCount: 1 }],
  segment: { domain: "seg-a", label: "Segment A", source: "catalog" },
  points: [{ code: "kw", name: "Active power", unit: "kW" }],
  point: { code: "kw", name: "Active power", unit: "kW" },
  ranking: [
    {
      assetId: ASSET,
      assetCode: "EM-1",
      assetRtuName: "RTU 1",
      assetLocationName: "Site 1",
      assetName: "Meter 1",
      unit: "kW",
      current: { mean: 12.5, max: 20, maxAt: "2026-11-02T01:00:00.000Z", sampleCount: 288 },
      compare: null,
      buckets: null,
      compareBuckets: null,
    },
  ],
  moreAssets: 0,
  seriesCount: 0,
  trimmed: false,
  abnormal: {
    baseline: { windows: 4, windowsConsulted: 4, stepDays: 1, ratio: 1.5, belowRatio: 0.5, nearZeroFraction: 0.01 },
    entries: VERDICTS.map(entry),
    normalCount: 3,
    truncated: false,
  },
};

export function assertTheQueryRefusesAnUnknownKey(): void {
  assert(siteSegmentViewsQuerySchema.safeParse({ range: "24h" }).success, "the positive neighbour must parse");
  assert(
    !siteSegmentViewsQuerySchema.safeParse({ range: "24h", extra: "1" }).success,
    "the query is .strict(): an unknown key must be refused",
  );
}

export function assertTheQueryRefusesOrganizationIdAndLocationIds(): void {
  assert(!siteSegmentViewsQuerySchema.safeParse({ range: "24h", organizationId: SITE }).success, "organizationId");
  assert(!siteSegmentViewsQuerySchema.safeParse({ range: "24h", locationIds: SITE }).success, "locationIds");
}

export function assertTheQueryRefusesABadSegmentCode(): void {
  assert(siteSegmentViewsQuerySchema.safeParse({ range: "24h", segment: "hvac-1", point: "kw_2" }).success, "a code parses");
  assert(!siteSegmentViewsQuerySchema.safeParse({ range: "24h", segment: "a b" }).success, "a space is refused");
  assert(!siteSegmentViewsQuerySchema.safeParse({ range: "24h", point: "k/w" }).success, "a slash is refused");
}

export function assertTheQueryRefusesABadRange(): void {
  assert(!siteSegmentViewsQuerySchema.safeParse({ range: "90d" }).success, "90d is not a range");
  assert(!siteSegmentViewsQuerySchema.safeParse({}).success, "range is required");
}

export function assertTheQueryAcceptsEachRangeAndCompare(): void {
  for (const range of ["today", "24h", "7d", "30d", "this_month", "1y", "custom"]) {
    assert(siteSegmentViewsQuerySchema.safeParse({ range }).success, `range ${range} must parse`);
  }
  assert(siteSegmentViewsQuerySchema.safeParse({ range: "7d", compare: "previous" }).success, "compare=previous");
  assert(!siteSegmentViewsQuerySchema.safeParse({ range: "7d", compare: "next" }).success, "compare=next");
  assert(
    siteSegmentViewsQuerySchema.safeParse({
      range: "custom",
      from: "2026-11-01T00:00:00+05:30",
      to: "2026-11-02T00:00:00Z",
    }).success,
    "a custom range takes offset instants",
  );
}

export function assertTheResponseParsesWithNullBuckets(): void {
  const parsed = siteSegmentViewsSchema.safeParse(SEGMENT_VIEWS_FIXTURE);
  assert(parsed.success, `the fixture must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertTheResponseParsesEveryVerdict(): void {
  const parsed = siteSegmentViewsSchema.safeParse(SEGMENT_VIEWS_FIXTURE);
  assert(parsed.success && parsed.data.abnormal.entries.length === 4, "all four verdicts must parse");
}

export function assertTheResponseRefusesAFifthVerdict(): void {
  const bad = {
    ...SEGMENT_VIEWS_FIXTURE,
    abnormal: { ...SEGMENT_VIEWS_FIXTURE.abnormal, entries: [entry("normal")] },
  };
  assert(!siteSegmentViewsSchema.safeParse(bad).success, "`normal` is counted, never sent: it must be refused");
}

export function assertTheConstantsArePinned(): void {
  assert(SEGMENT_VIEW_SERIES_MAX === 8, "the chart carries 8 assets");
  assert(SEGMENT_RANKING_MAX === 50, "the ranking carries 50 assets");
  assert(ABNORMAL_BELOW_RATIO === 0.5, "below is at -50 % of the baseline");
  assert(ABNORMAL_NEAR_ZERO_FRACTION === 0.01, "near zero is 1 % of the scale");
}

export function assertTheRatiosStraddleOne(): void {
  assert(ABNORMAL_BELOW_RATIO < 1 && 1 < ABNORMAL_RATIO, "ABNORMAL_BELOW_RATIO < 1 < ABNORMAL_RATIO");
}

/** `F4.316` (ADR 0111) — a ranking entry without `assetLocationName` is refused: the field is required. */
export function assertARankingEntryWithoutTheLocationNameIsRefused(): void {
  const [ranked] = SEGMENT_VIEWS_FIXTURE.ranking;
  const { assetLocationName: _dropped, ...withoutLocation } = ranked;
  const bad = { ...SEGMENT_VIEWS_FIXTURE, ranking: [withoutLocation] };
  assert(!siteSegmentViewsSchema.safeParse(bad).success, "a ranking entry without assetLocationName must be refused");
}

/** `F4.316` (ADR 0111) — an abnormal entry without `assetRtuName` is refused: the field is required. */
export function assertAnAbnormalEntryWithoutTheRtuNameIsRefused(): void {
  const { assetRtuName: _dropped, ...withoutRtu } = entry("above");
  const bad = { ...SEGMENT_VIEWS_FIXTURE, abnormal: { ...SEGMENT_VIEWS_FIXTURE.abnormal, entries: [withoutRtu] } };
  assert(!siteSegmentViewsSchema.safeParse(bad).success, "an abnormal entry without assetRtuName must be refused");
}

/** `F4.316` (ADR 0111) — an RTU-less asset parses in both lists with `assetRtuName: null`. */
export function assertAnRtuLessAssetParsesInBothLists(): void {
  const [ranked] = SEGMENT_VIEWS_FIXTURE.ranking;
  const rtuLess = {
    ...SEGMENT_VIEWS_FIXTURE,
    ranking: [{ ...ranked, assetRtuName: null }],
    abnormal: { ...SEGMENT_VIEWS_FIXTURE.abnormal, entries: [{ ...entry("above"), assetRtuName: null }] },
  };
  const parsed = siteSegmentViewsSchema.safeParse(rtuLess);
  assert(parsed.success, `an RTU-less asset must parse: ${JSON.stringify(parsed.error?.issues)}`);
}
