import { alarmStatsSchema } from "./alarm-stats";

/**
 * `F4.291` PR 2 — the `get_alarm_stats` contract (ADR 0030). Assertions here;
 * the sibling `.test.ts` is the Vitest entry (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export const ALARM_STATS_FIXTURE = {
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-08T00:00:00.000Z",
  raised: 5,
  open: 2,
  bySeverity: [
    { severity: "warning", raised: 3, open: 1 },
    { severity: "critical", raised: 2, open: 1 },
  ],
  byLocation: [{ locationId: "40000000-0000-4000-8000-000000000001", locationName: "Plant A", raised: 5, open: 2 }],
  moreLocations: false,
  topAssets: [{ assetId: "30000000-0000-4000-8000-000000000001", assetCode: "AHU-1", assetRtuName: "RTU 1", assetLocationName: "Plant A", assetName: "AHU 1", raised: 5 }],
  mttaSeconds: 600,
  mttrSeconds: null,
  acknowledgedCount: 1,
  clearedCount: 0,
};

export function assertTheFixtureParses(): void {
  const parsed = alarmStatsSchema.safeParse(ALARM_STATS_FIXTURE);
  assert(parsed.success, `the fixture must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertANegativeCountIsRefused(): void {
  assert(alarmStatsSchema.safeParse(ALARM_STATS_FIXTURE).success, "the positive neighbour must parse");
  const parsed = alarmStatsSchema.safeParse({
    ...ALARM_STATS_FIXTURE,
    bySeverity: [{ severity: "critical", raised: -1, open: 0 }],
  });
  assert(!parsed.success, "a negative count must be refused");
}

/** `null` says "nothing acknowledged"; an absent key says nothing, so it is refused. */
export function assertAMissingMttaKeyIsRefused(): void {
  assert(
    alarmStatsSchema.safeParse({ ...ALARM_STATS_FIXTURE, mttaSeconds: null }).success,
    "mttaSeconds: null must parse (the positive neighbour)",
  );
  const { mttaSeconds: _dropped, ...withoutMtta } = ALARM_STATS_FIXTURE;
  const parsed = alarmStatsSchema.safeParse(withoutMtta);
  assert(!parsed.success, "an answer without the mttaSeconds key must be refused");
}

/** `F4.316` PR 2 (ADR 0111): a top asset names its RTU and location — required, nullable. */
function topAssetWith(row: Record<string, unknown>): unknown {
  return { ...ALARM_STATS_FIXTURE, topAssets: [row] };
}

export function assertATopAssetWithoutAssetRtuNameIsRefused(): void {
  const { assetRtuName: _dropped, ...without } = ALARM_STATS_FIXTURE.topAssets[0]!;
  assert(!alarmStatsSchema.safeParse(topAssetWith(without)).success, "a top asset with no assetRtuName must be refused");
}

export function assertATopAssetWithoutAssetLocationNameIsRefused(): void {
  const { assetLocationName: _dropped, ...without } = ALARM_STATS_FIXTURE.topAssets[0]!;
  assert(!alarmStatsSchema.safeParse(topAssetWith(without)).success, "a top asset with no assetLocationName must be refused");
}

export function assertATopAssetWithNullPartsParses(): void {
  const parsed = alarmStatsSchema.safeParse(
    topAssetWith({ ...ALARM_STATS_FIXTURE.topAssets[0]!, assetRtuName: null, assetLocationName: null }),
  );
  assert(parsed.success, `null assetRtuName/assetLocationName must parse: ${JSON.stringify(parsed.error?.issues)}`);
}
