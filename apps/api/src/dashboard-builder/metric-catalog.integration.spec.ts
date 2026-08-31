import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import type { MetricCatalogService } from "./metric-catalog.service";

/**
 * `F3.35` Stage C — assertions for the catalog resolve. The sibling `.integration.test.ts` owns
 * the database lifecycle and the fixture (ADR 0014).
 *
 * **The scope narrowing is the reason this file exists, and it fails the way the Unit 3 diff
 * failed: silently, with a plausible answer.** A site-scoped dashboard whose tile binds
 * `alarms.active.count` and returns the ORGANIZATION's count throws nothing, logs nothing and
 * renders a number. An operator reads it as their site's. The first assertion below was written
 * failing, against a resolver that ignored `dashboards.location_id`.
 */

/** `alarms.active.count` narrowed to the dashboard's own location, not the organization's. */
export async function assertLocationScopeNarrowsTheCount(
  service: MetricCatalogService,
  organizationId: string,
  scopedDashboardId: string,
  wideDashboardId: string,
  // THE FIXTURE'S OWN ASSETS, passed as the caller's scope so both numbers are deterministic.
  // Reading the true organization-wide count would make this suite depend on the seed and on
  // whatever alarms a parallel suite happens to hold open (F4.66). Passing the fixture's assets
  // exercises the intersection as well, which is the property `assertCallerScopeIntersects`
  // isolates.
  callerScope: readonly string[],
  expectedAtLocation: number,
  expectedOrgWide: number,
): Promise<void> {
  const scoped = await service.resolveForDashboard(organizationId, scopedDashboardId, [
    ...callerScope,
  ]);
  const scopedValue = scoped.values[0]?.resolved;
  expect(scopedValue?.shape, "the binding must resolve as a metric").toBe("metric");
  expect(
    scopedValue?.shape === "metric" ? scopedValue.value : undefined,
    "a location-scoped dashboard must count its OWN location's alarms — an organization-wide " +
      "number here is wrong in a way nothing throws on, and an operator reads it as the site's",
  ).toBe(expectedAtLocation);

  // The other half, and it is not symmetry: a resolver that always returned the narrow count
  // would pass the assertion above. An organization-wide dashboard must still see everything.
  const wide = await service.resolveForDashboard(organizationId, wideDashboardId, [
    ...callerScope,
  ]);
  const wideValue = wide.values[0]?.resolved;
  expect(
    wideValue?.shape === "metric" ? wideValue.value : undefined,
    "an organization-wide dashboard must count everything the caller can read, across locations",
  ).toBe(expectedOrgWide);

  expect(
    expectedAtLocation < expectedOrgWide,
    "the fixture is pointless unless the two numbers differ — if they are equal, this suite " +
      "passes over a resolver that ignores scope entirely",
  ).toBe(true);
}

/** The caller's readable-asset scope INTERSECTS the dashboard's; it does not replace it. */
export async function assertCallerScopeIntersects(
  service: MetricCatalogService,
  organizationId: string,
  wideDashboardId: string,
  readableAssetIds: readonly string[],
  expectedForThatCaller: number,
): Promise<void> {
  const resolved = await service.resolveForDashboard(organizationId, wideDashboardId, [
    ...readableAssetIds,
  ]);
  const value = resolved.values[0]?.resolved;
  expect(
    value?.shape === "metric" ? value.value : undefined,
    "an organization-wide dashboard read by an asset-scoped caller must show only the assets " +
      "that caller can read — the dashboard's scope widens nothing",
  ).toBe(expectedForThatCaller);

  // An empty readable set is a real state (a user scoped to an asset group with no assets), and
  // `inArray(x, [])` is a Postgres syntax error rather than an empty result — the trap
  // `AssetHealthService.summary` records. Zero, not a 500.
  const none = await service.resolveForDashboard(organizationId, wideDashboardId, []);
  const noneValue = none.values[0]?.resolved;
  expect(
    noneValue?.shape === "metric" ? noneValue.value : undefined,
    "a caller who can read no assets must get 0, not a query error",
  ).toBe(0);
}

/** A dataset resolves to rows and the columns `METRIC_CATALOG` declares, clamped and flagged. */
export async function assertDatasetShapeAndClamp(
  service: MetricCatalogService,
  organizationId: string,
  datasetDashboardId: string,
  callerScope: readonly string[],
  declaredColumns: readonly string[],
): Promise<void> {
  const resolved = await service.resolveForDashboard(organizationId, datasetDashboardId, [
    ...callerScope,
  ]);
  const value = resolved.values[0]?.resolved;
  expect(value?.shape, "alarms.active must resolve as a dataset").toBe("dataset");
  if (value?.shape !== "dataset") return;

  // Every declared column, and nothing else. The resolve returns the full declared set and the
  // RENDERER projects (ADR 0048 decision 2) — so no column list travels in a request and no SQL
  // is built from one.
  expect([...value.columns].sort()).toEqual([...declaredColumns].sort());
  expect(value.rows.length, "the fixture's alarms must appear").toBeGreaterThan(0);
  for (const row of value.rows) {
    expect(
      Object.keys(row).sort(),
      "every row must carry exactly the declared columns, or the renderer projects on a key " +
        "that is present in some rows and absent in others",
    ).toEqual([...declaredColumns].sort());
  }
  expect(value.truncated, "the fixture is far below MAX_DATASET_ROWS").toBe(false);
}

/** `assets.health.score` delegates rather than reimplementing `E1.3`'s roll-up. */
export async function assertHealthScoreDelegates(
  service: MetricCatalogService,
  organizationId: string,
  healthDashboardId: string,
): Promise<void> {
  const resolved = await service.resolveForDashboard(organizationId, healthDashboardId, null);
  const value = resolved.values[0]?.resolved;
  expect(value?.shape).toBe("metric");
  if (value?.shape !== "metric") return;

  // NULL is the CORRECT answer against seeded data, and `F4.69` is why: no seeded asset carries
  // both telemetry and a published threshold rule, so `E1.3` scores nothing and its weighted
  // mean is null. Asserting "null or a number in 0..1" rather than a value keeps this suite
  // honest either side of `F4.69` landing — and asserting a NUMBER here would go red the day
  // the seed is fixed, which is backwards.
  expect(
    value.value === null || (value.value >= 0 && value.value <= 1),
    `health score must be null or within 0..1, got ${String(value.value)}`,
  ).toBe(true);
}

/** A binding whose widget is gone simply does not come back. */
export async function assertDeletedWidgetDropsItsBinding(
  service: MetricCatalogService,
  fleetDb: BmsDb,
  organizationId: string,
  dashboardId: string,
  widgetId: string,
): Promise<void> {
  const before = await service.resolveForDashboard(organizationId, dashboardId, null);
  expect(before.values.length).toBeGreaterThan(0);

  await fleetDb.execute(sql`DELETE FROM bms.dashboard_widgets WHERE id = ${widgetId}`);

  const after = await service.resolveForDashboard(organizationId, dashboardId, null);
  expect(
    after.values.some((entry) => entry.sourceId === before.values[0]?.sourceId),
    "a binding whose widget cascaded away must not resolve",
  ).toBe(false);
}

/** Nothing bound is an empty answer, not an error and not a query over every row. */
export async function assertNoBindingsResolvesEmpty(
  service: MetricCatalogService,
  organizationId: string,
  emptyDashboardId: string,
): Promise<void> {
  const resolved = await service.resolveForDashboard(organizationId, emptyDashboardId, null);
  expect(resolved.values).toEqual([]);
  expect(
    Number.isNaN(Date.parse(resolved.resolvedAt)),
    "resolvedAt must be a parseable ISO timestamp even when nothing resolved",
  ).toBe(false);
}

/** A per-run suffix so two instances of this suite cannot collide (F4.65). */
export const RUN_SUFFIX = (): string => randomUUID().replace(/-/g, "").slice(0, 8);
