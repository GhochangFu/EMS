import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  PHE_ADMIN_EMAIL,
  type SiteViewCtx,
  assertAdminCanReplaceBuiltin,
  assertAssetGroupAdminCannotResolveAnotherSite,
  assertAssetGroupAdminResolvesItsSite,
  assertBuiltinIsAdminOnly,
  assertDashboardWriteIsAudited,
  assertDashboardWriteLandsUnderTheTenant,
  assertFreshSiteReadsGenerated,
  assertGeneratedOverBuiltinUpserts,
  assertGroupScopedDashboardIsAccepted,
  assertInScopeResolveAnswers,
  assertNonAdminCannotReplaceBuiltin,
  assertOperatorIsRefused,
  assertOtherOrganizationDashboardIsRefused,
  assertOtherSiteDashboardIsRefused,
  assertOutOfScopeReadIsRefused,
  assertOutOfScopeResolveIsNotFound,
  assertOutOfScopeWriteIsRefused,
  assertPolicyRefusesMismatchedOrganization,
  assertRefusedReplaceLeavesTheRow,
  assertRemovedDashboardResolvesGenerated,
  assertRescopedDashboardResolvesOutOfScope,
  assertSecondWriteUpserts,
  assertSiteMovedToAnotherOrganizationIsOutOfScope,
  assertUngrantedPrincipalCannotResolve,
} from "./site-control-room-view.integration.spec";
import { SiteControlRoomViewService } from "./site-control-room-view.service";

/**
 * `F3.67` — Vitest entry point for `SiteControlRoomViewService` under real RLS
 * (plan U3, S1–S14; step-5 review S15–S18), on the `locations.rls.integration.test.ts` harness.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the pools,
 * the stale sweep and the cleanup.
 */
const connectionString = requireIntegrationDb({
  item: "F3.67",
  label: "SiteControlRoomViewService against real, non-owner roles",
  because:
    "the setting write runs inside withTenant under migration 0082's two-leg policy, the " +
    "cross-table rules read real dashboards and asset groups, and the resolver's fail-safe " +
    "is proved by deleting and re-scoping a real dashboard — none of which a mock can show.",
});

/** Reaps what a killed or failed earlier run committed: rows older than 30 minutes, child-first. */
async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  const stale = `SELECT id FROM bms.locations WHERE code LIKE 'F367-%' AND created_at < now() - interval '30 minutes'`;
  try {
    await pool.query(
      `DELETE FROM bms.audit_log WHERE entity_type = 'site_control_room_view' AND entity_id IN (${stale})`,
    );
    // Setting rows before anything else (migration review L1: `updated_by`
    // references bms.users with no ON DELETE).
    await pool.query(`DELETE FROM bms.site_control_room_views WHERE location_id IN (${stale})`);
    await pool.query(
      `DELETE FROM bms.dashboards WHERE slug LIKE 'f367-%' AND created_at < now() - interval '30 minutes'`,
    );
    await pool.query(`DELETE FROM bms.asset_groups WHERE location_id IN (${stale})`);
    await pool.query(
      `DELETE FROM bms.locations WHERE code LIKE 'F367-%' AND created_at < now() - interval '30 minutes'`,
    );
  } catch (err) {
    process.stderr.write(
      "[F3.67] could not sweep stale fixture rows: " +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

describe.skipIf(!connectionString)("F3.67 — SiteControlRoomViewService under real RLS", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: SiteViewCtx;
  let rsmocWcId = "";
  let pheSiteId = "";

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "F3.67");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.67",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.67",
    );

    await sweepStaleRuns(fleetPool);

    const org = async (code: string): Promise<string> => {
      const { rows } = await fleetPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = $1`,
        [code],
      );
      if (!rows[0]) throw new Error(`F3.67: organization ${code} is not seeded — run pnpm db:seed.`);
      return rows[0].id;
    };
    const phewbId = await org("PHEWB");
    const eskomId = await org("ESKOM");

    const { rows: pheAdmin } = await fleetPool.query<{ id: string }>(
      `SELECT id FROM bms.users WHERE email = $1`,
      [PHE_ADMIN_EMAIL],
    );
    if (!pheAdmin[0]) throw new Error(`F3.67: ${PHE_ADMIN_EMAIL} is not seeded — run pnpm db:seed.`);

    const { rows: rsmoc } = await fleetPool.query<{ id: string }>(
      `SELECT id FROM bms.locations WHERE code = 'RSMOC-WC'`,
    );
    if (!rsmoc[0]) throw new Error("F3.67: RSMOC-WC is not seeded — run pnpm db:seed.");
    rsmocWcId = rsmoc[0].id;

    // S11a reads (never writes) one seeded, active PHEWB site: phe-admin's read
    // scope is active locations only, and a fixture is inactive by design.
    const { rows: pheSite } = await fleetPool.query<{ id: string }>(
      `SELECT id FROM bms.locations
        WHERE organization_id = $1 AND active AND code NOT LIKE 'F367-%'
        ORDER BY created_at, id LIMIT 1`,
      [phewbId],
    );
    if (!pheSite[0]) throw new Error("F3.67: no active PHEWB site is seeded — run pnpm db:seed.");
    pheSiteId = pheSite[0].id;

    const tenantDb = createDb(tenantPool);
    ctx = {
      svc: new SiteControlRoomViewService(
        createDb(fleetPool),
        tenantDb,
        new AccessControlService(createDb(authPool), createDb(fleetPool)),
        new MasterDataAuditService(tenantDb, createDb(fleetPool)),
      ),
      fleetPool,
      tenantDb,
      run: `${Date.now()}-${randomUUID().slice(0, 4)}`,
      phewbId,
      eskomId,
      pheAdminUserId: pheAdmin[0].id,
      created: { locations: [], groups: [], dashboards: [] },
    };
  });

  afterAll(async () => {
    // Child-first, as bms_fleet. Setting rows go before anything else
    // (migration review L1: `updated_by` is RESTRICT into bms.users). This
    // suite writes no fixture user — the operator in S8 is an unprovisioned
    // claim — so no user delete can ever meet a setting row.
    if (ctx) {
      const { locations, groups, dashboards } = ctx.created;
      await fleetPool.query(
        `DELETE FROM bms.audit_log WHERE entity_type = 'site_control_room_view' AND entity_id = ANY($1)`,
        [locations],
      );
      await fleetPool.query(`DELETE FROM bms.site_control_room_views WHERE location_id = ANY($1)`, [
        locations,
      ]);
      await fleetPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1)`, [dashboards]);
      await fleetPool.query(`DELETE FROM bms.asset_groups WHERE id = ANY($1)`, [groups]);
      await fleetPool.query(`DELETE FROM bms.locations WHERE id = ANY($1)`, [locations]);
    }
    await Promise.all([fleetPool?.end(), authPool?.end(), tenantPool?.end()]);
  });

  it("S1 a site with no row reads as generated, with nulls", async () => {
    await assertFreshSiteReadsGenerated(ctx);
  });

  it("S2a a site-scoped dashboard is written under the site's organization, by the real user id", async () => {
    await assertDashboardWriteLandsUnderTheTenant(ctx);
  });

  it("S2b the write is audited with the action, the organization and the site", async () => {
    await assertDashboardWriteIsAudited(ctx);
  });

  it("S3 a dashboard scoped to one of the site's asset groups is accepted", async () => {
    await assertGroupScopedDashboardIsAccepted(ctx);
  });

  it("S4 a dashboard scoped to another site is refused for scope", async () => {
    await assertOtherSiteDashboardIsRefused(ctx);
  });

  it("S5 another organization's dashboard is refused for organization", async () => {
    await assertOtherOrganizationDashboardIsRefused(ctx);
  });

  it("S6 a second write upserts the one row and moves updated_at forward", async () => {
    await assertSecondWriteUpserts(ctx);
  });

  it("S7a phe-admin reading RSMOC-WC is refused by scope", async () => {
    await assertOutOfScopeReadIsRefused(ctx, rsmocWcId);
  });

  it("S7b phe-admin writing an ESKOM site is refused by scope", async () => {
    await assertOutOfScopeWriteIsRefused(ctx);
  });

  it("S8 an operator is refused master-data administration", async () => {
    await assertOperatorIsRefused(ctx);
  });

  it("S9 a deleted dashboard resolves generated with dashboard_removed; the setting keeps kind", async () => {
    await assertRemovedDashboardResolvesGenerated(ctx);
  });

  it("S10 a re-scoped dashboard resolves dashboard_out_of_scope", async () => {
    await assertRescopedDashboardResolvesOutOfScope(ctx);
  });

  it("S11a phe-admin resolves a PHEWB site in its read scope", async () => {
    await assertInScopeResolveAnswers(ctx, pheSiteId);
  });

  it("S11b phe-admin resolving an ESKOM site gets the 404", async () => {
    await assertOutOfScopeResolveIsNotFound(ctx);
  });

  it("S12 the policy refuses a row stamped with another organization than the GUC", async () => {
    await assertPolicyRefusesMismatchedOrganization(ctx);
  });

  it("S13 generated over a builtin row upserts it, it does not delete it", async () => {
    await assertGeneratedOverBuiltinUpserts(ctx);
  });

  it("S14 only the global admin sets builtin (OQ1), decided on the database role", async () => {
    await assertBuiltinIsAdminOnly(ctx);
  });

  it("S15a a non-admin replacing a builtin view is refused with the replace rule (OQ3)", async () => {
    await assertNonAdminCannotReplaceBuiltin(ctx);
  });

  it("S15b the refused replace leaves the stored row exactly as it was (OQ3)", async () => {
    await assertRefusedReplaceLeavesTheRow(ctx);
  });

  it("S15c the global admin replaces a builtin view (OQ3 positive control)", async () => {
    await assertAdminCanReplaceBuiltin(ctx);
  });

  it("S16a an asset_group_admin resolves the site its group sits on", async () => {
    await assertAssetGroupAdminResolvesItsSite(ctx);
  });

  it("S16b an asset_group_admin resolving another existing site gets the 404", async () => {
    await assertAssetGroupAdminCannotResolveAnotherSite(ctx);
  });

  it("S17 a principal with no grants resolving an existing site gets the 404", async () => {
    await assertUngrantedPrincipalCannotResolve(ctx);
  });

  it("S18 a site moved to another organization resolves dashboard_out_of_scope", async () => {
    await assertSiteMovedToAnotherOrganizationIsOutOfScope(ctx);
  });
});
