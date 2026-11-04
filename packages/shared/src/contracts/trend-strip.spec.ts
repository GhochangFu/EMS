import { aggregateLevelSchema } from "./aggregate-level";
import {
  TREND_STRIP_MAX_ASSETS_PER_POINT,
  TREND_STRIP_MAX_SERIES,
  TREND_STRIP_OVERVIEW_POINTS_PER_SEGMENT,
  TREND_STRIP_RANGES,
  TREND_STRIP_QUERY_POINTS_MAX,
  TREND_STRIP_QUERY_SEGMENTS_MAX,
  siteTrendStripQuerySchema,
  siteTrendStripSchema,
} from "./trend-strip";
import { TREND_STRIP_POINT_CODE_MAX, TREND_STRIP_SEGMENT_CODE_MAX } from "./trend-strip-widget";

/**
 * `F4.301` U1 (ADR 0108 Amendment 2, items 3, 5 and 8) — the Control Room
 * trend strip contract: the query of `GET /control-room/sites/:locationId/trend-strip`,
 * its response, the per-range read table and the caps. Assertions here; the
 * sibling `.test.ts` is the Vitest entry (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const SITE = "40000000-0000-4000-8000-000000000001";
const GROUP = "50000000-0000-4000-8000-000000000001";
const ASSET = "30000000-0000-4000-8000-000000000001";

export const TREND_STRIP_FIXTURE = {
  locationId: SITE,
  assetGroupId: null,
  range: "24h",
  from: "2026-10-31T05:00:00.000Z",
  to: "2026-11-01T05:00:00.000Z",
  level: "5m",
  bucketSeconds: 1800,
  timeZone: "Asia/Kolkata",
  assetsPerPoint: 6,
  pointsPerSegment: 3,
  trimmed: false,
  segments: [
    {
      domain: "seg-a",
      label: "Segment A",
      source: "catalog",
      points: [
        {
          code: "kw",
          name: "Active power",
          unit: "kW",
          moreAssets: 0,
          assets: [
            {
              assetId: ASSET,
              assetCode: "EM-1",
              assetName: "Meter 1",
              unit: "kW",
              buckets: [
                { t: "2026-10-31T05:00:00.000Z", v: 12.5 },
                { t: "2026-10-31T05:30:00.000Z", v: null },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export function assertRange24hAloneParses(): void {
  const parsed = siteTrendStripQuerySchema.safeParse({ range: "24h" });
  assert(parsed.success, `range=24h alone must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertRange1yIsRefused(): void {
  assert(siteTrendStripQuerySchema.safeParse({ range: "30d" }).success, "the positive neighbour range=30d must parse");
  assert(!siteTrendStripQuerySchema.safeParse({ range: "1y" }).success, "range=1y must be refused");
}

export function assertANonUuidAssetGroupIdIsRefused(): void {
  assert(
    siteTrendStripQuerySchema.safeParse({ range: "7d", assetGroupId: GROUP }).success,
    "a uuid assetGroupId must parse",
  );
  assert(
    !siteTrendStripQuerySchema.safeParse({ range: "7d", assetGroupId: "ups-battery" }).success,
    "a non-uuid assetGroupId must be refused",
  );
}

export function assertAnUnknownKeyIsRefused(): void {
  assert(siteTrendStripQuerySchema.safeParse({ range: "24h" }).success, "the positive neighbour must parse");
  assert(
    !siteTrendStripQuerySchema.safeParse({ range: "24h", colors: "x" }).success,
    "the query is .strict(): an unknown key must be refused",
  );
}

export function assertAResponseWithNoSegmentsParses(): void {
  const parsed = siteTrendStripSchema.safeParse({ ...TREND_STRIP_FIXTURE, segments: [] });
  assert(parsed.success, `segments: [] must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertAResponseWithANullBucketParses(): void {
  const parsed = siteTrendStripSchema.safeParse(TREND_STRIP_FIXTURE);
  assert(parsed.success, `the fixture (null bucket, moreAssets 0, trimmed false) must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertANegativeMoreAssetsIsRefused(): void {
  const [segment] = TREND_STRIP_FIXTURE.segments;
  const [point] = segment!.points;
  const parsed = siteTrendStripSchema.safeParse({
    ...TREND_STRIP_FIXTURE,
    segments: [{ ...segment, points: [{ ...point, moreAssets: -1 }] }],
  });
  assert(!parsed.success, "moreAssets is a count: -1 must be refused");
}

export function assertANonDatetimeFromIsRefused(): void {
  assert(
    !siteTrendStripSchema.safeParse({ ...TREND_STRIP_FIXTURE, from: "yesterday" }).success,
    "from must be an ISO datetime",
  );
}

export function assertTheRangeTableHasExactlyThreeKeys(): void {
  const keys = Object.keys(TREND_STRIP_RANGES);
  assert(
    JSON.stringify(keys) === JSON.stringify(["24h", "7d", "30d"]),
    `TREND_STRIP_RANGES must hold 24h, 7d, 30d in that order, got ${JSON.stringify(keys)}`,
  );
}

export function assertEachRangeDividesIntoAtMost60Buckets(): void {
  for (const [range, spec] of Object.entries(TREND_STRIP_RANGES)) {
    const windowSeconds = spec.windowMinutes * 60;
    assert(
      windowSeconds % spec.bucketSeconds === 0,
      `${range}: bucketSeconds ${spec.bucketSeconds} must divide the window ${windowSeconds} s exactly`,
    );
    const buckets = windowSeconds / spec.bucketSeconds;
    assert(buckets <= 60, `${range}: ${buckets} buckets exceeds 60`);
  }
}

export function assertEachBucketWidthDividesADay(): void {
  for (const [range, spec] of Object.entries(TREND_STRIP_RANGES)) {
    assert(
      86_400 % spec.bucketSeconds === 0,
      `${range}: bucketSeconds ${spec.bucketSeconds} must divide 86 400 so the epoch and time_bucket alignments agree`,
    );
  }
}

export function assertEachLevelIsOnTheLadder(): void {
  for (const [range, spec] of Object.entries(TREND_STRIP_RANGES)) {
    assert(aggregateLevelSchema.safeParse(spec.level).success, `${range}: level ${spec.level} is not on the ADR 0023 ladder`);
  }
}

export function assertTheMaxAssetsPerPointIs6(): void {
  assert(TREND_STRIP_MAX_ASSETS_PER_POINT === 6, `got ${TREND_STRIP_MAX_ASSETS_PER_POINT}`);
}

export function assertTheMaxSeriesIs180(): void {
  assert(TREND_STRIP_MAX_SERIES === 180, `got ${TREND_STRIP_MAX_SERIES}`);
}

export function assertTheOverviewPointsPerSegmentIs3(): void {
  assert(TREND_STRIP_OVERVIEW_POINTS_PER_SEGMENT === 3, `got ${TREND_STRIP_OVERVIEW_POINTS_PER_SEGMENT}`);
}

/*
 * `F4.306` U2 (ADR 0108 Amendment 7) — the selection on the route query: `segments` is
 * `code(,code)*`, `points` is `code:code(,code:code)*`, each half a catalog code. The length
 * bounds are built from the widget config's per-entry limits, so a stored point whose code is
 * 128 characters long is a query the route accepts. "`points` without `segments`" parses here;
 * the 400 is the service's (U4).
 */

function query(extra: Record<string, unknown>) {
  return siteTrendStripQuerySchema.safeParse({ range: "24h", ...extra });
}

export function assertRange24hParsesToExactlyTheRange(): void {
  const parsed = siteTrendStripQuerySchema.safeParse({ range: "24h" });
  assert(parsed.success, "range=24h alone must parse");
  assert(
    JSON.stringify(parsed.data) === JSON.stringify({ range: "24h" }),
    `range=24h must parse to exactly { range: "24h" }, got ${JSON.stringify(parsed.data)}`,
  );
}

export function assertOneSegmentParses(): void {
  const parsed = query({ segments: "hvac" });
  assert(parsed.success, `segments=hvac must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertTwoSegmentsParse(): void {
  const parsed = query({ segments: "a,b" });
  assert(parsed.success, `segments=a,b must parse: ${JSON.stringify(parsed.error?.issues)}`);
  assert(parsed.data?.segments === "a,b", `segments must stay the raw string, got ${JSON.stringify(parsed.data?.segments)}`);
}

export function assertAnEmptySegmentEntryIsRefused(): void {
  assert(query({ segments: "a,b" }).success, "the positive neighbour segments=a,b must parse");
  assert(!query({ segments: "a,,b" }).success, "segments=a,,b must be refused");
}

export function assertATrailingSegmentCommaIsRefused(): void {
  assert(query({ segments: "a" }).success, "the positive neighbour segments=a must parse");
  assert(!query({ segments: "a," }).success, "segments=a, must be refused");
}

export function assertASegmentOutsideTheCatalogPatternIsRefused(): void {
  assert(query({ segments: "a_b-1" }).success, "the positive neighbour segments=a_b-1 must parse");
  assert(!query({ segments: "a.b" }).success, "segments=a.b must be refused (CATALOG_CODE_PATTERN)");
}

export function assertAnOverLongSegmentsIsRefused(): void {
  const code = "s".repeat(TREND_STRIP_SEGMENT_CODE_MAX);
  const list = Array.from({ length: 30 }, () => code).join(",");
  assert(list.length <= TREND_STRIP_QUERY_SEGMENTS_MAX, `30 longest codes (${list.length}) must fit the bound`);
  assert(query({ segments: list }).success, "30 segment codes of the longest length must parse");
  const over = "s".repeat(TREND_STRIP_QUERY_SEGMENTS_MAX + 1);
  assert(!query({ segments: over }).success, `a segments of ${over.length} characters must be refused`);
}

export function assertTwoPointsParse(): void {
  const parsed = query({ segments: "hvac,ups", points: "hvac:kw,ups:soc" });
  assert(parsed.success, `points=hvac:kw,ups:soc must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertABarePointCodeIsRefused(): void {
  assert(query({ segments: "hvac", points: "hvac:kw" }).success, "the positive neighbour points=hvac:kw must parse");
  assert(!query({ segments: "hvac", points: "kw" }).success, "a bare code in points must be refused");
  assert(!query({ segments: "hvac", points: "hvac:kw,kw" }).success, "a bare second code in points must be refused");
}

export function assertAnEmptyPointEntryIsRefused(): void {
  assert(!query({ segments: "hvac", points: "hvac:kw,,hvac:kva" }).success, "an empty points entry must be refused");
  assert(!query({ segments: "hvac", points: "hvac:kw," }).success, "a trailing points comma must be refused");
}

export function assertTheLongestStoredPointParses(): void {
  const segment = "s".repeat(TREND_STRIP_SEGMENT_CODE_MAX);
  const entry = `${segment}:${"p".repeat(TREND_STRIP_POINT_CODE_MAX)}`;
  const list = Array.from({ length: 30 }, () => entry).join(",");
  assert(list.length <= TREND_STRIP_QUERY_POINTS_MAX, `30 longest entries (${list.length}) must fit the bound`);
  assert(query({ segments: segment, points: list }).success, "30 points of the longest stored length must parse");
  assert(
    !query({ segments: segment, points: "a:" + "p".repeat(TREND_STRIP_QUERY_POINTS_MAX) }).success,
    "a points over the bound must be refused",
  );
}

export function assertPointsWithoutSegmentsParses(): void {
  const parsed = query({ points: "hvac:kw" });
  assert(parsed.success, `points without segments must parse here (the 400 is the service's): ${JSON.stringify(parsed.error?.issues)}`);
}
