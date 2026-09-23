import { BadRequestException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { DashboardTemplatesService } from "../admin/dashboard-templates/dashboard-templates.service";
import { putDashboardWidgetsBodySchema } from "./dashboards.schema";
import type { DashboardsService } from "./dashboards.service";

/**
 * `E4.2` U3 — the point-key check at the binding write, against a real `bms.point_keys`
 * (ADR 0072 decision 2). Assertions live here; the sibling `.integration.test.ts` owns the
 * database lifecycle and the per-run rows. One exported function per claim.
 */

/** One `sustainability.total` tile binding — exported so the entry point's setup stores the same shape. */
export const tileBinding = (pointKey: string, balanceRole?: string) =>
  putDashboardWidgetsBodySchema.parse({
    widgets: [
      {
        widgetType: "value_tile",
        title: "E4.2 U3",
        gridX: 0,
        gridY: 0,
        gridW: 3,
        gridH: 2,
        config: {},
        points: [],
        sources: [
          {
            catalogKey: "sustainability.total",
            params: {
              pointKey,
              aggregate: "sum",
              ...(balanceRole === undefined ? {} : { balanceRole }),
            },
          },
        ],
      },
    ],
  });

async function refusal(run: () => Promise<unknown>): Promise<BadRequestException> {
  try {
    await run();
  } catch (err) {
    if (err instanceof BadRequestException) return err;
    throw err;
  }
  throw new Error("expected a BadRequestException, got success");
}

/** An unknown code is a 400 that names it. */
export async function unknownCodeIs400NamingIt(
  service: DashboardsService,
  actor: JwtPayload,
  dashboardId: string,
  unknownCode: string,
): Promise<void> {
  const err = await refusal(() => service.putWidgets(actor, dashboardId, tileBinding(unknownCode)));
  expect(err.message).toBe(`Not in the active point-key catalog: ${unknownCode}`);
}

/** A catalog row with `active = false` is refused exactly as an absent one — the rule is ACTIVE. */
export async function inactiveCodeIs400(
  service: DashboardsService,
  actor: JwtPayload,
  dashboardId: string,
  inactiveCode: string,
): Promise<void> {
  const err = await refusal(() => service.putWidgets(actor, dashboardId, tileBinding(inactiveCode)));
  expect(err.message).toBe(`Not in the active point-key catalog: ${inactiveCode}`);
}

/** A seeded active code stores, and the stored `params` carry it (the positive control). */
export async function seededCodeStoresItsParams(
  service: DashboardsService,
  fleetDb: BmsDb,
  actor: JwtPayload,
  dashboardId: string,
): Promise<void> {
  const dto = await service.putWidgets(actor, dashboardId, tileBinding("kl_today"));
  expect(dto.widgets[0]?.sources[0]?.params).toEqual({ pointKey: "kl_today", aggregate: "sum" });

  // A separate fleet-connection read, so the claim is about the committed row, not the DTO.
  const stored = await fleetDb.execute<{ params: unknown }>(
    sql`SELECT s.params FROM bms.dashboard_widget_sources s
          JOIN bms.dashboard_widgets w ON w.id = s.widget_id
         WHERE w.dashboard_id = ${dashboardId}`,
  );
  expect(stored.rows).toHaveLength(1);
  expect(stored.rows[0]?.params).toEqual({ pointKey: "kl_today", aggregate: "sum" });
}

/** A draft whose one source names `pointKey: "nope"` refuses to publish with the same sentence. */
export async function draftWithUnknownCodeRefusesToPublish(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  draftId: string,
  unknownCode: string,
): Promise<void> {
  const err = await refusal(() => templates.publish(actor, draftId));
  expect(err.message).toBe(`Not in the active point-key catalog: ${unknownCode}`);
}

/** The same draft shape with `kl_today` publishes (the control for the refusal above). */
export async function draftWithSeededCodePublishes(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  draftId: string,
): Promise<void> {
  const dto = await templates.publish(actor, draftId);
  expect(dto.status).toBe("published");
}

// ---------------------------------------------------------------------------
// `E4.3` / ADR 0073 decision 2 — `balanceRole` verified against `bms.water_balance_roles` at the
// same two writes. Every refusal below binds the seeded `kl_today`, so the point-key guard
// cannot be the one that fired: the sentence asserted is the role check's own.
// ---------------------------------------------------------------------------

/** An unknown role is a 400 naming it. */
export async function unknownBalanceRoleIs400NamingIt(
  service: DashboardsService,
  actor: JwtPayload,
  dashboardId: string,
): Promise<void> {
  const err = await refusal(() =>
    service.putWidgets(actor, dashboardId, tileBinding("kl_today", "nope")),
  );
  expect(err.message).toBe("Not a live water balance role: nope");
}

/** A role row with `active = false` is refused exactly as an absent one. */
export async function inactiveBalanceRoleIs400(
  service: DashboardsService,
  actor: JwtPayload,
  dashboardId: string,
  inactiveRole: string,
): Promise<void> {
  const err = await refusal(() =>
    service.putWidgets(actor, dashboardId, tileBinding("kl_today", inactiveRole)),
  );
  expect(err.message).toBe(`Not a live water balance role: ${inactiveRole}`);
}

/** A seeded role stores, and the stored `params` carry it (the positive control). */
export async function seededBalanceRoleStoresItsParams(
  service: DashboardsService,
  actor: JwtPayload,
  dashboardId: string,
): Promise<void> {
  const dto = await service.putWidgets(actor, dashboardId, tileBinding("kl_today", "intake"));
  expect(dto.widgets[0]?.sources[0]?.params).toEqual({
    pointKey: "kl_today",
    aggregate: "sum",
    balanceRole: "intake",
  });
}

/** A draft whose one source names `balanceRole: "nope"` refuses to publish with the same sentence. */
export async function draftWithUnknownBalanceRoleRefusesToPublish(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  draftId: string,
): Promise<void> {
  const err = await refusal(() => templates.publish(actor, draftId));
  expect(err.message).toBe("Not a live water balance role: nope");
}

// ---------------------------------------------------------------------------
// Post-merge sweep M1 — a re-save re-sends the stored params verbatim (the web builder has no
// params editor), so a value the dashboard ALREADY carries is not re-checked: the `C1` rule of
// `AssetsService.update`. A value that is new or changed is still checked against live rows.
// The controls (`unknownCodeIs400NamingIt`, `unknownBalanceRoleIs400NamingIt` and the change
// below) run on dashboards that carry stored sources, so they prove the subtraction removes only
// the stored values, not every check once anything is stored.
// ---------------------------------------------------------------------------

/** Re-sending a stored `balanceRole` whose vocabulary row was retired since stores (200). */
export async function resaveOfStoredRetiredBalanceRoleStores(
  service: DashboardsService,
  actor: JwtPayload,
  dashboardId: string,
  retiredRole: string,
): Promise<void> {
  const dto = await service.putWidgets(actor, dashboardId, tileBinding("kl_today", retiredRole));
  expect(dto.widgets[0]?.sources[0]?.params).toEqual({
    pointKey: "kl_today",
    aggregate: "sum",
    balanceRole: retiredRole,
  });
}

/** Re-sending a stored `pointKey` whose catalog row was retired since stores (200). */
export async function resaveOfStoredRetiredPointKeyStores(
  service: DashboardsService,
  actor: JwtPayload,
  dashboardId: string,
  retiredKey: string,
): Promise<void> {
  const dto = await service.putWidgets(actor, dashboardId, tileBinding(retiredKey));
  expect(dto.widgets[0]?.sources[0]?.params).toEqual({ pointKey: retiredKey, aggregate: "sum" });
}

/** Control: a CHANGE from a stored live role to a different inactive role is a 400. */
export async function changeFromStoredLiveRoleToInactiveRoleIs400(
  service: DashboardsService,
  actor: JwtPayload,
  dashboardId: string,
  inactiveRole: string,
): Promise<void> {
  const err = await refusal(() =>
    service.putWidgets(actor, dashboardId, tileBinding("kl_today", inactiveRole)),
  );
  expect(err.message).toBe(`Not a live water balance role: ${inactiveRole}`);
}

// ---------------------------------------------------------------------------
// Review F1 — the stored set is THIS dashboard's, and per field. A retired value another
// dashboard stores, or the same string stored under the other field, is still checked.
// ---------------------------------------------------------------------------

/** A retired role stored only by ANOTHER dashboard is a 400 here. */
export async function retiredRoleStoredOnlyElsewhereIs400(
  service: DashboardsService,
  actor: JwtPayload,
  dashboardId: string,
  retiredRole: string,
): Promise<void> {
  const err = await refusal(() =>
    service.putWidgets(actor, dashboardId, tileBinding("kl_today", retiredRole)),
  );
  expect(err.message).toBe(`Not a live water balance role: ${retiredRole}`);
}

/** A retired point key stored only by ANOTHER dashboard is a 400 here. */
export async function retiredPointKeyStoredOnlyElsewhereIs400(
  service: DashboardsService,
  actor: JwtPayload,
  dashboardId: string,
  retiredKey: string,
): Promise<void> {
  const err = await refusal(() => service.putWidgets(actor, dashboardId, tileBinding(retiredKey)));
  expect(err.message).toBe(`Not in the active point-key catalog: ${retiredKey}`);
}

/**
 * A retired point key whose string this dashboard stores only as a `balanceRole` is a 400: the
 * two stored sets are per field, never merged.
 */
export async function retiredPointKeyStoredOnlyAsARoleIs400(
  service: DashboardsService,
  actor: JwtPayload,
  dashboardId: string,
  retiredKey: string,
): Promise<void> {
  const err = await refusal(() => service.putWidgets(actor, dashboardId, tileBinding(retiredKey)));
  expect(err.message).toBe(`Not in the active point-key catalog: ${retiredKey}`);
}
