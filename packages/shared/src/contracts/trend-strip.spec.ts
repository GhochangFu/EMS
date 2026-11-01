import { aggregateLevelSchema } from "./aggregate-level";
import {
  TREND_STRIP_MAX_ASSETS_PER_POINT,
  TREND_STRIP_MAX_SERIES,
  TREND_STRIP_OVERVIEW_POINTS_PER_SEGMENT,
  TREND_STRIP_RANGES,
  siteTrendStripQuerySchema,
  siteTrendStripSchema,
} from "./trend-strip";

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
    !siteTrendStripQuerySchema.safeParse({ range: "24h", points: "kw" }).success,
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
