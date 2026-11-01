import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { FIXTURE_ASSET_DOMAIN_PREFIX, createDb, fixtureAssetDomainCode } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { recordingPool } from "../testing/recording-pool";
import { asRole } from "../testing/role-urls";
import { SEEDED, primeSeededSubjects } from "../testing/seeded-subjects";
import {
  SEGMENT,
  type TrendPointsCtx,
  assertConcurrentWritesSerialize,
  assertEmptyBodyRestoresTheCatalog,
  assertGlobalAdminWritesAnyOrganization,
  assertLocationAdminCannotReadAnotherSite,
  assertLocationAdminIsRefused,
  assertLocationAdminReadsItsSite,
  assertMissingOrganizationIsNotFound,
  assertOperatorIsRefused,
  assertOrgAdminCannotWriteAnotherOrganization,
  assertOrgAdminWritesItsOrganization,
  assertRetiredCodeIsHiddenAndKept,
  assertSecondWriteReplaces,
  assertStripDrawsUpsAssetsUnderTheUpsSegmentOnly,
  assertStripGroupOfAnotherSiteIsA404,
  assertStripHidesAssetsOutsideTheCallersGroups,
  assertStripOnAForeignSiteIsA404WithNoStatement,
  assertStripSegmentIsNotAParallelSuitesPick,
  assertStripShowsANewSegment,
  assertTenantPolicyIsolatesTheRow,
  assertUnknownCodeIsBadRequest,
  assertUnknownSegmentIsNotFound,
  assertWriteIsAudited,
} from "./trend-points.integration.spec";
import { TrendPointsService } from "./trend-points.service";
import { SiteTrendStripService } from "./trend-strip.service";

/**
 * `F4.300` — Vitest entry point for `TrendPointsService` under real RLS (plan
 * U3), on the `site-control-room-view.integration.test.ts` harness. Assertions
 * live in the sibling `.spec` (ADR 0014); this file owns the pools, the stale
 * sweep, the PHEWB snapshot and the child-first cleanup. `F4.301` U3 adds the
 * trend strip cases (T1–T5) and T4's per-run `zz_fixture_` segment, code,
 * override and asset at the inactive fixture site, removed child-first before
 * the F4.300 fixtures they hang off.
 */
const connectionString = requireIntegrationDb({
  item: "F4.300",
  label: "TrendPointsService against real, non-owner roles",
  because:
    "the override write runs inside withTenant under migration 0117's FORCE policy, the " +
    "gate reads real organization grants, and the fallback reads real asset_domains and " +
    "point_keys rows — none of which a mock can show.",
});

type SnapshotRow = {
  domain: string;
  point_key: string;
  sort_order: number;
  updated_at: Date;
  updated_by: string | null;
};

const STALE = "now() - interval '30 minutes'";

/** T4's per-run domain tag, for {@link fixtureAssetDomainCode} and the sweep. */
const STRIP_DOMAIN_TAG = "f_trend_strip";

/** Reaps what a killed earlier run committed: fixtures older than 30 minutes, child-first. */
async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  const staleKeys = `SELECT code FROM bms.point_keys WHERE code LIKE 'F4300-%' AND created_at < ${STALE}`;
  const staleStripAssets = `SELECT id FROM bms.assets WHERE code LIKE 'F4301-%' AND created_at < ${STALE}`;
  // The prefixed code since the F4.301 review; `F4301-%` is what a killed run
  // before it left behind.
  const staleStripDomains = `SELECT code FROM bms.asset_domains
    WHERE (starts_with(code, '${FIXTURE_ASSET_DOMAIN_PREFIX}${STRIP_DOMAIN_TAG}_') OR code LIKE 'F4301-%')
      AND created_at < ${STALE}`;
  const staleOrgs = `SELECT id FROM bms.organizations WHERE code LIKE 'F4300-%' AND created_at < ${STALE}`;
  try {
    // F4.301 first: its assets and override rows hang off the F4.300 fixtures.
    await pool.query(`DELETE FROM bms.asset_points WHERE asset_id IN (${staleStripAssets})`);
    await pool.query(`DELETE FROM bms.assets WHERE id IN (${staleStripAssets})`);
    await pool.query(`DELETE FROM bms.org_trend_points WHERE domain IN (${staleStripDomains})`);
    await pool.query(`DELETE FROM bms.point_keys WHERE domain IN (${staleStripDomains})`);
    await pool.query(`DELETE FROM bms.asset_domains WHERE code IN (${staleStripDomains})`);
    await pool.query(
      `DELETE FROM bms.audit_log WHERE entity_type = 'org_trend_points' AND entity_id IN (${staleOrgs})`,
    );
    await pool.query(
      `DELETE FROM bms.org_trend_points WHERE point_key IN (${staleKeys}) OR organization_id IN (${staleOrgs})`,
    );
    await pool.query(`DELETE FROM bms.point_keys WHERE code IN (${staleKeys})`);
    await pool.query(`DELETE FROM bms.locations WHERE code LIKE 'F4300-%' AND created_at < ${STALE}`);
    await pool.query(`DELETE FROM bms.organizations WHERE id IN (${staleOrgs})`);
  } catch (err) {
    process.stderr.write(
      "[F4.300] could not sweep stale fixture rows: " +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

describe.skipIf(!connectionString)("F4.300 — TrendPointsService under real RLS", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: TrendPointsCtx;
  let adminUserId = "";
  let phewbSnapshot: SnapshotRow[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "F4.300");
    await primeSeededSubjects(fleetPool);
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.300",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.300",
    );
    await sweepStaleRuns(fleetPool);

    const one = async (sql: string, params: unknown[], what: string): Promise<string> => {
      const { rows } = await fleetPool.query<{ id: string }>(sql, params);
      if (!rows[0]) throw new Error(`F4.300: ${what} is not seeded — run pnpm db:seed.`);
      return rows[0].id;
    };
    const phewbId = await one(`SELECT id FROM bms.organizations WHERE code = 'PHEWB'`, [], "PHEWB");
    const eskomId = await one(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`, [], "ESKOM");
    adminUserId = await one(`SELECT id FROM bms.users WHERE email = $1`, [SEEDED.globalAdmin], "admin");
    const rsmocWcId = await one(`SELECT id FROM bms.locations WHERE code = 'RSMOC-WC'`, [], "RSMOC-WC");
    const pheSiteId = await one(
      `SELECT id FROM bms.locations WHERE organization_id = $1 AND active ORDER BY created_at, id LIMIT 1`,
      [phewbId],
      "an active PHEWB site",
    );
    await one(`SELECT code AS id FROM bms.asset_domains WHERE code = $1 AND active`, [SEGMENT], SEGMENT);

    // S1 and S12 write PHEWB's list for SEGMENT; keep what was there to put it back.
    phewbSnapshot = (
      await fleetPool.query<SnapshotRow>(
        `SELECT domain, point_key, sort_order, updated_at, updated_by FROM bms.org_trend_points
          WHERE organization_id = $1 AND domain = $2`,
        [phewbId, SEGMENT],
      )
    ).rows;

    const run = `${Date.now()}-${randomUUID().slice(0, 4)}`;
    const keys = [`F4300-${run}-a`, `F4300-${run}-b`, `F4300-${run}-c`] as const;
    for (const code of keys) {
      await fleetPool.query(`INSERT INTO bms.point_keys (code, name, domain) VALUES ($1, $2, $3)`, [
        code,
        `F4.300 ${code}`,
        SEGMENT,
      ]);
    }
    const fixtureOrgId = await one(
      `INSERT INTO bms.organizations (code, name, currency, active) VALUES ($1, $2, 'ZAR', false) RETURNING id`,
      [`F4300-${run}-ORG`, "F4.300 fixture organization"],
      "fixture organization",
    );
    const siteCode = `F4300-${run}-SITE`;
    const fixtureSiteId = await one(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
       VALUES ($1, $2, $3, 'F4.300 fixture site', 'rsmoc', 0, 0, false) RETURNING id`,
      [fixtureOrgId, siteCode, siteCode.toLowerCase()],
      "fixture site",
    );

    // F4.301 T4: a per-run segment, a code of it, the fixture organization's
    // override listing that code, and one asset at the fixture site registering it.
    // The domain is live to every parallel suite while this one runs, so
    // `fixtureAssetDomainCode` names it: the boot gate's exact domain count
    // skips its prefix, `zz_` sorts it after every seeded code (an
    // `ORDER BY code LIMIT 1` pick elsewhere never lands on it), and
    // `sort_order` 65 keeps `facility` (70) last in the F2.13 *Expected one of*.
    const stripDomain = fixtureAssetDomainCode(STRIP_DOMAIN_TAG);
    const stripKey = `F4301-${run}-k`;
    await fleetPool.query(`INSERT INTO bms.asset_domains (code, label, sort_order) VALUES ($1, $2, 65)`, [
      stripDomain,
      `F4.301 ${stripDomain}`,
    ]);
    await fleetPool.query(`INSERT INTO bms.point_keys (code, name, domain) VALUES ($1, $2, $3)`, [
      stripKey,
      `F4.301 ${stripKey}`,
      stripDomain,
    ]);
    await fleetPool.query(
      `INSERT INTO bms.org_trend_points (organization_id, domain, point_key, sort_order, updated_at)
       VALUES ($1, $2, $3, 0, now())`,
      [fixtureOrgId, stripDomain, stripKey],
    );
    const stripAssetId = await one(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, 'F4.301 fixture asset', 'F4.301 fixture site', $4) RETURNING id`,
      [fixtureOrgId, fixtureSiteId, `F4301-${run}-A`, stripDomain],
      "F4.301 fixture asset",
    );
    await fleetPool.query(
      `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key) VALUES ($1, $2, $3, $4)`,
      [fixtureOrgId, stripAssetId, stripKey, stripKey],
    );
    const phewbGroupId = await one(
      `SELECT id FROM bms.asset_groups WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      [phewbId],
      "a PHEWB asset group",
    );
    const rsmocWcGroupId = await one(
      `SELECT id FROM bms.asset_groups WHERE location_id = $1 ORDER BY created_at, id LIMIT 1`,
      [rsmocWcId],
      "an RSMOC-WC asset group",
    );
    // A ups-domain asset that registers a catalog-default ups trend point: most
    // seeded UPS assets register only kw/pf/voltage (not ups codes), so they draw
    // no row by Amendment 2 item 2; the RSMOC-WC batteries register backup_min.
    const upsSiteId = await one(
      `SELECT a.location_id AS id FROM bms.assets a
         JOIN bms.asset_points ap ON ap.asset_id = a.id AND ap.active
         JOIN bms.point_keys pk ON pk.code = ap.point_key AND pk.domain = 'ups' AND pk.active AND pk.trend_default
        WHERE a.domain = 'ups'
        ORDER BY a.created_at, a.id LIMIT 1`,
      [],
      "a ups-domain asset registering a ups trend point (#969's seed)",
    );

    const tenantDb = createDb(tenantPool);
    const access = new AccessControlService(createDb(authPool), createDb(fleetPool));
    const svc = new TrendPointsService(
      createDb(fleetPool),
      tenantDb,
      access,
      new MasterDataAuditService(tenantDb, createDb(fleetPool)),
    );
    const recording = recordingPool();
    ctx = {
      svc,
      fleetPool,
      tenantDb,
      run,
      phewbId,
      eskomId,
      fixtureOrgId,
      fixtureSiteId,
      rsmocWcId,
      pheSiteId,
      keys,
      strip: {
        svc: new SiteTrendStripService(fleetPool, access, svc),
        recording: { svc: new SiteTrendStripService(recording.pool, access, svc), statements: recording.statements },
        access,
        phewbGroupId,
        rsmocWcGroupId,
        upsSiteId,
        segment: { domain: stripDomain, pointKey: stripKey, assetId: stripAssetId },
      },
    };
  });

  afterAll(async () => {
    try {
      if (ctx) await cleanUp(ctx);
    } finally {
      await Promise.all([fleetPool?.end(), authPool?.end(), tenantPool?.end()]);
    }
  });

  /**
   * F4.301 first, child-first: registration, asset, override, code, segment.
   * In a `try` whose `finally` runs the F4.300 cleanup, so a failed F4.301
   * delete never leaks the F4.300 fixtures (the error still fails the hook).
   */
  async function cleanUp(ctx: TrendPointsCtx): Promise<void> {
    const strip = ctx.strip.segment;
    try {
      await fleetPool.query(`DELETE FROM bms.asset_points WHERE asset_id = $1`, [strip.assetId]);
      await fleetPool.query(`DELETE FROM bms.assets WHERE id = $1`, [strip.assetId]);
      await fleetPool.query(`DELETE FROM bms.org_trend_points WHERE domain = $1`, [strip.domain]);
      await fleetPool.query(`DELETE FROM bms.point_keys WHERE code = $1`, [strip.pointKey]);
      await fleetPool.query(`DELETE FROM bms.asset_domains WHERE code = $1`, [strip.domain]);
    } finally {
      await cleanUpF4300(ctx);
    }
  }

  async function cleanUpF4300(ctx: TrendPointsCtx): Promise<void> {
    const keys = [...ctx.keys];
    // Child-first, as bms_fleet: audit rows, override rows (they reference the
    // keys and the organization with no ON DELETE), then the fixtures.
    await fleetPool.query(
      `DELETE FROM bms.audit_log WHERE entity_type = 'org_trend_points'
        AND (entity_id = $1 OR (entity_id = $2 AND payload::text LIKE $3))`,
      [ctx.fixtureOrgId, ctx.phewbId, `%F4300-${ctx.run}-%`],
    );
    await fleetPool.query(
      `DELETE FROM bms.org_trend_points WHERE point_key = ANY($1) OR organization_id = $2`,
      [keys, ctx.fixtureOrgId],
    );
    // Put PHEWB's list back exactly as it was (a replace-all write cleared it).
    await fleetPool.query(`DELETE FROM bms.org_trend_points WHERE organization_id = $1 AND domain = $2`, [
      ctx.phewbId,
      SEGMENT,
    ]);
    for (const row of phewbSnapshot) {
      await fleetPool.query(
        `INSERT INTO bms.org_trend_points (organization_id, domain, point_key, sort_order, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ctx.phewbId, row.domain, row.point_key, row.sort_order, row.updated_at, row.updated_by],
      );
    }
    await fleetPool.query(`DELETE FROM bms.point_keys WHERE code = ANY($1)`, [keys]);
    await fleetPool.query(`DELETE FROM bms.locations WHERE id = $1`, [ctx.fixtureSiteId]);
    await fleetPool.query(`DELETE FROM bms.organizations WHERE id = $1`, [ctx.fixtureOrgId]);
  }

  it("S1a a PHEWB organization_admin writes PHEWB's list, in body order", async () => {
    await assertOrgAdminWritesItsOrganization(ctx);
  });

  it("S1b the row reads 1 as tenant PHEWB and 0 as tenant ESKOM (FORCE, non-vacuous)", async () => {
    await assertTenantPolicyIsolatesTheRow(ctx);
  });

  it("S2 a PHEWB organization_admin writing ESKOM's list gets the 403", async () => {
    await assertOrgAdminCannotWriteAnotherOrganization(ctx);
  });

  it("S3 a location_admin gets the 403", async () => {
    await assertLocationAdminIsRefused(ctx);
  });

  it("S4 an operator is refused by requireMasterDataUser", async () => {
    await assertOperatorIsRefused(ctx);
  });

  it("S5 an unknown segment is a 404", async () => {
    await assertUnknownSegmentIsNotFound(ctx);
  });

  it("S6 a code not in point_keys is a 400 naming it", async () => {
    await assertUnknownCodeIsBadRequest(ctx);
  });

  it("S7 a second write replaces the list", async () => {
    await assertSecondWriteReplaces(ctx);
  });

  it("S8 an empty body deletes the rows and the segment reads catalog again", async () => {
    await assertEmptyBodyRestoresTheCatalog(ctx);
  });

  it("S9 a retired code is hidden from the site read, kept as a row, marked on the admin read", async () => {
    try {
      await assertRetiredCodeIsHiddenAndKept(ctx);
    } finally {
      await fleetPool.query(`UPDATE bms.point_keys SET active = true WHERE code = $1`, [ctx.keys[1]]);
    }
  });

  it("S10 the write is audited with the action, the organization and the actor", async () => {
    await assertWriteIsAudited(ctx, adminUserId);
  });

  it("S11a a location_admin reads its ESKOM site's list", async () => {
    await assertLocationAdminReadsItsSite(ctx);
  });

  it("S11b a location_admin reading a PHEWB site gets the 404", async () => {
    await assertLocationAdminCannotReadAnotherSite(ctx);
  });

  it("S12 a global admin writes PHEWB's list", async () => {
    await assertGlobalAdminWritesAnyOrganization(ctx);
  });

  it("S13 a missing organization is a 404 for a global admin", async () => {
    await assertMissingOrganizationIsNotFound(ctx);
  });

  it("T1 F4.301: wc-hvac-admin's strip draws no asset outside its groups, and does draw its own", async () => {
    await assertStripHidesAssetsOutsideTheCallersGroups(ctx);
  });

  it("T2 F4.301: wc-admin's strip on a PHEWB site is a 404 with no statement", async () => {
    await assertStripOnAForeignSiteIsA404WithNoStatement(ctx);
  });

  it("T3 F4.301: a PHEWB group on an ESKOM site is the group 404", async () => {
    await assertStripGroupOfAnotherSiteIsA404(ctx);
  });

  it("T4 F4.301: a new segment listed by an organization override is its own strip segment", async () => {
    await assertStripShowsANewSegment(ctx);
  });

  it("T4b F4.301 review: T4's live segment is not a parallel suite's first-by-code pick", async () => {
    await assertStripSegmentIsNotAParallelSuitesPick(ctx);
  });

  it("T5 F4.301: a seeded ups asset draws under the ups segment only", async () => {
    await assertStripDrawsUpsAssetsUnderTheUpsSegmentOnly(ctx);
  });

  it("S14 two overlapping writes to one segment serialize: one body wins, no 500", async () => {
    await assertConcurrentWritesSerialize(ctx);
  });
});
