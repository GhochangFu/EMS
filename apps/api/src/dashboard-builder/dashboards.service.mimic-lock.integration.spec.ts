import { expect } from "vitest";

import type pg from "pg";

import type { JwtPayload } from "@bms/shared";

import { MIMIC_LAYOUT_ORG_MESSAGE, putDashboardWidgetsBodySchema } from "./dashboards.schema";
import type { DashboardsService } from "./dashboards.service";

/**
 * `F3.32c` U7 — a widget save and a layout delete cannot race. Assertions live here;
 * `dashboards.service.mimic-lock.integration.test.ts` is the Vitest entry point (ADR 0014) and
 * owns the pools, the fixtures and the cleanup.
 *
 * `MimicLayoutsService.remove` locks the layout `FOR UPDATE` before its in-use count, and
 * `assertMimicLayoutsInOrganization` reads the named layouts `FOR KEY SHARE`. The two locks
 * conflict, so whichever transaction takes its lock first finishes before the other reads.
 * `mimic-layouts.service.integration.spec.ts` C12 proves the save-first order; this file proves
 * the delete-first order.
 */

export type MimicLockCtx = {
  service: DashboardsService;
  /** Superuser pool: stands in for a delete in flight, and reads the rows behind the service. */
  superuserPool: pg.Pool;
  actor: JwtPayload;
  /** An ESKOM dashboard scoped to this run's asset group (a mimic needs a group). */
  dashboardId: string;
  /** A committed ESKOM layout this case deletes. */
  layoutId: string;
};

/**
 * A delete in flight holds the layout: the save waits for it, then finds no row and answers 400
 * `MIMIC_LAYOUT_ORG_MESSAGE` with no widget row. A plain read would see the layout's committed
 * version, pass the guard at once, and save a widget naming a layout that no longer exists.
 */
export async function assertSaveWaitsForAConcurrentDeleteThenRefuses(ctx: MimicLockCtx): Promise<void> {
  const body = putDashboardWidgetsBodySchema.parse({
    widgets: [
      {
        widgetType: "mimic",
        title: "Plant",
        gridX: 0,
        gridY: 0,
        gridW: 12,
        gridH: 6,
        config: { source: "layout", layoutId: ctx.layoutId },
        points: [],
      },
    ],
  });

  const client = await ctx.superuserPool.connect();
  let save: Promise<unknown> | undefined;
  try {
    await client.query("BEGIN");
    const held = await client.query(`SELECT id FROM bms.mimic_layouts WHERE id = $1 FOR UPDATE`, [ctx.layoutId]);
    expect(held.rows).toHaveLength(1);
    await client.query(`DELETE FROM bms.mimic_layouts WHERE id = $1`, [ctx.layoutId]);

    let settled = false;
    save = ctx.service.putWidgets(ctx.actor, ctx.dashboardId, body).then(
      (value) => {
        settled = true;
        return value;
      },
      (err: unknown) => {
        settled = true;
        return err;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled, "putWidgets() must wait for the delete that holds the layout").toBe(false);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  const outcome = await save;
  expect(outcome, "the save must refuse the deleted layout").toMatchObject({
    status: 400,
    message: MIMIC_LAYOUT_ORG_MESSAGE,
  });
  const rows = await ctx.superuserPool.query(`SELECT id FROM bms.dashboard_widgets WHERE dashboard_id = $1`, [
    ctx.dashboardId,
  ]);
  expect(rows.rows, "the refused save must write no widget row").toEqual([]);
}
