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
  topAssets: [{ assetId: "30000000-0000-4000-8000-000000000001", assetCode: "AHU-1", assetName: "AHU 1", raised: 5 }],
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
