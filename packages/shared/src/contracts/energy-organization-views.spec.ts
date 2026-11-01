import { energyOrganizationViewsSchema } from "./energy-organization-views";

/**
 * `F4.299` U1 (ADR 0108 Amendment 1, 7.3) — the organization-views contract.
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

const SITE_ROW = { locationId: SITE_A, name: "Plant A", assetCount: 3, kwh: 1200.5, peakKw: 210, peakAt: "2026-10-31T03:00:00.000Z" };

export const ORGANIZATION_VIEWS_FIXTURE = {
  organizationId: ORG,
  timeZone: "Asia/Kolkata",
  generatedAt: "2026-10-31T05:00:01.000Z",
  level: "1h",
  bucket: "1h",
  current: { from: "2026-10-30T18:30:00.000Z", to: "2026-10-31T05:00:00.000Z", durationHours: 10.5 },
  compare: { from: "2026-10-30T08:00:00.000Z", to: "2026-10-30T18:30:00.000Z", durationHours: 10.5 },
  sites: {
    current: [SITE_ROW, { ...SITE_ROW, locationId: SITE_B, name: "Plant B", peakAt: null }],
    compare: [SITE_ROW],
    totalSites: 2,
  },
  trend: {
    columns: [
      { kind: "site", locationId: SITE_A, name: "Plant A" },
      { kind: "other" },
    ],
    points: [{ t: "2026-10-31T03:00:00.000Z", kw: [180, 20] }],
  },
  heatmap: { cells: [{ day: "2026-10-31", hour: 8, kwh: 42.5 }] },
  abnormal: {
    baseline: { windows: 4, windowsConsulted: 4, stepDays: 1, ratio: 1.5 },
    entries: [
      {
        kind: "site",
        id: SITE_A,
        code: null,
        name: "Plant A",
        siteName: null,
        currentKwh: 300,
        baselineKwh: 200,
        ratio: 1.5,
        verdict: "above",
        baselineWindows: 4,
      },
    ],
    normalCount: { sites: 1, assets: 5 },
    truncated: false,
  },
  partial: null,
};

/** A deep copy typed loosely enough to break one field at a time. */
type Doc = {
  compare: unknown;
  partial: unknown;
  sites: { compare: unknown };
  trend: { columns: unknown; points: { kw: unknown }[] };
  heatmap: { cells: { hour: number }[] };
  abnormal: { entries: { verdict: string }[] };
};

function clone(): Doc {
  return JSON.parse(JSON.stringify(ORGANIZATION_VIEWS_FIXTURE)) as Doc;
}

export function assertAFullFixtureParses(): void {
  const parsed = energyOrganizationViewsSchema.safeParse(ORGANIZATION_VIEWS_FIXTURE);
  assert(parsed.success, `the full fixture must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertHour24IsRefused(): void {
  const bad = clone();
  bad.heatmap.cells[0].hour = 24;
  assert(!energyOrganizationViewsSchema.safeParse(bad).success, "hour 24 must be refused");
  const edge = clone();
  edge.heatmap.cells[0].hour = 23;
  assert(energyOrganizationViewsSchema.safeParse(edge).success, "hour 23 must parse (the positive neighbour)");
}

export function assertANormalVerdictIsRefused(): void {
  const bad = clone();
  bad.abnormal.entries[0].verdict = "normal";
  assert(!energyOrganizationViewsSchema.safeParse(bad).success, "verdict normal is counted, never sent");
}

export function assertTheOtherColumnParsesAndASiteNeedsItsId(): void {
  const other = clone();
  other.trend.columns = [{ kind: "other" }];
  other.trend.points = [{ t: "2026-10-31T03:00:00.000Z", kw: [20] }];
  assert(energyOrganizationViewsSchema.safeParse(other).success, "an other-only column list must parse");
  const bad = clone();
  bad.trend.columns = [{ kind: "site" }];
  const parsed = energyOrganizationViewsSchema.safeParse(bad);
  assert(!parsed.success, "a site column without locationId must be refused");
  const paths = (parsed.error?.issues ?? []).map((i) => i.path.join("."));
  assert(
    paths.some((p) => p.includes("locationId") || p.includes("kind")),
    `the issue path must name locationId or kind, got ${JSON.stringify(paths)}`,
  );
  assert(
    paths.every((p) => p.startsWith("trend.columns.0")),
    `a discriminated union points at the column, got ${JSON.stringify(paths)}`,
  );
}

export function assertNullCompareAndPartialParse(): void {
  const doc = clone();
  doc.compare = null;
  doc.sites.compare = null;
  doc.partial = null;
  assert(energyOrganizationViewsSchema.safeParse(doc).success, "null compare and partial must parse");
  doc.partial = { readableSites: 3, selectedSites: 6 };
  assert(energyOrganizationViewsSchema.safeParse(doc).success, "a partial note must parse");
}

export function assertTrendKwIsANumberArray(): void {
  const bad = clone();
  bad.trend.points[0].kw = "180";
  assert(!energyOrganizationViewsSchema.safeParse(bad).success, "kw must be an array");
  const bad2 = clone();
  bad2.trend.points[0].kw = [180, "x"];
  assert(!energyOrganizationViewsSchema.safeParse(bad2).success, "kw must hold numbers");
}
