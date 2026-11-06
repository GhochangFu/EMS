import { expect } from "vitest";

import { putDashboardWidgetsBodySchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import {
  clearOrganizationView,
  newOrganizationWideDashboard,
  pointOrganizationAt,
  type OrganizationLayoutFixture,
} from "../testing/organization-layout-harness";
import { DashboardsService } from "./dashboards.service";

/**
 * `F4.317` task 4.3 (ADR 0112 decision 5) — the narrow `location_admin` grant on the ONE
 * organization-wide dashboard an organization's view row points at, beside `F3.1d`
 * (`dashboards.service.rls.integration.spec.ts`, the organization-wide refusal it must not widen).
 * The grant admits widget edits and a rename; never a re-home, never a delete, never another
 * organization-wide dashboard, never an asset-group admin. Assertions only; the wrapper owns the
 * harness (ADR 0014).
 */

export type GrantCtx = { fx: OrganizationLayoutFixture; pointed: string; other: string };

/** A pointed and an unpointed organization-wide dashboard in A; A's row points at the first. */
export async function stagePointedDashboard(fx: OrganizationLayoutFixture): Promise<GrantCtx> {
  const pointed = await newOrganizationWideDashboard(fx, fx.orgA, "grant-pointed");
  const other = await newOrganizationWideDashboard(fx, fx.orgA, "grant-other");
  await pointOrganizationAt(fx, fx.orgA, pointed);
  return { fx, pointed, other };
}

export async function unstage(ctx: GrantCtx): Promise<void> {
  await clearOrganizationView(ctx.fx, ctx.fx.orgA);
}

function serviceOf(fx: OrganizationLayoutFixture): DashboardsService {
  return new DashboardsService(fx.tenantDb, fx.fleetDb, fx.accessControl, fx.audit);
}

const oneTile = putDashboardWidgetsBodySchema.parse({
  widgets: [
    {
      widgetType: "value_tile",
      title: "Open alarms",
      gridX: 0,
      gridY: 0,
      gridW: 3,
      gridH: 2,
      config: {},
      points: [],
      sources: [{ catalogKey: "alarms.active.count", params: {} }],
    },
  ],
});

async function statusOf(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return (err as { getStatus?: () => number }).getStatus?.() ?? -1;
  }
}

async function scopeOf(ctx: GrantCtx, id: string): Promise<unknown> {
  const { rows } = await ctx.fx.superuserPool.query(
    `SELECT name, location_id, asset_group_id, asset_id FROM bms.dashboards WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/** The location admin of A edits the pointed dashboard's widgets. */
export async function assertWidgetsOnThePointedDashboard(ctx: GrantCtx): Promise<void> {
  const dto = await serviceOf(ctx.fx).putWidgets(ctx.fx.jwt.locAdminA, ctx.pointed, oneTile);
  expect(dto.widgets.map((w) => w.title)).toEqual(["Open alarms"]);
}

/** `F3.1d` kept: another organization-wide dashboard of A is still a 404 for the location admin. */
export async function assertAnotherOrganizationWideDashboardIsRefused(ctx: GrantCtx): Promise<void> {
  const svc = serviceOf(ctx.fx);
  expect(await statusOf(svc.putWidgets(ctx.fx.jwt.locAdminA, ctx.other, oneTile))).toBe(404);
  expect(await statusOf(svc.update(ctx.fx.jwt.locAdminA, ctx.other, { name: "renamed" }))).toBe(404);
}

/** The `F3.1d` twin: re-homing the pointed dashboard under the admin's own site is a 404, unwritten. */
export async function assertReHomingThePointedDashboardIsRefused(ctx: GrantCtx): Promise<void> {
  const before = await scopeOf(ctx, ctx.pointed);
  const status = await statusOf(serviceOf(ctx.fx).update(ctx.fx.jwt.locAdminA, ctx.pointed, { locationId: ctx.fx.locA1 }));
  expect(status).toBe(404);
  expect(await scopeOf(ctx, ctx.pointed)).toEqual(before);
}

/** A rename keeps the scope, so the grant admits it. */
export async function assertRenamingThePointedDashboard(ctx: GrantCtx): Promise<void> {
  const dto = await serviceOf(ctx.fx).update(ctx.fx.jwt.locAdminA, ctx.pointed, { name: "Organization strip (edited)" });
  expect(dto.name).toBe("Organization strip (edited)");
  expect(dto.locationId).toBeNull();
}

/** Delete is not granted: the location admin cannot remove the pointed dashboard. */
export async function assertDeletingThePointedDashboardIsRefused(ctx: GrantCtx): Promise<void> {
  expect(await statusOf(serviceOf(ctx.fx).remove(ctx.fx.jwt.locAdminA, ctx.pointed))).toBe(404);
  expect(await scopeOf(ctx, ctx.pointed)).toBeDefined();
}

/** An asset-group admin of A, and a location admin of B, are refused on the pointed dashboard. */
export async function assertOtherRolesAreRefused(ctx: GrantCtx): Promise<void> {
  const svc = serviceOf(ctx.fx);
  const refused: [string, JwtPayload][] = [
    ["asset_group_admin of A", ctx.fx.jwt.groupAdminA],
    ["location_admin of B", ctx.fx.jwt.locAdminB],
  ];
  for (const [who, jwt] of refused) {
    expect({ who, status: await statusOf(svc.putWidgets(jwt, ctx.pointed, oneTile)) }).toEqual({ who, status: 404 });
    expect({ who, status: await statusOf(svc.update(jwt, ctx.pointed, { name: "x" })) }).toEqual({ who, status: 404 });
  }
}

/** Once the row no longer points at it (Reset), the dashboard is an ordinary organization-wide one again. */
export async function assertTheGrantEndsWithThePointer(ctx: GrantCtx): Promise<void> {
  await clearOrganizationView(ctx.fx, ctx.fx.orgA);
  expect(await statusOf(serviceOf(ctx.fx).putWidgets(ctx.fx.jwt.locAdminA, ctx.pointed, oneTile))).toBe(404);
  await pointOrganizationAt(ctx.fx, ctx.fx.orgA, ctx.pointed);
}
