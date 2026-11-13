import { maintenanceWindowStateSchema, maintenanceWindowsResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { readScopeFor } from "../../maintenance-windows/maintenance-window-scope";
import { maintenanceWindowListQuerySchema } from "../../maintenance-windows/maintenance-windows.schema";
import { defineReadTool, pageOrganizations } from "./copilot-read-tool";
import { targetOrganizations } from "./copilot-tool-scope";

/** The most rows `GET /maintenance-windows` answers (its `limit` bound). */
const MAINTENANCE_WINDOWS_SERVICE_CAP = 100;

/**
 * `list_maintenance_windows` (`F4.359` PR 6, ADR 0099 Amendment 19 decision 6,
 * ruling Q3) — the windows page's own read (`MaintenanceWindowsService.list`),
 * with the caller's own window scope (`readScopeFor`: the readable assets,
 * locations and organizations, and the subtree grant), so the copilot sees
 * exactly the windows and targets the route shows this caller. One call per
 * organization the turn may read (`targetOrganizations`), each filtered on it;
 * the filters go through the route's own query schema, so they only narrow. The
 * covered assets are a count (a location target can cover hundreds). Unpaged:
 * at most 25 items, fitted to the tool-result budget (`truncated` first); the
 * filters find a named window. The `id` is what an extend, end or cancel names.
 */
export const listMaintenanceWindowsTool = defineReadTool({
  name: "list_maintenance_windows",
  description:
    "List maintenance windows (id, reason, state, startsAt, endsAt, endedAt, targets, coveredAssetCount, workOrder, " +
    "maintenanceSchedule). Alarms on an active window's targets are suppressed. Optional organizationId, state " +
    "(active, future, past), assetId and locationId narrow the list; truncated means there are more.",
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      state: maintenanceWindowStateSchema.optional(),
      assetId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
    })
    .strict(),
  async run(services, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const scope = await readScopeFor(services.access, ctx.user);
    return pageOrganizations(target.ids, undefined, async (organizationId, room) => {
      const query = maintenanceWindowListQuerySchema.parse({
        organizationId,
        ...(args.state ? { state: args.state } : {}),
        ...(args.assetId ? { assetId: args.assetId } : {}),
        ...(args.locationId ? { locationId: args.locationId } : {}),
        limit: Math.min(room + 1, MAINTENANCE_WINDOWS_SERVICE_CAP),
      });
      const page = parseStoredContract(
        maintenanceWindowsResponseSchema,
        await services.maintenanceWindows.list(query, scope),
        "copilot_tools.list_maintenance_windows.page",
      );
      return {
        more: page.items.length > room,
        items: page.items.slice(0, room).map((item) => ({
          id: item.id,
          reason: item.reason,
          state: item.state,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          endedAt: item.endedAt,
          targets: item.targets,
          coveredAssetCount: item.assetIds.length,
          workOrder: item.workOrder,
          maintenanceSchedule: item.maintenanceSchedule,
        })),
      };
    });
  },
});
