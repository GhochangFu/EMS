import { BadRequestException, NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import type { JwtPayload, SiteSegmentViewsDto, SiteSegmentViewsQuery } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import type { Recorded } from "../testing/recording-pool";
import { SEEDED, jwtFor } from "../testing/seeded-subjects";
import type { SiteSegmentViewsService } from "./segment-views.service";

/**
 * `F4.302` U2 (ADR 0108 Amendment 4 items 2, 4 and 5) — `SiteSegmentViewsService`
 * against the real roles, the seeded subjects and a per-run fixture.
 * `segment-views.integration.test.ts` owns the pools, the fixture and the
 * cleanup; the assertions live here (ADR 0014, AGENTS.md §4.6).
 *
 * **The service runs over a forwarding pool**: every statement reaches the
 * fleet pool and is recorded, so a case can count the `telemetry.*`
 * statements and read their bound lists while the database answers. Telemetry
 * has no RLS, so the bound asset list is the control under test.
 *
 * The fixture: an inactive organization with an inactive site holding sixty
 * assets of a per-run `asset_domains` row, each registering a per-run point
 * code that the organization's override lists, each with one sample of that
 * code two hours before setup (asset `n` reads `n`); and a second
 * inactive site with no asset. A spec may name a segment: the ADR 0108 §5.4
 * guard scans runtime modules only.
 */

export type SegmentViewsCtx = {
  readonly svc: SiteSegmentViewsService;
  /** Every statement the service sent through the forwarding pool, in order. */
  readonly statements: Recorded[];
  readonly access: AccessControlService;
  readonly fleetPool: pg.Pool;
  readonly rsmocWcId: string;
  readonly pheSiteId: string;
  /** The site of the first seeded `ups`-domain asset registering a `ups` trend point. */
  readonly upsSiteId: string;
  readonly fixture: {
    readonly siteId: string;
    readonly emptySiteId: string;
    /** `locations.name` of `siteId`. */
    readonly siteName: string;
    /** `rtus.display_name` of the one RTU, which only `A060` sits on. */
    readonly rtuName: string;
    readonly domain: string;
    readonly pointKey: string;
    /** Sixty asset ids, `A001` first. */
    readonly assetIds: readonly string[];
  };
};

const admin = (): JwtPayload => jwtFor(SEEDED.globalAdmin, "admin");
const wcAdmin = (): JwtPayload => jwtFor(SEEDED.locationAdmin, "location_admin");
const hvacAdmin = (): JwtPayload => jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin");

const Q: SiteSegmentViewsQuery = { range: "24h" };

function telemetry(ctx: SegmentViewsCtx): Recorded[] {
  return ctx.statements.filter((s) => s.text.includes("telemetry."));
}

/** Statement A's bound asset list (`$5`), from the last request. */
function boundList(ctx: SegmentViewsCtx): string[] {
  const a = telemetry(ctx).find((s) => s.text.includes("unnest($1::int[]"));
  return (a?.params[4] as string[] | undefined) ?? [];
}

async function run(ctx: SegmentViewsCtx, jwt: JwtPayload, siteId: string, query: SiteSegmentViewsQuery) {
  ctx.statements.length = 0;
  return ctx.svc.forSite(jwt, siteId, query);
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error("resolved, expected a refusal");
}

/**
 * The first point of `segment` whose candidate list is non-empty for the
 * global admin at `siteId`, with that list; `null` when none is. Seeded
 * registrations vary, so the case picks a point that draws, not a literal.
 */
async function drawingPoint(
  ctx: SegmentViewsCtx,
  siteId: string,
  segment: string,
): Promise<{ point: string; list: string[] } | null> {
  const first = await run(ctx, admin(), siteId, { ...Q, segment });
  for (const point of first.points) {
    await run(ctx, admin(), siteId, { ...Q, segment, point: point.code });
    const list = boundList(ctx);
    if (list.length > 0) return { point: point.code, list };
  }
  return null;
}

/** V1 — `wc-admin` on a PHEWB site is the 404, with no `telemetry.*` statement; its own site answers. */
export async function assertAForeignSiteIsA404WithNoTelemetry(ctx: SegmentViewsCtx): Promise<void> {
  const err = await rejection(run(ctx, wcAdmin(), ctx.pheSiteId, Q));
  expect(err).toBeInstanceOf(NotFoundException);
  expect(telemetry(ctx)).toEqual([]);

  const own = await run(ctx, wcAdmin(), ctx.rsmocWcId, Q);
  expect(own.locationId, "adjacent positive: its own site answers").toBe(ctx.rsmocWcId);
}

/**
 * V2 — `wc-hvac-admin` (`asset_group_admin`) on `RSMOC-WC` binds, ranks and
 * judges no asset outside its groups, and does bind one of its own. The
 * foreign set is the global admin's list minus the caller's readable set, and
 * it must be non-empty, so the absence is not vacuous.
 */
export async function assertAGroupScopedCallerSeesOnlyItsAssets(ctx: SegmentViewsCtx): Promise<void> {
  const readable = new Set((await ctx.access.readableAssetIds(hvacAdmin())) ?? []);
  // Every (segment, point) the global admin binds at the site, and the ids it binds outside the caller's groups.
  const combos: { segment: string; point: string }[] = [];
  const foreign = new Set<string>();
  const first = await run(ctx, admin(), ctx.rsmocWcId, Q);
  for (const segment of first.segments) {
    const listed = await run(ctx, admin(), ctx.rsmocWcId, { ...Q, segment: segment.domain });
    for (const point of listed.points) {
      await run(ctx, admin(), ctx.rsmocWcId, { ...Q, segment: segment.domain, point: point.code });
      for (const id of boundList(ctx)) if (!readable.has(id)) foreign.add(id);
      combos.push({ segment: segment.domain, point: point.code });
    }
  }
  expect(foreign.size, "precondition: the global admin binds assets outside the caller's groups").toBeGreaterThan(0);

  const mine = new Set<string>();
  const leaked: string[] = [];
  for (const { segment, point } of combos) {
    const dto = await run(ctx, hvacAdmin(), ctx.rsmocWcId, { ...Q, segment, point });
    const bound = boundList(ctx);
    for (const id of bound) mine.add(id);
    const shown = [...dto.ranking.map((r) => r.assetId), ...dto.abnormal.entries.map((e) => e.assetId)];
    leaked.push(...[...bound, ...shown].filter((id) => !readable.has(id)));
  }
  expect(leaked).toEqual([]);
  expect(mine.size, "the caller binds its own assets").toBeGreaterThan(0);
}

/** V3 — a global admin's statement A binds the site's explicit list (every id an asset of the site), never `null`. */
export async function assertAGlobalAdminBindsTheExplicitSiteList(ctx: SegmentViewsCtx): Promise<void> {
  await run(ctx, admin(), ctx.fixture.siteId, Q);
  const list = boundList(ctx);
  expect(list).toHaveLength(60);
  const { rows } = await ctx.fleetPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bms.assets WHERE id = ANY($1::uuid[]) AND location_id = $2`,
    [list, ctx.fixture.siteId],
  );
  expect(rows[0]?.n).toBe(60);
}

/** V4 — a site with no asset sends no telemetry statement; the fixture site beside it sends two (adjacent positive). */
export async function assertNoCandidateSendsNoTelemetry(ctx: SegmentViewsCtx): Promise<void> {
  const empty = await run(ctx, admin(), ctx.fixture.emptySiteId, Q);
  expect(telemetry(ctx)).toEqual([]);
  expect(empty.segments).toEqual([]);
  expect(empty.ranking).toEqual([]);

  await run(ctx, admin(), ctx.fixture.siteId, Q);
  expect(telemetry(ctx)).toHaveLength(2);
}

/** V5 — exactly two telemetry statements without compare. */
export async function assertTwoStatementsWithoutCompare(ctx: SegmentViewsCtx): Promise<void> {
  await run(ctx, admin(), ctx.fixture.siteId, Q);
  expect(telemetry(ctx)).toHaveLength(2);
}

/** V5 — exactly two telemetry statements with compare. */
export async function assertTwoStatementsWithCompare(ctx: SegmentViewsCtx): Promise<void> {
  const dto = await run(ctx, admin(), ctx.fixture.siteId, { ...Q, compare: "previous" });
  expect(telemetry(ctx)).toHaveLength(2);
  expect(dto.compare).not.toBeNull();
}

/** V6 — a per-run `asset_domains` row whose code an organization override lists is a segment at the read. */
export async function assertANewSegmentAppears(ctx: SegmentViewsCtx): Promise<void> {
  const dto = await run(ctx, admin(), ctx.fixture.siteId, Q);
  expect(dto.segments).toEqual([expect.objectContaining({ domain: ctx.fixture.domain, assetCount: 60 })]);
  expect(dto.segment).toEqual(expect.objectContaining({ domain: ctx.fixture.domain, source: "organization" }));
  expect(dto.point?.code).toBe(ctx.fixture.pointKey);
}

/** V7 — a seeded `ups` asset is a candidate under `ups`, and under no other segment present at its site. */
export async function assertUpsAssetsAppearUnderUpsOnly(ctx: SegmentViewsCtx): Promise<void> {
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `SELECT id FROM bms.assets WHERE location_id = $1 AND domain = 'ups' ORDER BY created_at, id`,
    [ctx.upsSiteId],
  );
  const ups = new Set(rows.map((row) => row.id));
  const drawing = await drawingPoint(ctx, ctx.upsSiteId, "ups");
  expect(drawing?.list.length, "the ups segment binds a ups asset").toBeGreaterThan(0);
  expect((drawing?.list ?? []).filter((id) => !ups.has(id))).toEqual([]);

  const first: SiteSegmentViewsDto = await run(ctx, admin(), ctx.upsSiteId, Q);
  for (const segment of first.segments.filter((s) => s.domain !== "ups")) {
    const listed = await run(ctx, admin(), ctx.upsSiteId, { ...Q, segment: segment.domain });
    for (const point of listed.points) {
      await run(ctx, admin(), ctx.upsSiteId, { ...Q, segment: segment.domain, point: point.code });
      expect(boundList(ctx).filter((id) => ups.has(id)), `${segment.domain}/${point.code}`).toEqual([]);
    }
  }
}

/** V8 — sixty candidates with data rank 50 (`A060` first: asset `n` reads `n`), `moreAssets` 10, 8 series, `trimmed`. */
export async function assertSixtyCandidatesAreCapped(ctx: SegmentViewsCtx): Promise<void> {
  const dto = await run(ctx, admin(), ctx.fixture.siteId, Q);
  expect(dto.ranking).toHaveLength(50);
  expect(dto.moreAssets).toBe(10);
  expect(dto.seriesCount).toBe(8);
  expect(dto.trimmed).toBe(true);
  expect(dto.ranking[0]?.assetId).toBe(ctx.fixture.assetIds[59]);
  expect(dto.ranking[0]?.current.mean).toBe(60);
  expect(dto.ranking.filter((r) => r.buckets !== null)).toHaveLength(8);
}

/**
 * V10 (`F4.316`, ADR 0111) — the site read's LEFT JOINs: `A060` (on the fixture RTU) names the RTU
 * and the site; `A059` (no RTU) has `assetRtuName: null` and still the site's name.
 */
export async function assertARankingEntryNamesItsRtuAndLocation(ctx: SegmentViewsCtx): Promise<void> {
  const dto = await run(ctx, admin(), ctx.fixture.siteId, Q);
  const named = dto.ranking.slice(0, 2).map((r) => [r.assetId, r.assetRtuName, r.assetLocationName]);
  expect(named).toEqual([
    [ctx.fixture.assetIds[59], ctx.fixture.rtuName, ctx.fixture.siteName],
    [ctx.fixture.assetIds[58], null, ctx.fixture.siteName],
  ]);
}

/** V9 — a 46-day custom range reads `_1h` in local-day buckets, and the abnormal block reports the consulted windows. */
export async function assertA46DayRangeIsHourLevelDayBucket(ctx: SegmentViewsCtx): Promise<void> {
  const to = new Date();
  const from = new Date(to.getTime() - 46 * 24 * 3_600_000);
  const dto = await run(ctx, admin(), ctx.fixture.siteId, {
    range: "custom",
    from: from.toISOString(),
    to: to.toISOString(),
  });
  expect([dto.level, dto.bucket]).toEqual(["1h", "1d"]);
  expect(dto.abnormal.baseline.windowsConsulted).toBe(4);
  expect(telemetry(ctx).every((s) => s.text.includes("telemetry.point_values_1h"))).toBe(true);
}

// ---------------------------------------------------------------------------
// `F4.303` U4 (ADR 0108 Amendment 6 item 3) — the segment export over the same
// forwarding pool. Data rows start after the five header rows, the blank row
// and the column header; columns: asset_code, asset_name, point, unit, period,
// bucket_start, mean.
// ---------------------------------------------------------------------------

const HEADER_ROWS = 7;

async function exportRun(
  ctx: SegmentViewsCtx,
  jwt: JwtPayload,
  siteId: string,
  query: SiteSegmentViewsQuery,
  now: Date,
  cap?: number,
) {
  ctx.statements.length = 0;
  return ctx.svc.exportRows(jwt, siteId, query, now, cap);
}

/** The read and the export at one instant, so both resolve the same frame. */
async function readThenExport(ctx: SegmentViewsCtx, query: SiteSegmentViewsQuery) {
  const now = new Date();
  const dto = await ctx.svc.forSite(admin(), ctx.fixture.siteId, query, now);
  const rows = await exportRun(ctx, admin(), ctx.fixture.siteId, query, now);
  return { dto, rows };
}

/** `[asset_code, mean]` of the `period` rows of an export. */
function meansOf(rows: readonly (string | number | null)[][], period: "current" | "previous") {
  return rows
    .slice(HEADER_ROWS)
    .filter((row) => row[5] === period)
    .map((row) => [row[0], row[7]]);
}

/** G1 — `wc-admin`'s export of a PHEWB site is the read's 404, with no `telemetry.*` statement; its own site exports. */
export async function assertAForeignSiteExportIsA404WithNoTelemetry(ctx: SegmentViewsCtx): Promise<void> {
  const now = new Date();
  const err = await rejection(exportRun(ctx, wcAdmin(), ctx.pheSiteId, Q, now));
  expect(err).toBeInstanceOf(NotFoundException);
  expect(telemetry(ctx)).toEqual([]);

  const own = await exportRun(ctx, wcAdmin(), ctx.rsmocWcId, Q, now);
  expect(own[0]?.[0], "adjacent positive: its own site exports").toBe("zone");
}

/** G2 — each current `mean` is `forSite(...).ranking[k].buckets[i].v` for the same query and instant. */
export async function assertTheExportMeansAreForSitesBuckets(ctx: SegmentViewsCtx): Promise<void> {
  const { dto, rows } = await readThenExport(ctx, Q);
  const expected = dto.ranking.flatMap((e) => (e.buckets ?? []).map((b) => [e.assetCode, b.v]));
  expect(expected.some((row) => typeof row[1] === "number"), "precondition: a drawn bucket carries a value").toBe(true);
  expect(meansOf(rows, "current")).toEqual(expected);
}

/** G3 — only the drawn entries (`buckets !== null`, 8 of the 50 ranked) are in the file. */
export async function assertOnlyTheDrawnSeriesAreExported(ctx: SegmentViewsCtx): Promise<void> {
  const { dto, rows } = await readThenExport(ctx, Q);
  const drawn = dto.ranking.filter((e) => e.buckets !== null).map((e) => e.assetCode);
  expect(drawn, "precondition: 8 of 50 ranked are drawn").toHaveLength(8);
  expect([...new Set(rows.slice(HEADER_ROWS).map((row) => row[0]))]).toEqual(drawn);
}

/** G4 — with `compare=previous` the `previous` rows are `compareBuckets`. */
export async function assertThePreviousRowsAreCompareBuckets(ctx: SegmentViewsCtx): Promise<void> {
  const { dto, rows } = await readThenExport(ctx, { ...Q, compare: "previous" });
  const expected = dto.ranking.flatMap((e) => (e.compareBuckets ?? []).map((b) => [e.assetCode, b.v]));
  expect(expected.length, "precondition: the compare period has buckets").toBeGreaterThan(0);
  expect(meansOf(rows, "previous")).toEqual(expected);
}

/** G5 — a lowered cap refuses before statement A and statement B: no `telemetry.*` statement is sent. */
export async function assertALoweredCapRefusesBeforeTelemetry(ctx: SegmentViewsCtx): Promise<void> {
  const err = await rejection(exportRun(ctx, admin(), ctx.fixture.siteId, Q, new Date(), 10));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(err.message).toMatch(/^Export would hold \d+ rows, above the 10 row limit\. Narrow the range or the points\.$/);
  expect(telemetry(ctx)).toEqual([]);

  await exportRun(ctx, admin(), ctx.fixture.siteId, Q, new Date());
  expect(telemetry(ctx), "adjacent positive: the real cap sends the read's two statements").toHaveLength(2);
}
