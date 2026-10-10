import { expect } from "vitest";

import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { putDashboardWidgetsBodySchema } from "@bms/shared";
import type { DashboardsService } from "./dashboards.service";

/**
 * `F3.32` U3 — the running-DB half of the vocabulary gate (ADR 0079 decision 4). A new sibling
 * file, not an addition to `dashboards.service.rls.integration.spec.ts`/`.test.ts` — those two
 * are already close to the repo's 1000-line cap (§4.5), and this unit's own dispatch says to
 * split here rather than push them over it. Assertions live here; `dashboards.service.mimic.test.ts`
 * is the Vitest entry point (ADR 0014) and owns the database lifecycle.
 */

/**
 * **The positive half of the guard.** `dashboards.service.spec.ts`'s `runMimicScopeGuardTests`
 * already proves the fake-db case — a mimic widget is refused before any transaction opens on a
 * group-less dashboard. This is the other side: on a dashboard that DOES carry an asset group,
 * the same `putWidgets` call must actually save the widget and the read-back DTO — and a
 * SEPARATE fleet-connection read — must show it, with its `config` intact.
 */
export async function assertMimicWidgetSavesAndReadsBackOnAGroupDashboard(
  service: DashboardsService,
  fleetDb: BmsDb,
  actor: JwtPayload,
  groupDashboardId: string,
): Promise<void> {
  const after = await service.putWidgets(
    actor,
    groupDashboardId,
    putDashboardWidgetsBodySchema.parse({
      widgets: [
        {
          widgetType: "mimic",
          title: "Water train",
          gridX: 0,
          gridY: 0,
          gridW: 12,
          gridH: 6,
          config: { source: "preset", preset: "water_train" },
          points: [],
        },
      ],
    }),
  );

  expect(after.widgets.length, "a mimic widget on a group dashboard must save").toBe(1);
  expect(after.widgets[0]?.widgetType).toBe("mimic");
  expect(
    after.widgets[0]?.config,
    "the preset config must round-trip through the write and the read-back DTO unchanged",
  ).toEqual({ source: "preset", preset: "water_train" });

  const onFleet = await fleetDb.execute(
    sql`SELECT widget_type, config FROM bms.dashboard_widgets WHERE dashboard_id = ${groupDashboardId}`,
  );
  expect(
    onFleet.rows.length,
    "a separate fleet-connection read must also see exactly one widget row — proves the write committed",
  ).toBe(1);
  expect((onFleet.rows[0] as { widget_type: string }).widget_type).toBe("mimic");
}
