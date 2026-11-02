import { NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload, SiteSegmentViewsQuery, SiteTrendPointsDto } from "@bms/shared";
import { siteSegmentViewsSchema } from "@bms/shared";

import { SEGMENT_NOT_FOUND, SEGMENT_POINT_NOT_FOUND } from "./segment-views.pure";
import { SiteSegmentViewsService } from "./segment-views.service";
import type { SiteAssetRow } from "./site-asset-rows";

/**
 * `F4.302` U2 (ADR 0108 Amendment 4 items 4–5) — `SiteSegmentViewsService`
 * over fakes with call logs (the `trend-strip.service.spec.ts` style). What the
 * database answers is `segment-views-read.integration.spec.ts`'s and
 * `segment-views.integration.spec.ts`'s; this file holds the order of the
 * checks, the asset-id bound, the two-statement budget, the caps and the
 * assembly. Vitest entry point: the sibling `.test.ts`.
 *
 * A spec may name a segment or a point: the ADR 0108 §5.4 guard scans runtime
 * modules only.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "viewer" } as JwtPayload;
const ORG = "00000000-0000-4000-8000-0000000000aa";
const SITE = "40000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-02T10:47:13.000Z");

function uuid(n: number): string {
  return `30000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function siteDto(): SiteTrendPointsDto {
  const point = (code: string) => ({ code, name: `Name ${code}`, unit: "kW", active: true });
  const segment = (domain: string, codes: string[]) => ({
    domain,
    label: `Label ${domain}`,
    source: "catalog" as const,
    points: codes.map(point),
    catalogDefaults: [],
    updatedAt: null,
    updatedBy: null,
  });
  return {
    locationId: SITE,
    organizationId: ORG,
    segments: [segment("electrical", ["kw"]), segment("hvac", ["kw", "supply_air_temp_c"]), segment("ups", ["backup_min"])],
  };
}

function hvacRows(count: number, first = 1): SiteAssetRow[] {
  return Array.from({ length: count }, (_, i) => {
    const n = first + i;
    const code = `AHU-${String(n).padStart(3, "0")}`;
    return { asset_id: uuid(n), asset_code: code, asset_name: `Asset ${code}`, domain: "hvac", point_key: "kw", unit: "kW" };
  });
}

/** A `ups` asset first in code order, then the `hvac` ones: `electrical` has none, so `hvac` is the first present. */
const UPS_ROW: SiteAssetRow = {
  asset_id: uuid(900),
  asset_code: "AAA-UPS",
  asset_name: "UPS",
  domain: "ups",
  point_key: "backup_min",
  unit: "min",
};

type Statement = { text: string; params: unknown[] };

type Options = {
  siteRefusal?: Error;
  /** `readableAssetIds`'s answer; `null` is a global admin. */
  readable?: string[] | null;
  assetRows?: SiteAssetRow[];
};

/** Statement A's answer: every bound asset has a row in every bound window, the mean falling with the asset's number. */
function windowRowsFor(params: unknown[]) {
  const idxs = params[0] as number[];
  const ids = params[4] as string[];
  return ids.flatMap((id) =>
    idxs.map((idx) => {
      const n = Number.parseInt(id.slice(-12), 16);
      const mean = idx === 0 ? 1_000 - n : 500 - n;
      return {
        idx,
        asset_id: id,
        mean,
        max: mean + 1,
        max_at: "2026-11-02T08:00:00.000Z",
        sample_count: 12,
        bucket_count: 12,
      };
    }),
  );
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
        if (text.includes("unnest($1::int[]")) {
          calls.push("pool:windows");
          return { rows: windowRowsFor(params) };
        }
        calls.push("pool:series");
        return { rows: [] };
      }
      if (text.includes("bms.asset_points")) {
        calls.push("pool:assets");
        return { rows: options.assetRows ?? [UPS_ROW, ...hvacRows(3)] };
      }
      if (text.includes("bms.organizations")) {
        calls.push("pool:zone");
        return { rows: [{ location_zone: "Asia/Kolkata", organization_zone: "Etc/UTC" }] };
      }
      throw new Error(`unexpected statement: ${text}`);
    },
  };
  const service = new SiteSegmentViewsService(pool as never, access as never, trendPoints as never);
  const telemetry = () => statements.filter((s) => s.text.includes("telemetry."));
  return { service, calls, statements, telemetry };
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error("resolved, expected a refusal");
}

const Q: SiteSegmentViewsQuery = { range: "24h" };

/** `TrendPointsService.forSite` runs before any pool read. */
export async function forSiteRunsFirst(): Promise<void> {
  const f = fake();
  await f.service.forSite(USER, SITE, Q, NOW);
  expect(f.calls[0]).toBe(`forSite:${SITE}`);
}

/** A foreign site's 404 propagates, and no statement at all is sent. */
export async function aForeignSiteIsA404WithNoStatement(): Promise<void> {
  const f = fake({ siteRefusal: new NotFoundException("Location not found or outside your access scope") });
  expect(await refusal(f.service.forSite(USER, SITE, Q, NOW))).toBeInstanceOf(NotFoundException);
  expect(f.statements).toEqual([]);
}

/** An unknown segment is the 404, before the scope and any telemetry statement. */
export async function anUnknownSegmentIsA404BeforeTheScope(): Promise<void> {
  const f = fake();
  const err = await refusal(f.service.forSite(USER, SITE, { ...Q, segment: "nope" }, NOW));
  expect(err.message).toBe(SEGMENT_NOT_FOUND);
  expect(f.calls).toEqual([`forSite:${SITE}`]);
}

/** A point outside the asked segment's list is the 404, before the scope and any telemetry statement. */
export async function aPointOutsideTheSegmentIsA404(): Promise<void> {
  const f = fake();
  const err = await refusal(f.service.forSite(USER, SITE, { ...Q, segment: "hvac", point: "backup_min" }, NOW));
  expect(err).toBeInstanceOf(NotFoundException);
  expect(err.message).toBe(SEGMENT_POINT_NOT_FOUND);
  expect(f.calls).toEqual([`forSite:${SITE}`]);
}

/** A global admin (`null`) binds the site's explicit candidate list, never `null`. */
export async function aGlobalAdminBindsTheExplicitList(): Promise<void> {
  const f = fake({ readable: null });
  await f.service.forSite(USER, SITE, Q, NOW);
  const [a] = f.telemetry();
  expect(a?.params[3]).toBe("kw");
  expect(a?.params[4]).toEqual([uuid(1), uuid(2), uuid(3)]);
}

/** A scoped caller binds, ranks and judges only its readable assets; the readable one is there (adjacent positive). */
export async function aScopedCallerSeesOnlyReadableAssets(): Promise<void> {
  const f = fake({ readable: [uuid(2)] });
  const dto = await f.service.forSite(USER, SITE, Q, NOW);
  expect(f.telemetry()[0]?.params[4]).toEqual([uuid(2)]);
  expect(dto.ranking.map((r) => r.assetId)).toEqual([uuid(2)]);
  expect(dto.abnormal.entries.map((e) => e.assetId).filter((id) => id !== uuid(2))).toEqual([]);
  expect(dto.segments.map((s) => s.domain)).toEqual(["hvac"]);
}

/** An empty scope reads no telemetry and answers the empty view. */
export async function anEmptyScopeSendsNoTelemetryStatement(): Promise<void> {
  const f = fake({ readable: [] });
  const dto = await f.service.forSite(USER, SITE, Q, NOW);
  expect(f.telemetry()).toEqual([]);
  expect(f.calls).not.toContain("pool:assets");
  expect(dto.segments).toEqual([]);
  expect(dto.ranking).toEqual([]);
  expect(siteSegmentViewsSchema.safeParse(dto).success).toBe(true);
}

/** Readable assets but none of the asked segment registering the point: the empty ranking, no telemetry. */
export async function noCandidateSendsNoTelemetryStatement(): Promise<void> {
  const f = fake({ assetRows: [UPS_ROW] });
  const dto = await f.service.forSite(USER, SITE, { ...Q, segment: "hvac", point: "supply_air_temp_c" }, NOW);
  expect(f.telemetry()).toEqual([]);
  expect(dto.segment?.domain).toBe("hvac");
  expect(dto.ranking).toEqual([]);
}

/** Exactly two telemetry statements without compare: A then B. */
export async function exactlyTwoStatementsWithoutCompare(): Promise<void> {
  const f = fake();
  await f.service.forSite(USER, SITE, Q, NOW);
  expect(f.calls.filter((c) => c.startsWith("pool:windows") || c.startsWith("pool:series"))).toEqual([
    "pool:windows",
    "pool:series",
  ]);
}

/** Exactly two telemetry statements with compare: A then B, and no third for the compare period. */
export async function exactlyTwoStatementsWithCompare(): Promise<void> {
  const f = fake();
  await f.service.forSite(USER, SITE, { ...Q, compare: "previous" }, NOW);
  expect(f.telemetry()).toHaveLength(2);
}

/** With compare, statement A carries the `idx −1` window and the ranking's `compare` is that row. */
export async function compareRidesInStatementA(): Promise<void> {
  const f = fake();
  const dto = await f.service.forSite(USER, SITE, { ...Q, compare: "previous" }, NOW);
  expect(f.telemetry()[0]?.params[0]).toEqual([0, -1, 1, 2, 3, 4]);
  expect(dto.ranking[0]?.compare?.mean).toBe(499);
  expect(dto.compare).not.toBeNull();
}

/** No candidate statement A row of `idx −1` without compare: `compare` is `null` on every entry. */
export async function withoutCompareEveryEntryCompareIsNull(): Promise<void> {
  const f = fake();
  const dto = await f.service.forSite(USER, SITE, Q, NOW);
  expect(dto.ranking.map((r) => r.compare)).toEqual([null, null, null]);
  expect(dto.compare).toBeNull();
}

/** Sixty candidates: 50 ranked, `moreAssets` 10, 8 series bound in B, `trimmed`. */
export async function sixtyCandidatesAreCapped(): Promise<void> {
  const f = fake({ assetRows: hvacRows(60) });
  const dto = await f.service.forSite(USER, SITE, Q, NOW);
  expect(dto.ranking).toHaveLength(50);
  expect(dto.moreAssets).toBe(10);
  expect(dto.seriesCount).toBe(8);
  expect(dto.trimmed).toBe(true);
  expect(f.telemetry()[1]?.params[0]).toEqual(Array.from({ length: 8 }, (_, i) => uuid(i + 1)));
}

/** Only the top 8 carry buckets; the rest are `null`. */
export async function onlyTheTopEightCarryBuckets(): Promise<void> {
  const f = fake({ assetRows: hvacRows(10) });
  const dto = await f.service.forSite(USER, SITE, Q, NOW);
  expect(dto.ranking.map((r) => r.buckets !== null)).toEqual([true, true, true, true, true, true, true, true, false, false]);
  expect(dto.ranking[0]?.buckets).toHaveLength(288);
}

/** The default segment is the first present one; `segments` lists every present segment in `forSite` order. */
export async function theDefaultSegmentIsTheFirstPresent(): Promise<void> {
  const f = fake();
  const dto = await f.service.forSite(USER, SITE, Q, NOW);
  expect(dto.segments.map((s) => [s.domain, s.assetCount])).toEqual([
    ["hvac", 3],
    ["ups", 1],
  ]);
  expect(dto.segment?.domain).toBe("hvac");
  expect(dto.point?.code).toBe("kw");
  expect(dto.points.map((p) => p.code)).toEqual(["kw", "supply_air_temp_c"]);
}

/**
 * The abnormal list judges A's rows (`1000 − n` against a `500 − n` baseline is
 * above, the ratio rising with `n`, so highest ratio first is 3, 2, 1) and
 * reports the baseline rule.
 */
export async function theAbnormalListJudgesStatementA(): Promise<void> {
  const f = fake();
  const dto = await f.service.forSite(USER, SITE, Q, NOW);
  expect(dto.abnormal.entries.map((e) => [e.assetId, e.verdict])).toEqual([
    [uuid(3), "above"],
    [uuid(2), "above"],
    [uuid(1), "above"],
  ]);
  expect(dto.abnormal.baseline).toEqual({
    windows: 4,
    windowsConsulted: 4,
    stepDays: 1,
    ratio: 1.5,
    belowRatio: 0.5,
    nearZeroFraction: 0.01,
  });
}

/** The response parses with `siteSegmentViewsSchema`, in the site zone. */
export async function theResponseParses(): Promise<void> {
  const f = fake();
  const dto = await f.service.forSite(USER, SITE, { ...Q, compare: "previous" }, NOW);
  expect(siteSegmentViewsSchema.safeParse(dto).success).toBe(true);
  expect(dto.timeZone).toBe("Asia/Kolkata");
}
