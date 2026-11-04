import { BadRequestException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload, SiteTrendPointsDto, SiteTrendStripQuery } from "@bms/shared";

import {
  SiteTrendStripService,
  TREND_STRIP_POINTS_NEED_SEGMENTS,
  stripSelectionFor,
  trendStripExportRowCount,
} from "./trend-strip.service";
import { stripWindow } from "./trend-strip.pure";

/**
 * `F4.301` U3 (ADR 0108 Amendment 2 items 1–4, 8) — `SiteTrendStripService`
 * over fakes with call logs (the `energy-view.service.spec.ts` style). What the
 * database answers is `trend-points.integration.spec.ts`'s (T1–T5) and
 * `trend-strip-read.integration.spec.ts`'s; this file holds the order of the
 * checks, the asset-id bound, the overview rule, the zone chain and the
 * aligned window. Vitest entry point: the sibling `.test.ts`.
 *
 * A spec may name a segment: the ADR 0108 §5.4 guard scans runtime modules.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "viewer" } as JwtPayload;
const ADMIN = { sub: "22222222-2222-4222-8222-222222222222", role: "admin" } as JwtPayload;
const ORG = "00000000-0000-4000-8000-0000000000aa";
const SITE = "40000000-0000-4000-8000-000000000001";
const GROUP = "50000000-0000-4000-8000-000000000001";
const ASSET_1 = "30000000-0000-4000-8000-000000000001";
const ASSET_2 = "30000000-0000-4000-8000-000000000002";
/** Readable by the scoped caller, but at another site: the site read never returns it. */
const ASSET_ELSEWHERE = "30000000-0000-4000-8000-0000000000ee";
const NOW = new Date("2026-11-01T10:47:13.000Z");

type AssetRow = {
  asset_id: string;
  asset_code: string;
  asset_name: string;
  domain: string;
  point_key: string;
  unit: string | null;
};

type Options = {
  /** `TrendPointsService.forSite`'s refusal, when set. */
  siteRefusal?: Error;
  /** `readableAssetIds`'s answer; `null` is a global admin. */
  readable?: string[] | null;
  /** Whether the named group is at the site. */
  groupAtSite?: boolean;
  /** The site (or group) asset × registration rows. */
  assetRows?: AssetRow[];
  locationZone?: string | null;
  organizationZone?: string | null;
  /** `F4.303` U4: the telemetry statement answers one sample per bound pair at `from`, so a bucket carries a value. */
  withSamples?: boolean;
};

type Statement = { text: string; params: unknown[] };

const CODES = ["supply_air_temp_c", "return_air_temp_c", "kw", "chw_supply_temp_c"] as const;

function siteDto(): SiteTrendPointsDto {
  return {
    locationId: SITE,
    organizationId: ORG,
    segments: [
      {
        domain: "hvac",
        label: "HVAC",
        source: "catalog",
        points: CODES.map((code) => ({ code, name: `Name ${code}`, unit: "°C" })),
      },
    ],
  } as unknown as SiteTrendPointsDto;
}

function rowsFor(assetId: string, assetCode: string): AssetRow[] {
  return CODES.map((point_key) => ({
    asset_id: assetId,
    asset_code: assetCode,
    asset_name: `Asset ${assetCode}`,
    domain: "hvac",
    point_key,
    unit: "°C",
  }));
}

function fake(options: Options = {}) {
  const calls: string[] = [];
  const statements: Statement[] = [];
  const trendPoints = {
    forSite: async (_jwt: JwtPayload, locationId: string) => {
      calls.push(`forSite:${locationId}`);
      if (options.siteRefusal) throw options.siteRefusal;
      return siteDto();
    },
  };
  const access = {
    readableAssetIds: async () => {
      calls.push("readableAssetIds");
      return options.readable === undefined ? null : options.readable;
    },
  };
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      statements.push({ text, params });
      if (text.includes("telemetry.")) {
        calls.push("pool:telemetry");
        if (!options.withSamples) return { rows: [] };
        const ids = params[0] as string[];
        const keys = params[1] as string[];
        return { rows: ids.map((id, i) => ({ asset_id: id, point_key: keys[i], t: params[2], v: i + 1.5 })) };
      }
      if (text.includes("bms.asset_points")) {
        calls.push("pool:assets");
        return { rows: options.assetRows ?? [...rowsFor(ASSET_1, "AHU-1"), ...rowsFor(ASSET_2, "AHU-2")] };
      }
      if (text.includes("bms.organizations")) {
        calls.push("pool:zone");
        return {
          rows: [
            {
              location_zone: options.locationZone === undefined ? null : options.locationZone,
              organization_zone: options.organizationZone === undefined ? "Asia/Kolkata" : options.organizationZone,
            },
          ],
        };
      }
      if (text.includes("bms.asset_groups")) {
        calls.push("pool:group");
        return { rows: options.groupAtSite === false ? [] : [{ ok: 1 }] };
      }
      throw new Error(`unexpected statement: ${text}`);
    },
  };
  const service = new SiteTrendStripService(pool as never, access as never, trendPoints as never);
  return { service, calls, statements };
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error("resolved, expected a refusal");
}

const WHOLE_SITE: SiteTrendStripQuery = { range: "24h" };
const ON_GROUP: SiteTrendStripQuery = { range: "24h", assetGroupId: GROUP };

function telemetry(statements: readonly Statement[]): Statement[] {
  return statements.filter((s) => s.text.includes("telemetry."));
}

/** The asset ids bound to the telemetry statement (`$1::uuid[]`), sorted. */
function boundAssetIds(statements: readonly Statement[]): string[] {
  const [read] = telemetry(statements);
  expect(read, "precondition: the telemetry statement ran").toBeDefined();
  const ids = read?.params[0];
  expect(Array.isArray(ids), "the asset ids are bound as an array, never null").toBe(true);
  return [...new Set(ids as string[])].sort();
}

/** `forSite` runs before any pool statement. */
export async function forSiteRunsBeforeAnyPoolRead(): Promise<void> {
  const f = fake();
  await f.service.forSite(USER, SITE, WHOLE_SITE, NOW);
  expect(f.calls[0]).toBe(`forSite:${SITE}`);
  expect(f.calls.filter((c) => c.startsWith("pool:")).length, "adjacent positive: the pool was read after").toBeGreaterThan(0);
}

/** `forSite`'s 404 propagates, and no pool statement runs. */
export async function anUnreadableSiteIsA404WithNoPoolRead(): Promise<void> {
  const refused = new NotFoundException("Location not found or outside your access scope");
  const f = fake({ siteRefusal: refused });
  const err = await refusal(f.service.forSite(USER, SITE, WHOLE_SITE, NOW));
  expect(err).toBe(refused);
  expect(f.statements).toEqual([]);
}

/** A group that is not at the site is a 404, and no telemetry statement runs. */
export async function aGroupOfAnotherSiteIsA404(): Promise<void> {
  const f = fake({ groupAtSite: false });
  const err = await refusal(f.service.forSite(USER, SITE, ON_GROUP, NOW));
  expect(err).toBeInstanceOf(NotFoundException);
  expect(err.message).toBe("Asset group not found at this site");
  expect(telemetry(f.statements)).toEqual([]);
  expect(f.calls).toContain("pool:group");
}

/** A global admin (`readableAssetIds` → `null`) reads exactly the site's asset ids. */
export async function aGlobalAdminReadsTheSitesAssetIds(): Promise<void> {
  const f = fake({ readable: null });
  await f.service.forSite(ADMIN, SITE, WHOLE_SITE, NOW);
  expect(boundAssetIds(f.statements)).toEqual([ASSET_1, ASSET_2]);
}

/** A scoped caller reads the intersection of its readable assets and the site's. */
export async function aScopedCallerReadsTheIntersection(): Promise<void> {
  const f = fake({ readable: [ASSET_1, ASSET_ELSEWHERE] });
  await f.service.forSite(USER, SITE, WHOLE_SITE, NOW);
  expect(boundAssetIds(f.statements)).toEqual([ASSET_1]);
}

/** An empty intersection answers `segments: []` and reads no telemetry. */
export async function anEmptyIntersectionReadsNoTelemetry(): Promise<void> {
  const f = fake({ readable: [ASSET_ELSEWHERE] });
  const out = await f.service.forSite(USER, SITE, WHOLE_SITE, NOW);
  expect(out.segments).toEqual([]);
  expect(telemetry(f.statements)).toEqual([]);
}

/** The paired positive: a non-empty intersection answers a segment and reads telemetry once. */
export async function aNonEmptyIntersectionReadsTelemetryOnce(): Promise<void> {
  const f = fake({ readable: [ASSET_1] });
  const out = await f.service.forSite(USER, SITE, WHOLE_SITE, NOW);
  expect(out.segments.map((s) => s.domain)).toEqual(["hvac"]);
  expect(telemetry(f.statements)).toHaveLength(1);
}

/** With `assetGroupId`, the asset read is bound to the site and the group (members ∩ site). */
export async function aGroupBindsTheAssetReadToItsMembers(): Promise<void> {
  const f = fake();
  await f.service.forSite(USER, SITE, ON_GROUP, NOW);
  const read = f.statements.find((s) => s.text.includes("bms.asset_points"));
  expect(read?.text).toContain("bms.asset_group_members");
  expect(read?.params).toEqual([SITE, GROUP]);
}

/** With `assetGroupId`, a member the caller cannot read is dropped (members ∩ readable ∩ site). */
export async function aGroupIntersectsWithReadable(): Promise<void> {
  const f = fake({ readable: [ASSET_2] });
  await f.service.forSite(USER, SITE, ON_GROUP, NOW);
  expect(boundAssetIds(f.statements)).toEqual([ASSET_2]);
}

/** A whole-site strip keeps the first 3 points per segment. */
export async function aWholeSiteStripIsTheOverview(): Promise<void> {
  const f = fake();
  const out = await f.service.forSite(USER, SITE, WHOLE_SITE, NOW);
  expect(out.segments[0]?.points.map((p) => p.code)).toEqual(CODES.slice(0, 3));
  expect(out.assetGroupId).toBeNull();
}

/** A group strip keeps the full list. */
export async function aGroupStripIsTheFullList(): Promise<void> {
  const f = fake();
  const out = await f.service.forSite(USER, SITE, ON_GROUP, NOW);
  expect(out.segments[0]?.points.map((p) => p.code)).toEqual([...CODES]);
  expect(out.assetGroupId).toBe(GROUP);
}

/** A stored `UTC` reports `UTC` (the arithmetic zone is `Etc/UTC`). */
export async function aStoredUtcReportsUtc(): Promise<void> {
  const f = fake({ locationZone: "UTC", organizationZone: "Asia/Kolkata" });
  const out = await f.service.forSite(USER, SITE, WHOLE_SITE, NOW);
  expect(out.timeZone).toBe("UTC");
}

/** No location zone falls to the organization's. */
export async function noLocationZoneUsesTheOrganizations(): Promise<void> {
  const f = fake({ locationZone: null, organizationZone: "Asia/Kolkata" });
  const out = await f.service.forSite(USER, SITE, WHOLE_SITE, NOW);
  expect(out.timeZone).toBe("Asia/Kolkata");
}

/** `from`, `to`, `level` and `bucketSeconds` are `stripWindow`'s, and they reach the statement. */
export async function theWindowIsStripWindows(): Promise<void> {
  const f = fake();
  const out = await f.service.forSite(USER, SITE, { range: "7d" }, NOW);
  const w = stripWindow("7d", NOW);
  expect([out.from, out.to, out.level, out.bucketSeconds, out.range]).toEqual([
    w.from.toISOString(),
    w.to.toISOString(),
    w.level,
    w.bucketSeconds,
    "7d",
  ]);
  const [read] = telemetry(f.statements);
  expect(read?.params.slice(2, 4)).toEqual([w.from, w.to]);
}

/** Every series is gap-filled to the window's bucket count. */
export async function everySeriesHasTheWindowsBuckets(): Promise<void> {
  const f = fake();
  const out = await f.service.forSite(USER, SITE, WHOLE_SITE, NOW);
  const lengths = out.segments.flatMap((s) => s.points.flatMap((p) => p.assets.map((a) => a.buckets.length)));
  expect(lengths.length).toBeGreaterThan(0);
  expect(new Set(lengths)).toEqual(new Set([48]));
}

// ---------------------------------------------------------------------------
// `F4.303` U4 (ADR 0108 Amendment 6 item 3) — the strip export: `frameFor`
// (every refusal and the planned pairs), the cap over its arithmetic, then
// `readFrame`'s one telemetry statement. Data rows start after the five header
// rows, the blank row and the column header.
// ---------------------------------------------------------------------------

const HEADER_ROWS = 7;

/** G6: each exported `mean` per (segment, point, asset, bucket) is `forSite`'s bucket `v` for the same query. */
export async function theStripExportMeansAreForSitesBuckets(): Promise<void> {
  const f = fake({ withSamples: true });
  const dto = await f.service.forSite(USER, SITE, WHOLE_SITE, NOW);
  const rows = await f.service.exportRows(USER, SITE, WHOLE_SITE, NOW);
  const expected = dto.segments.flatMap((s) =>
    s.points.flatMap((p) => p.assets.flatMap((a) => a.buckets.map((b) => [s.domain, p.code, a.assetCode, b.v]))),
  );
  expect(expected.some((row) => typeof row[3] === "number"), "precondition: a bucket carries a value").toBe(true);
  expect(rows.slice(HEADER_ROWS).map((row) => [row[0], row[1], row[2], row[6]])).toEqual(expected);
}

/** G7: a group not at the site is the read's 404 on the export, and no telemetry statement runs. */
export async function aStripExportOnAGroupOfAnotherSiteIsA404(): Promise<void> {
  const f = fake({ groupAtSite: false });
  const err = await refusal(f.service.exportRows(USER, SITE, ON_GROUP, NOW));
  expect(err).toBeInstanceOf(NotFoundException);
  expect(err.message).toBe("Asset group not found at this site");
  expect(telemetry(f.statements)).toEqual([]);
}

/** The cap: a lowered cap refuses with the owner's sentence before the telemetry statement. */
export async function aLoweredCapRefusesTheStripExportBeforeTelemetry(): Promise<void> {
  const f = fake();
  const err = await refusal(f.service.exportRows(USER, SITE, WHOLE_SITE, NOW, 10));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(err.message).toBe("Export would hold 288 rows, above the 10 row limit. Narrow the range or the points.");
  expect(telemetry(f.statements)).toEqual([]);
}

/** The adjacent positive: the real cap admits the same export, and its one telemetry statement runs. */
export async function theRealCapAdmitsTheStripExport(): Promise<void> {
  const f = fake();
  await f.service.exportRows(USER, SITE, WHOLE_SITE, NOW);
  expect(telemetry(f.statements)).toHaveLength(1);
}

/** The row count is pairs × the window's buckets: 6 pairs over 24 h of 30-minute buckets is 288. */
export function theStripRowCountIsPairsTimesBuckets(): void {
  const pairs = Array.from({ length: 6 }, (_, i) => ({ assetId: ASSET_1, pointKey: `p${i}` }));
  expect(trendStripExportRowCount(pairs, stripWindow("24h", NOW))).toBe(288);
}

/** The CSV is the rows through the F4.29 writer: its first line is the zone row. */
export async function theStripCsvOpensWithTheZoneRow(): Promise<void> {
  const f = fake();
  const csv = await f.service.exportCsv(USER, SITE, WHOLE_SITE);
  expect(csv.split("\n")[0]).toBe("zone,Asia/Kolkata");
}

const A1 = { assetId: ASSET_1, assetCode: "AHU-1", assetName: "Asset AHU-1", unit: "°C" };
const A2 = { assetId: ASSET_2, assetCode: "AHU-2", assetName: "Asset AHU-2", unit: "°C" };

/** Frozen from `frameFor` at `ca58ca39` (before `F4.306` U4): a query without a selection is today's frame. */
const GOLDEN_FRAME = {
  locationId: SITE,
  assetGroupId: null,
  range: "24h",
  window: {
    range: "24h",
    from: "2026-10-31T10:30:00.000Z",
    to: "2026-11-01T10:30:00.000Z",
    level: "5m",
    bucketSeconds: 1800,
    buckets: 48,
  },
  timeZone: "Asia/Kolkata",
  plan: {
    segments: [
      {
        domain: "hvac",
        label: "HVAC",
        source: "catalog",
        points: [
          { code: "supply_air_temp_c", name: "Name supply_air_temp_c", unit: "°C", assets: [A1, A2], moreAssets: 0 },
          { code: "return_air_temp_c", name: "Name return_air_temp_c", unit: "°C", assets: [A1, A2], moreAssets: 0 },
          { code: "kw", name: "Name kw", unit: "°C", assets: [A1, A2], moreAssets: 0 },
        ],
      },
    ],
    assetsPerPoint: 6,
    pointsPerSegment: 3,
    trimmed: false,
  },
  pairs: [
    { assetId: ASSET_1, pointKey: "supply_air_temp_c" },
    { assetId: ASSET_2, pointKey: "supply_air_temp_c" },
    { assetId: ASSET_1, pointKey: "return_air_temp_c" },
    { assetId: ASSET_2, pointKey: "return_air_temp_c" },
    { assetId: ASSET_1, pointKey: "kw" },
    { assetId: ASSET_2, pointKey: "kw" },
  ],
};

/** No `segments` and no `points`: `JSON.stringify` of the frame is the frozen golden, byte for byte. */
export async function noSelectionFrameIsTheGolden(): Promise<void> {
  const f = fake();
  const frame = await f.service.frameFor(USER, SITE, WHOLE_SITE, NOW);
  expect(JSON.stringify(frame)).toBe(JSON.stringify(GOLDEN_FRAME));
}

const POINTS_ONLY: SiteTrendStripQuery = { range: "24h", points: "hvac:chw_supply_temp_c" };
const CHOSEN: SiteTrendStripQuery = { range: "24h", segments: "hvac", points: "hvac:chw_supply_temp_c" };

/** `points` without `segments` is a 400 with the exported sentence, no code echoed, and no telemetry statement. */
export async function pointsWithoutSegmentsIsA400BeforeTelemetry(): Promise<void> {
  const f = fake();
  const err = await refusal(f.service.forSite(USER, SITE, POINTS_ONLY, NOW));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(err.message).toBe(TREND_STRIP_POINTS_NEED_SEGMENTS);
  expect(err.message).not.toMatch(/hvac|chw_supply_temp_c/);
  expect(telemetry(f.statements)).toEqual([]);
}

/** The adjacent positive: the same `points` beside `segments` reads telemetry once, over the chosen point only. */
export async function pointsWithSegmentsReadsTheChosenPoint(): Promise<void> {
  const f = fake();
  const out = await f.service.forSite(USER, SITE, CHOSEN, NOW);
  expect(telemetry(f.statements)).toHaveLength(1);
  expect(out.segments.map((s) => s.points.map((p) => p.code))).toEqual([["chw_supply_temp_c"]]);
  expect(out.pointsPerSegment).toBe(1);
}

/** The export route refuses `points` without `segments` the same way, through `frameFor`. */
export async function theExportRefusesPointsWithoutSegments(): Promise<void> {
  const f = fake();
  const err = await refusal(f.service.exportRows(USER, SITE, POINTS_ONLY, NOW));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(err.message).toBe(TREND_STRIP_POINTS_NEED_SEGMENTS);
  expect(telemetry(f.statements)).toEqual([]);
}

/** A scoped caller over a selection binds no foreign pair; the admin's positive case binds both site assets. */
export async function aSelectionKeepsTheScope(): Promise<void> {
  const admin = fake({ readable: null });
  await admin.service.forSite(ADMIN, SITE, CHOSEN, NOW);
  expect(boundAssetIds(admin.statements)).toEqual([ASSET_1, ASSET_2]);

  const scoped = fake({ readable: [ASSET_1, ASSET_ELSEWHERE] });
  await scoped.service.forSite(USER, SITE, CHOSEN, NOW);
  expect(boundAssetIds(scoped.statements)).toEqual([ASSET_1]);
  const [read] = telemetry(scoped.statements);
  expect(read?.params[1]).toEqual(["chw_supply_temp_c"]);
}

/** The CSV export over a selection carries only the chosen point (a 4th code, past the overview's cut). */
export async function theCsvOverASelectionCarriesOnlyTheChosenPoint(): Promise<void> {
  const f = fake();
  const csv = await f.service.exportCsv(USER, SITE, CHOSEN);
  const data = csv
    .split("\n")
    .slice(HEADER_ROWS)
    .filter((line) => line.length > 0);
  expect(data.length, "precondition: the export holds data rows").toBe(2 * 48);
  expect(new Set(data.map((line) => line.split(",")[1]))).toEqual(new Set(["chw_supply_temp_c"]));
}

/** A hand-typed repeat is not a 400: a duplicate segment and a duplicate entry count once. */
export function aDuplicateEntryCountsOnce(): void {
  const selection = stripSelectionFor({
    segments: "hvac,power,hvac",
    points: "hvac:kw,power:kw,hvac:kw,hvac:supply_air_temp_c",
  });
  expect([...(selection?.segments ?? [])]).toEqual(["hvac", "power"]);
  expect(selection?.points.get("hvac")).toEqual(["kw", "supply_air_temp_c"]);
  expect(selection?.points.get("power")).toEqual(["kw"]);
}

/** No `segments` is no selection (today's rule); `segments` alone is a selection with no entries. */
export function noSegmentsIsNoSelection(): void {
  expect(stripSelectionFor({})).toBeUndefined();
  const selection = stripSelectionFor({ segments: "hvac" });
  expect([...(selection?.segments ?? [])]).toEqual(["hvac"]);
  expect(selection?.points.size).toBe(0);
}

/** Through the service, a duplicate entry binds each pair once. */
export async function aDuplicateEntryBindsEachPairOnce(): Promise<void> {
  const f = fake();
  await f.service.forSite(USER, SITE, { range: "24h", segments: "hvac,hvac", points: "hvac:kw,hvac:kw" }, NOW);
  const [read] = telemetry(f.statements);
  expect(read?.params[1]).toEqual(["kw", "kw"]);
  expect(read?.params[0]).toEqual([ASSET_1, ASSET_2]);
}
