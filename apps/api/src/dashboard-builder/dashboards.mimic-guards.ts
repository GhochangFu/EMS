import { BadRequestException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";

import { mimicLayouts } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";
import { MIMIC_LAYOUT_ORG_MESSAGE } from "./dashboards.schema";
import type { PutDashboardWidgetsBody } from "./dashboards.schema";

/**
 * `F3.32c` / ADR 0081 decision 5 — every layout a layout-arm `mimic` widget names must be a
 * `bms.mimic_layouts` row of the dashboard's organization. Run inside `putWidgets`' transaction,
 * before any delete or insert, beside `assertBoundPointsInOrganization` and in its shape.
 *
 * The explicit `organization_id` predicate is the check, not RLS alone: `tx` is a tenant
 * transaction today, and the predicate keeps it one if the handle ever changes. An unknown id and
 * another organization's id answer the SAME sentence, and neither is echoed, so the 400 never
 * confirms that a foreign layout exists.
 *
 * **`FOR KEY SHARE` holds each named layout until the save commits.** It conflicts with the
 * `FOR UPDATE` `MimicLayoutsService.remove` takes before its in-use count, so a delete waits for
 * this save and then counts its widget; a delete already in flight makes this read wait, then
 * find no row. It does not conflict with the non-key `UPDATE` a layout replace runs, so an edit
 * of the drawing never blocks a dashboard save.
 */
export async function assertMimicLayoutsInOrganization(
  tx: BmsTx,
  organizationId: string,
  widgets: PutDashboardWidgetsBody["widgets"],
): Promise<void> {
  const layoutIds = [
    ...new Set(
      widgets.flatMap((widget) =>
        widget.widgetType === "mimic" && widget.config.source === "layout" ? [widget.config.layoutId] : [],
      ),
    ),
  ];
  if (layoutIds.length === 0) {
    return;
  }
  const rows = await tx
    .select({ id: mimicLayouts.id })
    .from(mimicLayouts)
    .where(and(inArray(mimicLayouts.id, layoutIds), eq(mimicLayouts.organizationId, organizationId)))
    .for("key share");
  if (rows.length !== layoutIds.length) {
    throw new BadRequestException(MIMIC_LAYOUT_ORG_MESSAGE);
  }
}
