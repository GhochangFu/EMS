import { sql } from "drizzle-orm";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { withTenant } from "../database/tenant-context";
import { resolveWidgetSources } from "./dashboard-source-scope";

/**
 * `F3.35` Stage C — assertions for the catalog-binding organization guard. The sibling
 * `.integration.test.ts` owns the database lifecycle and the fixture (ADR 0014).
 *
 * **The leak this file is about is narrower than the point side's, and the mechanism is
 * identical.** `bms.dashboard_widget_sources` has no join: a catalog key is a foreign key to
 * nothing, so the row's own `organization_id` is the only column that can say whose binding it
 * is. On the `bms_fleet` pool that column is checked by nothing — `packages/db/src/roles.ts:77`
 * gives that role `BYPASSRLS`, so `tenant_isolation` is inert there however forced it is. The
 * `eq(dashboardWidgetSources.organizationId, organizationId)` in `resolveWidgetSources` is the
 * only control, and the fleet assertion below is the only test that fails when it is deleted.
 *
 * What escapes is *which catalog entries another organization's widget binds* — configuration,
 * not telemetry, where the point side's equivalent leak hands out an `assetId` a caller turns
 * into a cross-tenant telemetry read. Smaller, still another tenant's dashboard, and the fix is
 * one `eq`.
 */

/**
 * The fixture is real: a PHEWB-stamped binding genuinely sits on an ESKOM widget, on disk.
 *
 * Asserted first and separately, because every exclusion assertion below passes trivially if the
 * row was never written — and a `WITH CHECK` refusal during setup would leave exactly that
 * state. `sql.raw` through the fleet pool, which sees the row whatever its stamp.
 */
export async function assertCrossOrgSourceWasWritten(
  fleetDb: BmsDb,
  widgetId: string,
  phewbOrgId: string,
): Promise<void> {
  const rows = await fleetDb.execute(
    sql`SELECT organization_id, catalog_key FROM bms.dashboard_widget_sources
        WHERE widget_id = ${widgetId} AND organization_id = ${phewbOrgId}`,
  );
  expect(
    rows.rows.length,
    "the manufactured cross-organization catalog binding must exist, or every exclusion " +
      "assertion below passes over an empty table and proves nothing",
  ).toBe(1);
}

/**
 * Tenant pool: the policy alone already excludes it.
 *
 * This assertion passes with or without the explicit predicate, and that is worth stating rather
 * than leaving for a reader to discover — `dashboard-point-scope.integration.spec.ts` records
 * the same asymmetry. Under `bms_tenant` the policy masks the predicate's absence, which is
 * precisely what makes the predicate look redundant to anyone who tests only this path.
 */
export async function assertTenantPoolExcludesForeignSource(
  tenantDb: BmsDb,
  eskomOrgId: string,
  widgetId: string,
): Promise<void> {
  const resolved = await withTenant(tenantDb, eskomOrgId, (tx) =>
    resolveWidgetSources(tx, eskomOrgId, [widgetId]),
  );
  expect(
    resolved.every((source) => source.catalogKey !== "workorders.open.count"),
    "the PHEWB-stamped binding must not resolve on the tenant pool",
  ).toBe(true);
  expect(
    resolved.some((source) => source.catalogKey === "alarms.active.count"),
    "the legitimate ESKOM binding must still resolve on the tenant pool",
  ).toBe(true);
}

/**
 * **Fleet pool — the one assertion that fails when the explicit predicate is dropped, and the
 * only one that does.** `bms_fleet` holds `BYPASSRLS`, so `dashboard_widget_sources`' own
 * `tenant_isolation` policy filters nothing on this connection.
 */
export async function assertFleetPoolExcludesForeignSource(
  fleetDb: BmsDb,
  eskomOrgId: string,
  widgetId: string,
): Promise<void> {
  const resolved = await resolveWidgetSources(fleetDb, eskomOrgId, [widgetId]);
  expect(
    resolved.every((source) => source.catalogKey !== "workorders.open.count"),
    "on the BYPASSRLS fleet pool, no PHEWB-stamped binding may appear — the explicit " +
      "organization predicate in resolveWidgetSources is the only thing excluding it",
  ).toBe(true);
  expect(
    resolved.some((source) => source.catalogKey === "alarms.active.count"),
    "the legitimate ESKOM binding must still resolve on the fleet pool",
  ).toBe(true);
}

/**
 * Both directions. That the boundary holds is half of it; a predicate that excluded everything
 * would pass every assertion above.
 */
export async function assertLegitimateSourceResolvesOnBothPools(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  eskomOrgId: string,
  widgetId: string,
): Promise<void> {
  const onTenant = await withTenant(tenantDb, eskomOrgId, (tx) =>
    resolveWidgetSources(tx, eskomOrgId, [widgetId]),
  );
  const onFleet = await resolveWidgetSources(fleetDb, eskomOrgId, [widgetId]);

  for (const [label, resolved] of [
    ["tenant", onTenant],
    ["fleet", onFleet],
  ] as const) {
    const hit = resolved.find((source) => source.catalogKey === "alarms.active.count");
    expect(hit, `the legitimate binding must resolve on the ${label} pool`).toBeDefined();
    expect(hit?.widgetId).toBe(widgetId);
    expect(hit?.sortOrder).toBe(0);
    // `params` survives the round trip as an object, which is what
    // `dashboard_widget_sources_params_object_check` guarantees and what the record parse needs.
    expect(typeof hit?.params, "params must come back as an object").toBe("object");
  }
}

/** An empty widget-id list short-circuits without a query — the same contract `resolveBoundPoints`
 * keeps, and what lets `loadFullDto` call it unconditionally on a dashboard with no widgets. */
export async function assertEmptyWidgetListSkipsTheQuery(
  fleetDb: BmsDb,
  eskomOrgId: string,
): Promise<void> {
  expect(await resolveWidgetSources(fleetDb, eskomOrgId, [])).toEqual([]);
}
