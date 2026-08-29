import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertCrossOrgBindingWasWritten,
  assertFleetPoolExcludesForeignBinding,
  assertLegitimateBindingResolvesOnBothPools,
  assertTenantPoolExcludesForeignBinding,
  assertWriteGuardRefusesForeignPointOnly,
} from "./dashboard-point-scope.integration.spec";

/**
 * `F3.1b` Task 5 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this
 * file owns the database lifecycle and the manufactured fixture.
 *
 * **The fixture is manufactured through the "superuser" role url (`bms_app`), not `bms_fleet`**
 * — `resolveIntegrationRoleUrl(url, "superuser", process.env)`, the same derivation
 * `integration-db-gate.ts` performs; ADR 0045 keeps the literal env var name out of every file
 * under `apps/api/src` but this one, so it is not spelled out here either.
 * A genuine Postgres superuser bypasses row security entirely regardless of `FORCE`, so the
 * INSERT below lands even though `dashboard_widget_points`'s own `WITH CHECK` would otherwise
 * refuse a foreign `point_id` at write time (the exact refusal Task 4's cross-org tests already
 * prove through the normal API). Do NOT "simplify" this to `bms_fleet` or to going through
 * `DashboardsService.putWidgets` — either would either fail to construct the fixture or route
 * through `assertBoundPointsInOrganization`, which refuses it, defeating the setup this file
 * exists to prove something about.
 */
const connectionString = requireIntegrationDb({
  item: "F3.1b",
  label: "the dashboard-point-scope organization guard (Task 5)",
  because:
    "whether a foreign assetId/pointKey can leave resolveBoundPoints on the BYPASSRLS fleet " +
    "pool is a fact about a real connection and a real policy — a fake db proves nothing about " +
    "either, and the whole point of this suite is the one assertion that only fails when the " +
    "explicit organization predicate is missing.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)(
  "F3.1b Task 5 — dashboard-point-scope: the bound-point organization guard",
  () => {
    let superuserPool: pg.Pool;
    let ownerPool: pg.Pool;
    let tenantPool: pg.Pool;
    let fleetDb: BmsDb;
    let tenantDb: BmsDb;

    let eskomOrgId: string;
    let dashboardId: string;
    let widgetId: string;
    let legitEskomPointId: string;
    let legitEskomAssetId: string;
    let legitEskomPointKey: string;
    let phewbPointId: string;
    let phewbAssetId: string;
    let phewbPointKey: string;

    beforeAll(async () => {
      const url = connectionString as string;
      const superuserUrl = resolveIntegrationRoleUrl(url, "superuser", process.env);
      superuserPool = await openIntegrationPool(superuserUrl, "F3.1b Task 5");
      ownerPool = await openIntegrationPool(url, "F3.1b Task 5");
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F3.1b Task 5",
      );
      fleetDb = createDb(ownerPool);
      tenantDb = createDb(tenantPool);

      const eskom = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
      );
      const phewb = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'PHEWB' LIMIT 1`,
      );
      eskomOrgId = eskom.rows[0]?.id ?? "";
      const phewbOrgId = phewb.rows[0]?.id ?? "";
      if (!eskomOrgId || !phewbOrgId) {
        throw new Error("F3.1b Task 5: ESKOM/PHEWB organizations not found — run pnpm db:seed");
      }

      // F4.53 (finding 7, review): ORDER BY created_at (id as a tiebreaker) resolves the OLDEST
      // row — a seeded one, which predates every suite in the run. ESKOM has exactly one
      // seeded asset_points row while other suites create and delete transient ESKOM points in
      // the same parallel run; an unordered LIMIT 1 can adopt one of those and then find it
      // gone under ON DELETE CASCADE.
      const eskomPoint = await ownerPool.query<{ id: string; asset_id: string; point_key: string }>(
        `SELECT id, asset_id, point_key FROM bms.asset_points
          WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
        [eskomOrgId],
      );
      const phewbPoint = await ownerPool.query<{ id: string; asset_id: string; point_key: string }>(
        `SELECT id, asset_id, point_key FROM bms.asset_points
          WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
        [phewbOrgId],
      );
      if (!eskomPoint.rows[0] || !phewbPoint.rows[0]) {
        throw new Error("F3.1b Task 5: ESKOM/PHEWB asset_points not found — run pnpm db:seed");
      }
      legitEskomPointId = eskomPoint.rows[0].id;
      legitEskomAssetId = eskomPoint.rows[0].asset_id;
      legitEskomPointKey = eskomPoint.rows[0].point_key;
      phewbPointId = phewbPoint.rows[0].id;
      phewbAssetId = phewbPoint.rows[0].asset_id;
      phewbPointKey = phewbPoint.rows[0].point_key;

      // The ESKOM dashboard + widget: ordinary rows, correctly scoped, via SET ROLE-equivalent
      // superuser insert for simplicity — RLS has nothing to say about a same-org row.
      const dashboard = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.dashboards (organization_id, slug, name)
         VALUES ($1, $2, 'F3.1b Task 5 point-scope guard fixture')
         RETURNING id`,
        [eskomOrgId, `f31b-t5-${RUN}`],
      );
      dashboardId = dashboard.rows[0]?.id ?? "";
      const widget = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.dashboard_widgets
           (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config)
         VALUES ($1, $2, 'value_tile', 0, 0, 3, 2, '{}'::jsonb)
         RETURNING id`,
        [eskomOrgId, dashboardId],
      );
      widgetId = widget.rows[0]?.id ?? "";
      if (!dashboardId || !widgetId) {
        throw new Error("F3.1b Task 5: fixture dashboard/widget did not insert");
      }

      // The legitimate binding — same organization, would pass the normal write path too.
      await superuserPool.query(
        `INSERT INTO bms.dashboard_widget_points (organization_id, widget_id, point_id, role, sort_order)
         VALUES ($1, $2, $3, 'primary', 0)`,
        [eskomOrgId, widgetId, legitEskomPointId],
      );

      // THE MANUFACTURED CROSS-ORGANIZATION ROW — the whole point of this file. An
      // ESKOM-stamped dashboard_widget_points row genuinely holding a PHEWB point_id. Only a
      // real Postgres superuser bypasses the WITH CHECK that would otherwise refuse this.
      await superuserPool.query(
        `INSERT INTO bms.dashboard_widget_points (organization_id, widget_id, point_id, role, sort_order)
         VALUES ($1, $2, $3, 'series', 99)`,
        [eskomOrgId, widgetId, phewbPointId],
      );
    }, 60_000);

    afterAll(async () => {
      if (dashboardId) {
        await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = $1`, [dashboardId]);
      }
      await Promise.all(
        [superuserPool, ownerPool, tenantPool].filter(Boolean).map((p) => p.end()),
      );
    }, 60_000);

    it("the manufactured cross-organization binding genuinely exists on disk", async () => {
      await assertCrossOrgBindingWasWritten(fleetDb, widgetId, phewbPointId);
    });

    it("tenant pool: the foreign binding is excluded, the legitimate one still resolves", async () => {
      await assertTenantPoolExcludesForeignBinding(
        tenantDb,
        eskomOrgId,
        widgetId,
        legitEskomPointId,
        phewbAssetId,
        phewbPointKey,
      );
    });

    it("fleet pool (BYPASSRLS): the explicit predicate excludes the foreign binding", async () => {
      await assertFleetPoolExcludesForeignBinding(
        fleetDb,
        eskomOrgId,
        widgetId,
        legitEskomPointId,
        phewbAssetId,
        phewbPointKey,
      );
    });

    it("the legitimate binding resolves correctly on both pools", async () => {
      await assertLegitimateBindingResolvesOnBothPools(
        tenantDb,
        fleetDb,
        eskomOrgId,
        widgetId,
        legitEskomPointId,
        legitEskomAssetId,
        legitEskomPointKey,
      );
    });

    it("write direction: a foreign pointId is refused (naming no id); a same-org one is accepted", async () => {
      await assertWriteGuardRefusesForeignPointOnly(tenantDb, eskomOrgId, legitEskomPointId, phewbPointId);
    });
  },
);
