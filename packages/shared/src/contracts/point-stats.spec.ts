import { POINT_STATS_MAX_ASSETS, pointStatsByAssetSchema } from "./point-stats";

/**
 * `F4.291` PR 3 — the `get_point_stats` contract (ADR 0030). Assertions here;
 * the sibling `.test.ts` is the Vitest entry (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ROW = {
  assetId: "30000000-0000-4000-8000-000000000001",
  min: 1,
  avg: 1.75,
  max: 4,
  last: 4,
  lastAt: "2031-06-15T00:03:00.000Z",
  sampleCount: 4,
};

export const POINT_STATS_FIXTURE = {
  pointKey: "kw",
  from: "2031-06-15T00:00:00.000Z",
  to: "2031-06-22T00:00:00.000Z",
  bucketSeconds: 3_600,
  rows: [ROW],
};

export function assertTheFixtureParses(): void {
  const parsed = pointStatsByAssetSchema.safeParse(POINT_STATS_FIXTURE);
  assert(parsed.success, `the fixture must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertANegativeSampleCountIsRefused(): void {
  assert(pointStatsByAssetSchema.safeParse(POINT_STATS_FIXTURE).success, "the positive neighbour must parse");
  const parsed = pointStatsByAssetSchema.safeParse({ ...POINT_STATS_FIXTURE, rows: [{ ...ROW, sampleCount: -1 }] });
  assert(!parsed.success, "a negative sample count must be refused");
}

/** `null` says "no data"; an absent key says nothing, so it is refused. */
export function assertAMissingLastKeyIsRefused(): void {
  assert(
    pointStatsByAssetSchema.safeParse({ ...POINT_STATS_FIXTURE, rows: [{ ...ROW, last: null, lastAt: null }] }).success,
    "last: null must parse (the positive neighbour)",
  );
  const { last: _dropped, ...withoutLast } = ROW;
  const parsed = pointStatsByAssetSchema.safeParse({ ...POINT_STATS_FIXTURE, rows: [withoutLast] });
  assert(!parsed.success, "a row without the last key must be refused");
}

/** At most 25 rows: the copilot tool's per-page asset bound. */
export function assertMoreThan25RowsAreRefused(): void {
  const rows = (n: number) => Array.from({ length: n }, () => ROW);
  assert(
    pointStatsByAssetSchema.safeParse({ ...POINT_STATS_FIXTURE, rows: rows(POINT_STATS_MAX_ASSETS) }).success,
    "25 rows must parse (the positive neighbour)",
  );
  assert(
    !pointStatsByAssetSchema.safeParse({ ...POINT_STATS_FIXTURE, rows: rows(POINT_STATS_MAX_ASSETS + 1) }).success,
    "26 rows must be refused",
  );
}
