import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import { orgTrendPoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { withTenant } from "../database/tenant-context";
import type { Recorded } from "../testing/recording-pool";
import { SEEDED, jwtFor, jwtForUnprovisioned } from "../testing/seeded-subjects";
import { trendPointsLockKey } from "./trend-points.pure";
import type { TrendPointsService } from "./trend-points.service";
import { TREND_STRIP_GROUP_NOT_FOUND, type SiteTrendStripService } from "./trend-strip.service";

/**
 * `F4.300` — `TrendPointsService` against real, non-owner roles (plan U3,
 * S1–S13). `trend-points.integration.test.ts` owns the pools, the snapshot of
 * the seeded organizations' rows and the cleanup; the assertions live here
 * (ADR 0014, AGENTS.md §4.6).
 *
 * **The service commits** (its write opens `withTenant`), so nothing here rolls
 * back. Fixtures carry a per-run `F4300-<run>` code: three point keys in the
 * `hvac` segment, an inactive organization and an inactive site of it. Cases
 * that a seeded subject must run (S1 the PHEWB `organization_admin`, S12 the
 * global admin on PHEWB) write PHEWB's `hvac` list; the wrapper snapshots that
 * list first and restores it after, so a list a person set locally survives.
 */
export type TrendPointsCtx = {
  svc: TrendPointsService;
  fleetPool: pg.Pool;
  tenantDb: BmsDb;
  run: string;
  phewbId: string;
  eskomId: string;
  fixtureOrgId: string;
  fixtureSiteId: string;
  rsmocWcId: string;
  pheSiteId: string;
  /** Three per-run `hvac` point keys, all active at the start. */
  keys: readonly [string, string, string];
  /** `F4.301` — the trend strip over the same pools (T1–T5). */
  strip: StripCtx;
};

/** `F4.301` U3 — what the trend strip cases (T1–T5) need beside the F4.300 fixtures. */
export type StripCtx = {
  svc: SiteTrendStripService;
  /** The same service over a recording pool: it records every statement and answers no rows. */
  recording: { svc: SiteTrendStripService; statements: Recorded[] };
  access: AccessControlService;
  /** A group of a PHEWB site. */
  phewbGroupId: string;
  /** A group of `RSMOC-WC` (the adjacent positive of T3). */
  rsmocWcGroupId: string;
  /** The site of the first seeded `ups`-domain asset. */
  upsSiteId: string;
  /** T4's per-run segment, code and asset, at the inactive fixture site. */
  segment: { domain: string; pointKey: string; assetId: string };
};

/** The segment every case writes. Specs may name a segment (the ADR 0108 §5.4 guard scans runtime modules). */
export const SEGMENT = "hvac";

const admin = (): JwtPayload => jwtFor(SEEDED.globalAdmin, "admin");
const pheAdmin = (): JwtPayload => jwtFor(SEEDED.organizationAdmin, "organization_admin");
const wcAdmin = (): JwtPayload => jwtFor(SEEDED.locationAdmin, "location_admin");

/** The stored rows for one (organization, segment), read as `bms_fleet` (BYPASSRLS), in `sort_order`. */
async function storedCodes(ctx: TrendPointsCtx, organizationId: string): Promise<string[]> {
  const { rows } = await ctx.fleetPool.query<{ point_key: string }>(
    `SELECT point_key FROM bms.org_trend_points
      WHERE organization_id = $1 AND domain = $2 ORDER BY sort_order`,
    [organizationId, SEGMENT],
  );
  return rows.map((row) => row.point_key);
}

/** Rows naming `pointKey` visible to `bms_tenant` with `organizationId` in the GUC. */
async function tenantVisible(ctx: TrendPointsCtx, organizationId: string, pointKey: string): Promise<number> {
  const rows = await withTenant(ctx.tenantDb, organizationId, (tx) =>
    tx.select({ pointKey: orgTrendPoints.pointKey }).from(orgTrendPoints).where(eq(orgTrendPoints.pointKey, pointKey)),
  );
  return rows.length;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (err: unknown) => err,
  );
}

/** S1a — a PHEWB `organization_admin` writes PHEWB's list: the stored rows are the body, in order. */
export async function assertOrgAdminWritesItsOrganization(ctx: TrendPointsCtx): Promise<void> {
  const [a, b] = ctx.keys;
  const segment = await ctx.svc.putSegment(pheAdmin(), ctx.phewbId, SEGMENT, { pointKeys: [b, a] });
  expect(segment.source).toBe("organization");
  expect(segment.points.map((p) => p.code)).toEqual([b, a]);
  expect(await storedCodes(ctx, ctx.phewbId)).toEqual([b, a]);
}

/**
 * S1b — the non-vacuous half of `FORCE ROW LEVEL SECURITY` on the new table
 * (`bms-owner-rls` holds the vacuous count-0 half): the row S1a wrote reads 1
 * as tenant PHEWB and 0 as tenant ESKOM.
 */
export async function assertTenantPolicyIsolatesTheRow(ctx: TrendPointsCtx): Promise<void> {
  const [a] = ctx.keys;
  expect(await tenantVisible(ctx, ctx.phewbId, a), "precondition: S1a wrote the PHEWB row").toBe(1);
  expect(await tenantVisible(ctx, ctx.eskomId, a)).toBe(0);
}

/** S2 — a PHEWB `organization_admin` writing ESKOM's list is refused, and nothing is written. */
export async function assertOrgAdminCannotWriteAnotherOrganization(ctx: TrendPointsCtx): Promise<void> {
  const before = await storedCodes(ctx, ctx.eskomId);
  const err = await rejection(ctx.svc.putSegment(pheAdmin(), ctx.eskomId, SEGMENT, { pointKeys: [ctx.keys[0]] }));
  expect(err).toBeInstanceOf(ForbiddenException);
  expect(await storedCodes(ctx, ctx.eskomId)).toEqual(before);
}

/** S3 — a `location_admin` (a master-data user, not organization-level) is refused. */
export async function assertLocationAdminIsRefused(ctx: TrendPointsCtx): Promise<void> {
  const err = await rejection(ctx.svc.putSegment(wcAdmin(), ctx.eskomId, SEGMENT, { pointKeys: [ctx.keys[0]] }));
  expect(err).toBeInstanceOf(ForbiddenException);
  expect((err as Error).message).toMatch(/organization admin of this organization/);
}

/** S4 — an `operator` is refused by `requireMasterDataUser`, before the organization gate. */
export async function assertOperatorIsRefused(ctx: TrendPointsCtx): Promise<void> {
  const operator = jwtForUnprovisioned(`f4300-operator-${ctx.run}@bms.local`, "operator");
  const err = await rejection(
    ctx.svc.putSegment(operator, ctx.fixtureOrgId, SEGMENT, { pointKeys: [ctx.keys[0]] }),
  );
  expect((err as Error).message).toMatch(/Master data administration requires/);
  expect(await storedCodes(ctx, ctx.fixtureOrgId)).toEqual([]);
}

/** S5 — an unknown segment is a 404. */
export async function assertUnknownSegmentIsNotFound(ctx: TrendPointsCtx): Promise<void> {
  const err = await rejection(
    ctx.svc.putSegment(admin(), ctx.fixtureOrgId, `no-such-segment-${ctx.run}`, { pointKeys: [] }),
  );
  expect(err).toBeInstanceOf(NotFoundException);
}

/** S6 — a code not in `point_keys` is a 400 naming it, and nothing is written. */
export async function assertUnknownCodeIsBadRequest(ctx: TrendPointsCtx): Promise<void> {
  const missing = `F4300-${ctx.run}-missing`;
  const err = await rejection(
    ctx.svc.putSegment(admin(), ctx.fixtureOrgId, SEGMENT, { pointKeys: [ctx.keys[0], missing] }),
  );
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toContain(missing);
  expect((err as Error).message).not.toContain(ctx.keys[0]);
  expect(await storedCodes(ctx, ctx.fixtureOrgId)).toEqual([]);
}

/** S7 — a second write replaces the list: the count is the new body's, the old codes are gone. */
export async function assertSecondWriteReplaces(ctx: TrendPointsCtx): Promise<void> {
  const [a, b, c] = ctx.keys;
  await ctx.svc.putSegment(admin(), ctx.fixtureOrgId, SEGMENT, { pointKeys: [a, b] });
  expect(await storedCodes(ctx, ctx.fixtureOrgId), "precondition: the first write landed").toEqual([a, b]);
  await ctx.svc.putSegment(admin(), ctx.fixtureOrgId, SEGMENT, { pointKeys: [c] });
  expect(await storedCodes(ctx, ctx.fixtureOrgId)).toEqual([c]);
}

/** S8 — `pointKeys: []` deletes the rows, and the admin read says the segment is the catalog's again. */
export async function assertEmptyBodyRestoresTheCatalog(ctx: TrendPointsCtx): Promise<void> {
  await ctx.svc.putSegment(admin(), ctx.fixtureOrgId, SEGMENT, { pointKeys: [ctx.keys[0]] });
  const before = await ctx.svc.forOrganization(admin(), ctx.fixtureOrgId);
  expect(before.segments.find((s) => s.domain === SEGMENT)?.source, "precondition").toBe("organization");

  await ctx.svc.putSegment(admin(), ctx.fixtureOrgId, SEGMENT, { pointKeys: [] });
  expect(await storedCodes(ctx, ctx.fixtureOrgId)).toEqual([]);
  const after = await ctx.svc.forOrganization(admin(), ctx.fixtureOrgId);
  expect(after.segments.find((s) => s.domain === SEGMENT)?.source).toBe("catalog");
}

/**
 * S9 — a code retired after the write is absent from the site read, the row is
 * kept, and the admin read shows it marked inactive (plan C8). The caller
 * reactivates the key afterwards.
 */
export async function assertRetiredCodeIsHiddenAndKept(ctx: TrendPointsCtx): Promise<void> {
  const [a, b] = ctx.keys;
  await ctx.svc.putSegment(admin(), ctx.fixtureOrgId, SEGMENT, { pointKeys: [a, b] });
  await ctx.fleetPool.query(`UPDATE bms.point_keys SET active = false WHERE code = $1`, [b]);

  const site = await ctx.svc.forSite(admin(), ctx.fixtureSiteId);
  const points = site.segments.find((s) => s.domain === SEGMENT)?.points.map((p) => p.code);
  expect(points).toEqual([a]);
  expect(await storedCodes(ctx, ctx.fixtureOrgId)).toEqual([a, b]);

  const adminRead = await ctx.svc.forOrganization(admin(), ctx.fixtureOrgId);
  const marked = adminRead.segments.find((s) => s.domain === SEGMENT)?.points.map((p) => [p.code, p.active]);
  expect(marked).toEqual([
    [a, true],
    [b, false],
  ]);
}

/** S10 — the write is audited under the organization, naming the action and the actor. */
export async function assertWriteIsAudited(ctx: TrendPointsCtx, adminUserId: string): Promise<void> {
  await ctx.svc.putSegment(admin(), ctx.fixtureOrgId, SEGMENT, { pointKeys: [ctx.keys[2]] });
  const { rows } = await ctx.fleetPool.query(
    `SELECT action, organization_id, actor_id, payload FROM bms.audit_log
      WHERE entity_type = 'org_trend_points' AND entity_id = $1 AND payload->'pointKeys' ? $2`,
    [ctx.fixtureOrgId, ctx.keys[2]],
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[rows.length - 1]).toEqual({
    action: "master.organization.trend_points.set",
    organization_id: ctx.fixtureOrgId,
    actor_id: adminUserId,
    payload: { domain: SEGMENT, pointKeys: [ctx.keys[2]] },
  });
}

/** S11a — a `location_admin` reads its seeded ESKOM site: 200 with the site's organization. */
export async function assertLocationAdminReadsItsSite(ctx: TrendPointsCtx): Promise<void> {
  const dto = await ctx.svc.forSite(wcAdmin(), ctx.rsmocWcId);
  expect(dto.locationId).toBe(ctx.rsmocWcId);
  expect(dto.organizationId).toBe(ctx.eskomId);
  expect(dto.segments.map((s) => s.domain)).toContain(SEGMENT);
}

/** S11b — the same `location_admin` on a PHEWB site gets the 404, not the list. */
export async function assertLocationAdminCannotReadAnotherSite(ctx: TrendPointsCtx): Promise<void> {
  const err = await rejection(ctx.svc.forSite(wcAdmin(), ctx.pheSiteId));
  expect(err).toBeInstanceOf(NotFoundException);
  expect((err as Error).message).toMatch(/outside your access scope/);
}

/** S12 — a global admin writes PHEWB's list. */
export async function assertGlobalAdminWritesAnyOrganization(ctx: TrendPointsCtx): Promise<void> {
  const [, , c] = ctx.keys;
  const segment = await ctx.svc.putSegment(admin(), ctx.phewbId, SEGMENT, { pointKeys: [c] });
  expect(segment.points.map((p) => p.code)).toEqual([c]);
  expect(await storedCodes(ctx, ctx.phewbId)).toEqual([c]);
}

/**
 * S14 — two writes to one (organization, segment) serialize on the segment's
 * advisory lock (review finding 1). The case holds `trendPointsLockKey` on its
 * own connection, starts two overlapping writes with overlapping codes, and
 * waits until BOTH are queued on an advisory lock — which they never are if
 * `putSegment` takes no lock or a different key, so the poll ends red.
 * After release both resolve (no `23505` 500) and the stored list is exactly
 * one body, in its order — never the union of the two (the cap breach).
 */
export async function assertConcurrentWritesSerialize(ctx: TrendPointsCtx): Promise<void> {
  const [a, b, c] = ctx.keys;
  await ctx.svc.putSegment(admin(), ctx.fixtureOrgId, SEGMENT, { pointKeys: [] });
  const holder = await ctx.fleetPool.connect();
  let first: Promise<unknown> = Promise.resolve("not started");
  let second: Promise<unknown> = Promise.resolve("not started");
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      trendPointsLockKey(ctx.fixtureOrgId, SEGMENT),
    ]);
    first = rejection(ctx.svc.putSegment(admin(), ctx.fixtureOrgId, SEGMENT, { pointKeys: [a, b] }));
    second = rejection(ctx.svc.putSegment(admin(), ctx.fixtureOrgId, SEGMENT, { pointKeys: [b, c] }));
    let waiting = 0;
    for (let i = 0; i < 100 && waiting < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Only waiters on THIS key: a bigint advisory key reads back as classid
      // (high 32 bits) + objid (low 32 bits), objsubid 1. Other runs beside
      // this one may hold advisory locks of their own.
      const { rows } = await ctx.fleetPool.query<{ n: number }>(
        `WITH k AS (SELECT hashtextextended($1, 0) AS v)
         SELECT count(*)::int AS n FROM pg_locks, k
          WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
            AND classid = ((k.v >> 32) & 4294967295)::oid
            AND objid = (k.v & 4294967295)::oid`,
        [trendPointsLockKey(ctx.fixtureOrgId, SEGMENT)],
      );
      waiting = rows[0]?.n ?? 0;
    }
    expect(waiting, "both writes queue on the segment lock").toBeGreaterThanOrEqual(2);
    expect(await storedCodes(ctx, ctx.fixtureOrgId), "nothing commits while the lock is held").toEqual([]);
  } finally {
    await holder.query("COMMIT").catch(() => undefined);
    holder.release();
  }
  expect(await first, "the first write resolves").toBeNull();
  expect(await second, "the second write resolves, not a 23505").toBeNull();
  const stored = await storedCodes(ctx, ctx.fixtureOrgId);
  expect([JSON.stringify([a, b]), JSON.stringify([b, c])]).toContain(JSON.stringify(stored));
}

/** S13 — a global admin reading an organization that does not exist gets the 404. */
export async function assertMissingOrganizationIsNotFound(ctx: TrendPointsCtx): Promise<void> {
  const err = await rejection(ctx.svc.forOrganization(admin(), "00000000-0000-4000-8000-0000000f4300"));
  expect(err).toBeInstanceOf(NotFoundException);
  expect((err as Error).message).toBe("Organization not found");
  expect((await ctx.svc.forOrganization(admin(), ctx.fixtureOrgId)).organizationId, "adjacent positive").toBe(
    ctx.fixtureOrgId,
  );
}

// --- F4.301 U3 — the trend strip (ADR 0108 Amendment 2), T1–T5 -------------

const hvacAdmin = (): JwtPayload => jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin");

/** Every asset id that draws a series in a strip response. */
function seriesAssetIds(dto: Awaited<ReturnType<SiteTrendStripService["forSite"]>>): Set<string> {
  return new Set(dto.segments.flatMap((s) => s.points.flatMap((p) => p.assets.map((a) => a.assetId))));
}

/**
 * T1 — `wc-hvac-admin` (`asset_group_admin`) on `RSMOC-WC` draws no series of
 * an asset outside its groups, and does draw one of its own. The foreign set
 * is what a global admin draws on the same strip minus what the caller reads,
 * and it must be non-empty, so the absence is not vacuous.
 */
export async function assertStripHidesAssetsOutsideTheCallersGroups(ctx: TrendPointsCtx): Promise<void> {
  const readable = new Set((await ctx.strip.access.readableAssetIds(hvacAdmin())) ?? []);
  const all = seriesAssetIds(await ctx.strip.svc.forSite(admin(), ctx.rsmocWcId, { range: "24h" }));
  const foreign = [...all].filter((id) => !readable.has(id));
  expect(foreign.length, "precondition: the global admin draws assets outside the caller's groups").toBeGreaterThan(0);

  const mine = seriesAssetIds(await ctx.strip.svc.forSite(hvacAdmin(), ctx.rsmocWcId, { range: "24h" }));
  expect(foreign.filter((id) => mine.has(id))).toEqual([]);
  expect(mine.size, "the caller draws its own assets").toBeGreaterThan(0);
  expect([...mine].filter((id) => !readable.has(id))).toEqual([]);
}

/** T2 — `wc-admin` on a PHEWB site is the 404, and the strip sends no statement at all. */
export async function assertStripOnAForeignSiteIsA404WithNoStatement(ctx: TrendPointsCtx): Promise<void> {
  ctx.strip.recording.statements.length = 0;
  const err = await rejection(ctx.strip.recording.svc.forSite(wcAdmin(), ctx.pheSiteId, { range: "24h" }));
  expect(err).toBeInstanceOf(NotFoundException);
  expect(ctx.strip.recording.statements).toEqual([]);

  await ctx.strip.recording.svc.forSite(wcAdmin(), ctx.rsmocWcId, { range: "24h" });
  expect(ctx.strip.recording.statements.length, "adjacent positive: its own site is read").toBeGreaterThan(0);
}

/** T3 — a global admin naming a PHEWB group on an ESKOM site gets the group 404; an ESKOM group there answers. */
export async function assertStripGroupOfAnotherSiteIsA404(ctx: TrendPointsCtx): Promise<void> {
  const err = await rejection(
    ctx.strip.svc.forSite(admin(), ctx.rsmocWcId, { range: "24h", assetGroupId: ctx.strip.phewbGroupId }),
  );
  expect(err).toBeInstanceOf(NotFoundException);
  expect((err as Error).message).toBe(TREND_STRIP_GROUP_NOT_FOUND);

  const own = await ctx.strip.svc.forSite(admin(), ctx.rsmocWcId, {
    range: "24h",
    assetGroupId: ctx.strip.rsmocWcGroupId,
  });
  expect(own.assetGroupId).toBe(ctx.strip.rsmocWcGroupId);
}

/**
 * T4 — a per-run `asset_domains` row, listed through an organization override
 * and registered on a per-run asset, is its own segment on the strip: a new
 * segment needs no release.
 */
export async function assertStripShowsANewSegment(ctx: TrendPointsCtx): Promise<void> {
  const { domain, pointKey, assetId } = ctx.strip.segment;
  const dto = await ctx.strip.svc.forSite(admin(), ctx.fixtureSiteId, { range: "24h" });
  const segment = dto.segments.find((s) => s.domain === domain);
  expect(segment?.source).toBe("organization");
  expect(segment?.points.map((p) => [p.code, p.assets.map((a) => a.assetId)])).toEqual([[pointKey, [assetId]]]);
  expect(segment?.points[0]?.assets[0]?.buckets).toHaveLength(48);
}

/**
 * T4b — F4.301 review: T4's live domain is not what a parallel suite picks.
 * `ORDER BY code LIMIT 1` (locations-tree, water-balance-role and others)
 * never returns it, and the active list in `sort_order` still ends in
 * `facility` (the F2.13 *Expected one of* pin). The positive half proves the
 * row is live and active, so neither absence is vacuous.
 */
export async function assertStripSegmentIsNotAParallelSuitesPick(ctx: TrendPointsCtx): Promise<void> {
  const { domain } = ctx.strip.segment;
  const live = await ctx.fleetPool.query<{ active: boolean }>(
    `SELECT active FROM bms.asset_domains WHERE code = $1`,
    [domain],
  );
  expect(live.rows, "T4's domain must be live and active").toEqual([{ active: true }]);
  const first = await ctx.fleetPool.query<{ code: string }>(
    `SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1`,
  );
  expect(first.rows[0]?.code, "a first-by-code pick must not land on T4's domain").not.toBe(domain);
  const last = await ctx.fleetPool.query<{ code: string }>(
    `SELECT code FROM bms.asset_domains WHERE active = true ORDER BY sort_order DESC, code DESC LIMIT 1`,
  );
  expect(last.rows[0]?.code, "facility must stay the last active domain by sort_order").toBe("facility");
}

/** T5 — a seeded `ups` asset draws under the `ups` segment on the whole-site strip, and under no other. */
export async function assertStripDrawsUpsAssetsUnderTheUpsSegmentOnly(ctx: TrendPointsCtx): Promise<void> {
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `SELECT id FROM bms.assets WHERE location_id = $1 AND domain = 'ups' ORDER BY created_at, id`,
    [ctx.strip.upsSiteId],
  );
  const ups = new Set(rows.map((row) => row.id));
  const dto = await ctx.strip.svc.forSite(admin(), ctx.strip.upsSiteId, { range: "24h" });
  const upsSegment = dto.segments.find((s) => s.domain === "ups");
  const drawn = upsSegment?.points.flatMap((p) => p.assets.map((a) => a.assetId)) ?? [];
  expect(drawn.length, "the ups segment draws a ups asset").toBeGreaterThan(0);
  expect(drawn.filter((id) => !ups.has(id))).toEqual([]);
  const elsewhere = dto.segments
    .filter((s) => s.domain !== "ups")
    .flatMap((s) => s.points.flatMap((p) => p.assets.map((a) => a.assetId)))
    .filter((id) => ups.has(id));
  expect(elsewhere).toEqual([]);
}
