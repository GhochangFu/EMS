import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { SEEDED, primeSeededSubjects } from "../testing/seeded-subjects";
import {
  SEGMENT,
  type TrendPointsCtx,
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
  assertTenantPolicyIsolatesTheRow,
  assertUnknownCodeIsBadRequest,
  assertUnknownSegmentIsNotFound,
  assertWriteIsAudited,
} from "./trend-points.integration.spec";
import { TrendPointsService } from "./trend-points.service";

/**
 * `F4.300` — Vitest entry point for `TrendPointsService` under real RLS (plan
 * U3), on the `site-control-room-view.integration.test.ts` harness. Assertions
 * live in the sibling `.spec` (ADR 0014); this file owns the pools, the stale
 * sweep, the PHEWB snapshot and the child-first cleanup.
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

/** Reaps what a killed earlier run committed: fixtures older than 30 minutes, child-first. */
async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  const staleKeys = `SELECT code FROM bms.point_keys WHERE code LIKE 'F4300-%' AND created_at < ${STALE}`;
  const staleOrgs = `SELECT id FROM bms.organizations WHERE code LIKE 'F4300-%' AND created_at < ${STALE}`;
  try {
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

    const tenantDb = createDb(tenantPool);
    ctx = {
      svc: new TrendPointsService(
        createDb(fleetPool),
        tenantDb,
        new AccessControlService(createDb(authPool), createDb(fleetPool)),
        new MasterDataAuditService(tenantDb, createDb(fleetPool)),
      ),
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
    };
  });

  afterAll(async () => {
    if (ctx) {
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
    await Promise.all([fleetPool?.end(), authPool?.end(), tenantPool?.end()]);
  });

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
});
