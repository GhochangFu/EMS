import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertCrossOrgSourceWasWritten,
  assertEmptyWidgetListSkipsTheQuery,
  assertFleetPoolExcludesForeignSource,
  assertLegitimateSourceResolvesOnBothPools,
  assertTenantPoolExcludesForeignSource,
} from "./dashboard-source-scope.integration.spec";

/**
 * `F3.35` Stage C — Vitest entry point for the catalog-binding organization guard. Assertions
 * live in the sibling `.spec` (ADR 0014); this file owns the database lifecycle and the fixture.
 *
 * **The fixture is manufactured through the "superuser" role url (`bms_app`), not `bms_fleet`.**
 * A genuine Postgres superuser bypasses row security entirely regardless of `FORCE`, so the
 * PHEWB-stamped INSERT below lands even though migration `0054`'s `WITH CHECK` refuses exactly
 * that write on every other role — a refusal `tests/f3.35-metric-catalog-schema.integration.test.ts`
 * already proves in the other direction. Do NOT "simplify" this to `bms_fleet` or route it
 * through `DashboardsService.putWidgets`: either would fail to construct the fixture, and the
 * fixture is the entire point.
 *
 * **Why PHEWB-stamped on an ESKOM widget, rather than the point file's shape.** That file
 * manufactures an ESKOM-stamped row holding a PHEWB `point_id`, because the leak there travels
 * through a JOIN. This table has no join — a catalog key references nothing — so the row's own
 * `organization_id` is the only column that can be wrong, and a foreign stamp is the only
 * fixture that exercises the predicate.
 */
const connectionString = requireIntegrationDb({
  item: "F3.35",
  label: "the dashboard-source-scope organization guard (Stage C, Unit 3)",
  because:
    "whether a foreign organization's catalog binding can leave resolveWidgetSources on the " +
    "BYPASSRLS fleet pool is a fact about a real connection and a real policy — a fake db " +
    "proves nothing about either, and this suite exists for the one assertion that fails only " +
    "when the explicit organization predicate is missing.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)(
  "F3.35 Stage C — dashboard-source-scope: the catalog-binding organization guard",
  () => {
    let superuserPool: pg.Pool;
    let fleetPool: pg.Pool;
    let tenantPool: pg.Pool;
    let fleetDb: BmsDb;
    let tenantDb: BmsDb;

    let eskomOrgId = "";
    let phewbOrgId = "";
    let dashboardId = "";
    let widgetId = "";

    beforeAll(async () => {
      const url = connectionString as string;

      // `max: 1` on all three, deliberately. `openIntegrationPool` defaults to 4, and the repo
      // opens ~119 pools across 58 integration files against a `max_connections` of 100 — so
      // the suite already runs at the ceiling, and a parallel run sheds whichever file loses the
      // race with a `connectionTimeoutMillis` of 5000. Measured: adding this file at the default
      // made three unrelated integration suites fail at ~5030 ms, and a different three on the
      // next run. One connection is enough here because every query in this file is awaited in
      // sequence and nothing provokes a deliberate error — `pg-pool` DESTROYS a client whose
      // query throws, which is what makes `max: 1` unsafe in a suite that tests refusals
      // (`tests/f3.35-metric-catalog-schema.integration.test.ts` holds a client for exactly that
      // reason). This one tests reads.
      const POOL = { max: 1 } as const;

      superuserPool = await openIntegrationPool(
        resolveIntegrationRoleUrl(url, "superuser", process.env),
        "F3.35 Unit 3",
        POOL,
      );
      // NOT an owner pool, whatever `dashboard-point-scope.integration.test.ts` calls its
      // equivalent variable: `requireIntegrationDb` defaults to `connection: "fleet"`, so this
      // url is `bms_fleet` — the BYPASSRLS role this file exists to test against. Verified on
      // the running stack: `bms_owner` is NOBYPASSRLS and sees zero rows with no GUC set, so a
      // genuine owner pool would fail the "legitimate binding still resolves" half below.
      fleetPool = await openIntegrationPool(url, "F3.35 Unit 3", POOL);
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F3.35 Unit 3",
        POOL,
      );
      fleetDb = createDb(fleetPool);
      tenantDb = createDb(tenantPool);

      const eskom = await fleetPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
      );
      const phewb = await fleetPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'PHEWB' LIMIT 1`,
      );
      eskomOrgId = eskom.rows[0]?.id ?? "";
      phewbOrgId = phewb.rows[0]?.id ?? "";
      if (!eskomOrgId || !phewbOrgId) {
        throw new Error("F3.35 Unit 3: ESKOM/PHEWB organizations not found — run pnpm db:seed");
      }

      const dashboard = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.dashboards (organization_id, slug, name)
         VALUES ($1, $2, 'F3.35 Unit 3 source-scope guard fixture')
         RETURNING id`,
        [eskomOrgId, `f335-u3-${RUN}`],
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
        throw new Error("F3.35 Unit 3: fixture dashboard/widget did not insert");
      }

      // The legitimate binding — same organization, would pass the normal write path too.
      await superuserPool.query(
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key, sort_order)
         VALUES ($1, $2, 'alarms.active.count', 0)`,
        [eskomOrgId, widgetId],
      );

      // THE MANUFACTURED CROSS-ORGANIZATION ROW — the whole point of this file. A PHEWB-stamped
      // binding genuinely sitting on an ESKOM widget. Only a real Postgres superuser bypasses
      // the WITH CHECK that refuses this on every other role.
      await superuserPool.query(
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key, sort_order)
         VALUES ($1, $2, 'workorders.open.count', 99)`,
        [phewbOrgId, widgetId],
      );
    }, 60_000);

    afterAll(async () => {
      if (dashboardId) {
        // One delete: `dashboard_widgets` cascades from `dashboards`, and
        // `dashboard_widget_sources` cascades from the widget.
        await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = $1`, [dashboardId]);
      }
      await Promise.all([superuserPool, fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
    }, 60_000);

    it("the manufactured cross-organization binding genuinely exists on disk", async () => {
      await assertCrossOrgSourceWasWritten(fleetDb, widgetId, phewbOrgId);
    });

    it("tenant pool: the foreign binding is excluded, the legitimate one still resolves", async () => {
      await assertTenantPoolExcludesForeignSource(tenantDb, eskomOrgId, widgetId);
    });

    it("fleet pool (BYPASSRLS): the explicit predicate excludes the foreign binding", async () => {
      await assertFleetPoolExcludesForeignSource(fleetDb, eskomOrgId, widgetId);
    });

    it("the legitimate binding resolves correctly on both pools", async () => {
      await assertLegitimateSourceResolvesOnBothPools(tenantDb, fleetDb, eskomOrgId, widgetId);
    });

    it("an empty widget-id list returns without querying", async () => {
      await assertEmptyWidgetListSkipsTheQuery(fleetDb, eskomOrgId);
    });
  },
);
