import { maintenanceSchedulesResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";

/**
 * `list_maintenance_schedules` (`F4.281`, ADR 0099 Amendment 8 D7; owner ruling
 * DC4) — the Schedule Centre's own read (`MaintenanceService.list`), one call
 * per organization with that organization's readable asset ids
 * (`readPerOrganization`), so the service never sees `null` (the whole fleet)
 * or `[]`. Unlike the page it reads with no due-date window (`anyDueDate`), so
 * every schedule the caller may read is listed; `includeInactive` adds the
 * deactivated ones, so a `maintenanceSchedule.activate` can name one. `search`
 * (title, case-insensitive, as `titleSearch`) and `assetId` narrow in the
 * service's SQL, **before** its `MAINTENANCE_LIST_LIMIT` row cap and the
 * 25-item cap (the `F4.274` live-check rule), so a schedule past the first 100
 * by due date is still found by its title.
 */
export const listMaintenanceSchedulesTool = defineReadTool({
  name: "list_maintenance_schedules",
  description:
    "List maintenance schedules (id, title, asset, category, priority, intervalDays, nextDueAt, dueState, active, " +
    "safetyCritical, complianceRef, activeWorkOrderId), whatever the due date. Set includeInactive to list " +
    "deactivated schedules too, so an activate can name one. Optional organizationId, search (title) and assetId " +
    "narrow the list; truncated means there are more.",
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      search: z.string().min(1).max(64).optional(),
      assetId: z.string().uuid().optional(),
      includeInactive: z.boolean().optional(),
    })
    .strict(),
  async run({ access, maintenance }, args, ctx) {
    return readPerOrganization(access, ctx, args.organizationId, async (_organizationId, assetIds, room) => {
      const page = parseStoredContract(
        maintenanceSchedulesResponseSchema,
        await maintenance.list(
          {
            dueState: "all",
            priority: "all",
            horizonDays: 120,
            includeInactive: args.includeInactive === true,
            ...(args.assetId ? { assetId: args.assetId } : {}),
          },
          [...assetIds],
          { anyDueDate: true, ...(args.search ? { titleSearch: args.search } : {}) },
        ),
        "copilot_tools.list_maintenance_schedules.page",
      );
      return {
        items: page.items.slice(0, room).map((item) => ({
          id: item.id,
          title: item.title,
          assetId: item.assetId,
          assetCode: item.assetCode,
          assetName: item.assetName,
          category: item.category,
          generationMode: item.generationMode,
          priority: item.priority,
          intervalDays: item.intervalDays,
          nextDueAt: item.nextDueAt,
          dueState: item.dueState,
          active: item.active,
          safetyCritical: item.safetyCritical,
          complianceRef: item.complianceRef,
          activeWorkOrderId: item.activeWorkOrderId,
        })),
        more: page.items.length > room,
      };
    });
  },
});
