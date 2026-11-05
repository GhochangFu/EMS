import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { FIXTURE_ASSET_DOMAIN_PREFIX, createDb, fixtureAssetDomainCode, refreshAggregatesFrom } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { retryOnConcurrentRefresh } from "../testing/cagg-materialize";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import type { Recorded } from "../testing/recording-pool";
import { asRole } from "../testing/role-urls";
import { primeSeededSubjects } from "../testing/seeded-subjects";
import {
  type SegmentViewsCtx,
  assertA46DayRangeIsHourLevelDayBucket,
  assertAForeignSiteIsA404WithNoTelemetry,
  assertAGlobalAdminBindsTheExplicitSiteList,
  assertAGroupScopedCallerSeesOnlyItsAssets,
  assertANewSegmentAppears,
  assertNoCandidateSendsNoTelemetry,
  assertSixtyCandidatesAreCapped,
  assertARankingEntryNamesItsRtuAndLocation,
  assertTwoStatementsWithCompare,
  assertTwoStatementsWithoutCompare,
  assertUpsAssetsAppearUnderUpsOnly,
  assertAForeignSiteExportIsA404WithNoTelemetry,
  assertTheExportMeansAreForSitesBuckets,
  assertOnlyTheDrawnSeriesAreExported,
  assertThePreviousRowsAreCompareBuckets,
  assertALoweredCapRefusesBeforeTelemetry,
} from "./segment-views.integration.spec";
import { SiteSegmentViewsService } from "./segment-views.service";
import { TrendPointsService } from "./trend-points.service";

/**
 * `F4.302` U2 — Vitest entry point for `SiteSegmentViewsService` against the
 * real roles (the `trend-points.integration.test.ts` harness). Assertions live
 * in the sibling `.spec` (ADR 0014); this file owns the pools, the stale sweep,
 * the per-run fixture and its child-first cleanup.
 *
 * `connection: "owner"`: the fixture writes telemetry and refreshes the
 * aggregates as `bms_owner`; the rows of `bms.*` are written and read on the
 * fleet pool (BYPASSRLS), the pool the service reads on.
 */
const connectionString = requireIntegrationDb({
  item: "F4.302",
  label: "SiteSegmentViewsService against real roles",
  because:
    "the segment view's only isolation control on telemetry is the asset list it binds after the real " +
    "grant read, and its segments come from real asset_domains, point_keys and override rows — none of " +
    "which a fake can show.",
  connection: "owner",
});

const STALE = "now() - interval '30 minutes'";
const DOMAIN_TAG = "f_segment_views";
/** Every fixture code starts `F4302-`; the sweep's bound LIKE pattern. */
const PATTERN = "F4302-%";
const ASSETS = 60;
const HOUR_MS = 3_600_000;

/** Reaps what a killed earlier run committed: fixtures older than 30 minutes, child-first. */
async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  const staleAssets = `SELECT id FROM bms.assets WHERE code LIKE $1 AND created_at < ${STALE}`;
  const staleDomains = `SELECT code FROM bms.asset_domains
    WHERE starts_with(code, '${FIXTURE_ASSET_DOMAIN_PREFIX}${DOMAIN_TAG}_') AND created_at < ${STALE}`;
  const staleOrgs = `SELECT id FROM bms.organizations WHERE code LIKE $1 AND created_at < ${STALE}`;
  try {
    await pool.query(`DELETE FROM bms.asset_points WHERE asset_id IN (${staleAssets})`, [PATTERN]);
    await pool.query(`DELETE FROM bms.assets WHERE id IN (${staleAssets})`, [PATTERN]);
    await pool.query(`DELETE FROM bms.org_trend_points WHERE domain IN (${staleDomains})`);
    await pool.query(`DELETE FROM bms.point_keys WHERE domain IN (${staleDomains})`);
    await pool.query(`DELETE FROM bms.asset_domains WHERE code IN (${staleDomains})`);
    await pool.query(`DELETE FROM bms.rtus WHERE organization_id IN (${staleOrgs})`, [PATTERN]);
    await pool.query(`DELETE FROM bms.locations WHERE organization_id IN (${staleOrgs})`, [PATTERN]);
    await pool.query(`DELETE FROM bms.organizations WHERE id IN (${staleOrgs})`, [PATTERN]);
  } catch (err) {
    process.stderr.write(
      "[F4.302] could not sweep stale fixture rows: " +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

/** A `pg.Pool` stand-in that forwards every statement to `pool` and records it. */
function forwardingPool(pool: pg.Pool): { pool: pg.Pool; statements: Recorded[] } {
  const statements: Recorded[] = [];
  const forwarding = {
    query: async (text: string, params: unknown[] = []) => {
      statements.push({ text, params });
      return pool.query(text, params);
    },
  } as unknown as pg.Pool;
  return { pool: forwarding, statements };
}

describe.skipIf(!connectionString)("F4.302 — SiteSegmentViewsService against real roles", () => {
  let owner: pg.Pool;
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: SegmentViewsCtx | undefined;
  let organizationId = "";
  let sampleFrom = new Date();

  beforeAll(async () => {
    const url = connectionString as string;
    owner = await openIntegrationPool(url, "F4.302");
    fleetPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.302");
    await primeSeededSubjects(fleetPool);
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.302");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.302",
    );
    await sweepStaleRuns(fleetPool);

    const one = async (sql: string, params: unknown[], what: string): Promise<string> => {
      const { rows } = await fleetPool.query<{ id: string }>(sql, params);
      if (!rows[0]) throw new Error(`F4.302: ${what} is not seeded — run pnpm db:seed.`);
      return rows[0].id;
    };
    const phewbId = await one(`SELECT id FROM bms.organizations WHERE code = 'PHEWB'`, [], "PHEWB");
    const rsmocWcId = await one(`SELECT id FROM bms.locations WHERE code = 'RSMOC-WC'`, [], "RSMOC-WC");
    const pheSiteId = await one(
      `SELECT id FROM bms.locations WHERE organization_id = $1 AND active ORDER BY created_at, id LIMIT 1`,
      [phewbId],
      "an active PHEWB site",
    );
    const upsSiteId = await one(
      `SELECT a.location_id AS id FROM bms.assets a
         JOIN bms.asset_points ap ON ap.asset_id = a.id AND ap.active
         JOIN bms.point_keys pk ON pk.code = ap.point_key AND pk.domain = 'ups' AND pk.active AND pk.trend_default
        WHERE a.domain = 'ups'
        ORDER BY a.created_at, a.id LIMIT 1`,
      [],
      "a ups-domain asset registering a ups trend point",
    );

    const run = `${Date.now()}-${randomUUID().slice(0, 4)}`;
    organizationId = await one(
      `INSERT INTO bms.organizations (code, name, currency, active) VALUES ($1, $2, 'INR', false) RETURNING id`,
      [`F4302-${run}-ORG`, "F4.302 fixture organization"],
      "fixture organization",
    );
    const site = async (suffix: string): Promise<string> =>
      one(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active, timezone)
         VALUES ($1, $2, $3, $4, 'rsmoc', 0, 0, false, 'Asia/Kolkata') RETURNING id`,
        [organizationId, `F4302-${run}-${suffix}`, `f4302-${run}-${suffix}`.toLowerCase(), `F4.302 fixture ${suffix}`],
        `fixture site ${suffix}`,
      );
    const siteId = await site("SITE");
    const emptySiteId = await site("EMPTY");

    // A per-run segment and code, listed by the fixture organization's override.
    // `fixtureAssetDomainCode` keeps it out of every parallel suite's pick, and
    // sort_order 64 keeps `facility` (70) last (the F4.301 T4 reasoning).
    const domain = fixtureAssetDomainCode(DOMAIN_TAG);
    const pointKey = `F4302-${run}-k`;
    await fleetPool.query(`INSERT INTO bms.asset_domains (code, label, sort_order) VALUES ($1, $2, 64)`, [
      domain,
      `F4.302 ${domain}`,
    ]);
    await fleetPool.query(`INSERT INTO bms.point_keys (code, name, domain) VALUES ($1, $2, $3)`, [
      pointKey,
      `F4.302 ${pointKey}`,
      domain,
    ]);
    await fleetPool.query(
      `INSERT INTO bms.org_trend_points (organization_id, domain, point_key, sort_order, updated_at)
       VALUES ($1, $2, $3, 0, now())`,
      [organizationId, domain, pointKey],
    );
    const assetIds: string[] = [];
    for (let n = 1; n <= ASSETS; n += 1) {
      assetIds.push(
        await one(
          `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
           VALUES ($1, $2, $3, $3, 'F4.302 fixture site', $4) RETURNING id`,
          [organizationId, siteId, `F4302-${run}-A${String(n).padStart(3, "0")}`, domain],
          `fixture asset ${n}`,
        ),
      );
    }
    // `F4.316` (ADR 0111): the top-ranked asset (A060) sits on an RTU; the rest are RTU-less.
    const rtuName = "F4.302 fixture RTU";
    const rtuId = await one(
      `INSERT INTO bms.rtus (organization_id, location_id, code, display_name) VALUES ($1, $2, $3, $4) RETURNING id`,
      [organizationId, siteId, `F4302-${run}-RTU`, rtuName],
      "fixture RTU",
    );
    await fleetPool.query(`UPDATE bms.assets SET rtu_id = $1 WHERE id = $2`, [rtuId, assetIds[ASSETS - 1]]);
    await fleetPool.query(
      `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key)
       SELECT $1, a, $2, $2 FROM unnest($3::uuid[]) AS a`,
      [organizationId, pointKey, assetIds],
    );

    // One sample per asset two hours back, asset n reading n.
    const at = new Date(Math.floor((Date.now() - 2 * HOUR_MS) / 60_000) * 60_000);
    sampleFrom = new Date(at.getTime() - HOUR_MS);
    await owner.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       SELECT $1::timestamptz, a, $2, n, 'u'
       FROM unnest($3::uuid[], $4::float8[]) AS x(a, n)`,
      [at.toISOString(), pointKey, assetIds, assetIds.map((_, i) => i + 1)],
    );
    await retryOnConcurrentRefresh(() => refreshAggregatesFrom(owner, sampleFrom));

    const tenantDb = createDb(tenantPool);
    const access = new AccessControlService(createDb(authPool), createDb(fleetPool));
    const trendPoints = new TrendPointsService(
      createDb(fleetPool),
      tenantDb,
      access,
      new MasterDataAuditService(tenantDb, createDb(fleetPool)),
    );
    const forwarding = forwardingPool(fleetPool);
    ctx = {
      svc: new SiteSegmentViewsService(forwarding.pool, access, trendPoints),
      statements: forwarding.statements,
      access,
      fleetPool,
      rsmocWcId,
      pheSiteId,
      upsSiteId,
      fixture: { siteId, emptySiteId, siteName: "F4.302 fixture SITE", rtuName, domain, pointKey, assetIds },
    };
  }, 180_000);

  afterAll(async () => {
    try {
      if (ctx) {
        const { assetIds, domain, pointKey } = ctx.fixture;
        await owner.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[]) AND point_key = $2`, [
          assetIds,
          pointKey,
        ]);
        await retryOnConcurrentRefresh(() => refreshAggregatesFrom(owner, sampleFrom));
        await fleetPool.query(`DELETE FROM bms.asset_points WHERE asset_id = ANY($1::uuid[])`, [assetIds]);
        await fleetPool.query(`DELETE FROM bms.assets WHERE id = ANY($1::uuid[])`, [assetIds]);
        await fleetPool.query(`DELETE FROM bms.org_trend_points WHERE domain = $1`, [domain]);
        await fleetPool.query(`DELETE FROM bms.point_keys WHERE code = $1`, [pointKey]);
        await fleetPool.query(`DELETE FROM bms.asset_domains WHERE code = $1`, [domain]);
      }
      if (organizationId) {
        await fleetPool.query(`DELETE FROM bms.rtus WHERE organization_id = $1`, [organizationId]);
        await fleetPool.query(`DELETE FROM bms.locations WHERE organization_id = $1`, [organizationId]);
        await fleetPool.query(`DELETE FROM bms.organizations WHERE id = $1`, [organizationId]);
      }
    } finally {
      await Promise.all([owner?.end(), fleetPool?.end(), authPool?.end(), tenantPool?.end()]);
    }
  }, 180_000);

  const run = (assertion: (ctx: SegmentViewsCtx) => Promise<void>) => async () => {
    if (!ctx) throw new Error("fixture required");
    await assertion(ctx);
  };

  it("V1 wc-admin on a PHEWB site is a 404 with no telemetry statement", run(assertAForeignSiteIsA404WithNoTelemetry));
  it("V2 wc-hvac-admin binds, ranks and judges no asset outside its groups", run(assertAGroupScopedCallerSeesOnlyItsAssets));
  it("V3 a global admin binds the site's explicit asset list", run(assertAGlobalAdminBindsTheExplicitSiteList));
  it("V4 a site with no asset sends no telemetry statement", run(assertNoCandidateSendsNoTelemetry));
  it("V5a exactly two telemetry statements without compare", run(assertTwoStatementsWithoutCompare));
  it("V5b exactly two telemetry statements with compare", run(assertTwoStatementsWithCompare));
  it("V6 a per-run segment listed by an override is a segment at the read", run(assertANewSegmentAppears));
  it("V7 a seeded ups asset appears under ups only", run(assertUpsAssetsAppearUnderUpsOnly));
  it("V8 60 candidates rank 50, moreAssets 10, 8 series, trimmed", run(assertSixtyCandidatesAreCapped));
  it("V9 a 46-day custom range is 1h level, 1d bucket", run(assertA46DayRangeIsHourLevelDayBucket));
  it("V10 a ranking entry names its RTU and location; the RTU-less twin has a null RTU name (F4.316)", run(assertARankingEntryNamesItsRtuAndLocation));

  // `F4.303` U4 (ADR 0108 Amendment 6 item 3) — the export.
  it("G1 wc-admin's export of a PHEWB site is a 404 with no telemetry statement", run(assertAForeignSiteExportIsA404WithNoTelemetry));
  it("G2 each exported mean is forSite's bucket v for the same query", run(assertTheExportMeansAreForSitesBuckets));
  it("G3 only the drawn series are exported", run(assertOnlyTheDrawnSeriesAreExported));
  it("G4 with compare the previous rows are compareBuckets", run(assertThePreviousRowsAreCompareBuckets));
  it("G5 a lowered cap refuses before any telemetry statement", run(assertALoweredCapRefusesBeforeTelemetry));
});
