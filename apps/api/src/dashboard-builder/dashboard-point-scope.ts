import { BadRequestException } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import { assetPoints, assets, dashboardWidgetPoints } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";

/**
 * `F3.1b` Task 5 — the bound-point organization guard.
 *
 * **The rule.** ADR 0043 decision 9 makes `telemetry.*` an RLS exception. The tenant check
 * `dashboard_widget_points`'s own policy performs on the BINDING (that the point belongs to
 * this organization, at write time) does not carry over to the READING done here. `F3.1b`
 * Task 1 widened the point-binding DTO to carry `assetId`/`pointKey` — precisely what a caller
 * turns into a `GET /telemetry/points/:pointRef/recent` read one HTTP call later. A foreign
 * `assetId` leaving this module is therefore a cross-tenant telemetry read waiting to happen,
 * not merely a cosmetic leak.
 *
 * **Do not rely on RLS to supply the organization filter — write it explicitly, always.** On
 * the `fleetDb` branch of `withReadScope` (an `admin`/multi-organization read) the pool role is
 * `bms_fleet`, which holds `BYPASSRLS`, so `asset_points`' own `tenant_isolation` policy
 * filters NOTHING on that connection: the predicate below is the ONLY control there. Under
 * `bms_tenant` the policy happens to mask the predicate's absence, which is what makes it look
 * "redundant" to a reader testing only the tenant path — it is not. See
 * `dashboard-point-scope.integration.spec.ts` for the test that only fails when this predicate
 * is deleted (the fleet-pool one), and the docblock there for why the tenant-pool test alone
 * cannot prove this file does anything.
 */

/** One point binding, resolved to the asset/point identity `DashboardWidgetPointDto` needs. */
export type ResolvedBoundPoint = {
  readonly id: string;
  readonly widgetId: string;
  readonly pointId: string;
  readonly role: string;
  readonly sortOrder: number;
  readonly assetId: string;
  readonly pointKey: string;
  readonly unit: string | null;
};

/**
 * Resolves every point binding for the given widget ids, joined to the point and asset that
 * own it — with an EXPLICIT organization predicate on both legs of the join. See the file
 * docblock for why this cannot be left to RLS.
 */
export async function resolveBoundPoints(
  tx: BmsTx | BmsDb,
  organizationId: string,
  widgetIds: readonly string[],
): Promise<ResolvedBoundPoint[]> {
  if (widgetIds.length === 0) {
    return [];
  }
  return tx
    .select({
      id: dashboardWidgetPoints.id,
      widgetId: dashboardWidgetPoints.widgetId,
      pointId: dashboardWidgetPoints.pointId,
      role: dashboardWidgetPoints.role,
      sortOrder: dashboardWidgetPoints.sortOrder,
      assetId: assetPoints.assetId,
      pointKey: assetPoints.pointKey,
      unit: assetPoints.unit,
    })
    .from(dashboardWidgetPoints)
    .innerJoin(assetPoints, eq(dashboardWidgetPoints.pointId, assetPoints.id))
    .innerJoin(assets, eq(assetPoints.assetId, assets.id))
    .where(
      and(
        inArray(dashboardWidgetPoints.widgetId, [...widgetIds]),
        // EXPLICIT, not delegated to RLS — see the file docblock. Both legs: the point's own
        // organization_id, and (belt and suspenders) the asset it resolves to.
        eq(assetPoints.organizationId, organizationId),
        eq(assets.organizationId, organizationId),
      ),
    )
    .orderBy(asc(dashboardWidgetPoints.sortOrder));
}

/**
 * Write side: refuses any submitted `pointId` outside the caller's organization, before any
 * insert. Call inside the `PUT :id/widgets` transaction, before any widget/point row is
 * written.
 *
 * One query, and it never echoes a foreign point id back (§9.6) — only how many were outside.
 */
export async function assertBoundPointsInOrganization(
  tx: BmsTx,
  organizationId: string,
  pointIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(pointIds)];
  if (unique.length === 0) {
    return;
  }
  const rows = await tx
    .select({ id: assetPoints.id })
    .from(assetPoints)
    .where(and(inArray(assetPoints.id, unique), eq(assetPoints.organizationId, organizationId)));
  const found = new Set(rows.map((row) => row.id));
  const outsideCount = unique.filter((id) => !found.has(id)).length;
  if (outsideCount > 0) {
    throw new BadRequestException(
      `${outsideCount} of the submitted point binding(s) are outside this dashboard's organization`,
    );
  }
}
