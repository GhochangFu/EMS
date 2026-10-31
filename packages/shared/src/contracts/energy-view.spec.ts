import { aggregateLevelSchema } from "./aggregate-level";
import { energyFilterOptionsSchema, energyViewQuerySchema, energyViewSchema } from "./energy-view";

/**
 * `F4.298` U1 (ADR 0108 decision 2) — the energy view contract: the query of
 * `GET /reports/energy/view`, its response, and `GET /reports/energy/filter-options`.
 * Assertions here; the sibling `.test.ts` is the Vitest entry (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ORG = "10000000-0000-4000-8000-000000000001";
const SITE_A = "40000000-0000-4000-8000-000000000001";
const SITE_B = "40000000-0000-4000-8000-000000000002";

const PERIOD = {
  from: "2026-10-30T18:30:00.000Z",
  to: "2026-10-31T05:00:00.000Z",
  durationHours: 10.5,
  hasData: true,
  totalKwh: 1234.5,
  peakKw: 210,
  peakAt: "2026-10-31T03:00:00.000Z",
  avgPf: 0.93,
  pueEstimate: null,
  indicativeCost: null,
  tariffPerKwh: null,
  currency: null,
  sourceTotals: { gridKwh: 1000, solarKwh: 234.5, dgKwh: 0 },
  series: [{ t: "2026-10-31T03:00:00.000Z", gridKw: 180, solarKw: 30, dgKw: 0 }],
};

export const ENERGY_VIEW_FIXTURE = {
  organizationId: ORG,
  timeZone: "Asia/Kolkata",
  generatedAt: "2026-10-31T05:00:01.000Z",
  level: "5m",
  bucket: "5m",
  current: PERIOD,
  compare: null,
  topConsumers: [
    { assetId: "30000000-0000-4000-8000-000000000001", code: "EM-1", name: "Meter 1", siteName: "Plant A", avgKw: 120, estimatedKwh: 1260 },
  ],
  partial: null,
};

export function assertTodayAloneParses(): void {
  const parsed = energyViewQuerySchema.safeParse({ range: "today" });
  assert(parsed.success, `range=today alone must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertABareLocationIdFoldsIntoAList(): void {
  const parsed = energyViewQuerySchema.safeParse({ range: "7d", locationIds: SITE_A });
  assert(parsed.success, `one bare locationIds must parse: ${JSON.stringify(parsed.error?.issues)}`);
  assert(
    JSON.stringify(parsed.data?.locationIds) === JSON.stringify([SITE_A]),
    `one bare locationIds must fold into a one-item list, got ${JSON.stringify(parsed.data?.locationIds)}`,
  );
}

export function assertARepeatedLocationIdListParses(): void {
  const parsed = energyViewQuerySchema.safeParse({ range: "7d", locationIds: [SITE_A, SITE_B] });
  assert(parsed.success, "two location ids must parse");
  assert(parsed.data?.locationIds?.length === 2, "two location ids must stay two");
}

export function assertAnUnknownKeyIsRefused(): void {
  assert(energyViewQuerySchema.safeParse({ range: "today" }).success, "the positive neighbour must parse");
  const parsed = energyViewQuerySchema.safeParse({ range: "today", startDate: "2026-10-01" });
  assert(!parsed.success, "the query is .strict(): an unknown key must be refused");
}

export function assertCompareNextIsRefused(): void {
  assert(energyViewQuerySchema.safeParse({ range: "today", compare: "previous" }).success, "compare=previous must parse");
  assert(!energyViewQuerySchema.safeParse({ range: "today", compare: "next" }).success, "compare=next must be refused");
}

export function assertANonUuidOrganizationIdIsRefused(): void {
  assert(energyViewQuerySchema.safeParse({ range: "today", organizationId: ORG }).success, "a uuid organizationId must parse");
  assert(
    !energyViewQuerySchema.safeParse({ range: "today", organizationId: "ESKOM" }).success,
    "a non-uuid organizationId must be refused",
  );
}

export function assertAnUnknownRangeIsRefused(): void {
  for (const range of ["today", "24h", "7d", "30d", "this_month", "1y", "custom"]) {
    assert(energyViewQuerySchema.safeParse({ range }).success, `range=${range} must parse`);
  }
  assert(!energyViewQuerySchema.safeParse({ range: "ytd" }).success, "range=ytd must be refused");
}

export function assertTheResponseWithNullCompareAndPartialParses(): void {
  const parsed = energyViewSchema.safeParse(ENERGY_VIEW_FIXTURE);
  assert(parsed.success, `the fixture must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertTheResponseWithCompareAndPartialParses(): void {
  const parsed = energyViewSchema.safeParse({
    ...ENERGY_VIEW_FIXTURE,
    compare: { ...PERIOD, hasData: false, totalKwh: 0, peakKw: 0, peakAt: null, avgPf: null, series: [] },
    partial: { readableSites: 2, selectedSites: 3 },
  });
  assert(parsed.success, `a compare period and a partial note must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertPartialCarriesCountsOnly(): void {
  const parsed = energyViewSchema.safeParse({
    ...ENERGY_VIEW_FIXTURE,
    partial: { readableSites: 2, selectedSites: 3, unreadableIds: [SITE_B] },
  });
  assert(!parsed.success, "partial is .strict(): an id list beside the two counts must be refused");
}

export function assertAnUnknownLevelIsRefused(): void {
  assert(!energyViewSchema.safeParse({ ...ENERGY_VIEW_FIXTURE, level: "15m" }).success, "level=15m must be refused");
}

export function assertTheLevelEnumIsTheLadder(): void {
  assert(
    JSON.stringify(aggregateLevelSchema.options) === JSON.stringify(["1m", "5m", "1h", "1d"]),
    `aggregateLevelSchema.options must be the ADR 0023 ladder, got ${JSON.stringify(aggregateLevelSchema.options)}`,
  );
}

export function assertTheFilterOptionsParse(): void {
  const parsed = energyFilterOptionsSchema.safeParse({
    organizations: [{ id: ORG, code: "ORG-A", name: "Organization A" }],
    locations: [
      { id: SITE_A, name: "Plant A", parentId: null, organizationId: ORG },
      { id: SITE_B, name: "Plant A — Block 1", parentId: SITE_A, organizationId: ORG },
    ],
  });
  assert(parsed.success, `the filter options must parse: ${JSON.stringify(parsed.error?.issues)}`);
}
