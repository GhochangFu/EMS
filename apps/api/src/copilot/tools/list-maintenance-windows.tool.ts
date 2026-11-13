import { maintenanceWindowStateSchema, maintenanceWindowsResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { readScopeFor } from "../../maintenance-windows/maintenance-window-scope";
import { maintenanceWindowListQuerySchema } from "../../maintenance-windows/maintenance-windows.schema";
import { defineReadTool, pageOrganizations } from "./copilot-read-tool";
import { targetOrganizations } from "./copilot-tool-scope";

/** The most rows `GET /maintenance-windows` answers (its `limit` bound). */
const MAINTENANCE_WINDOWS_SERVICE_CAP = 100;
/** Review of PR 6: an item names at most this many targets (the route allows 200), with `targetCount`. */
export const LIST_WINDOW_TARGETS_CAP = 10;

/**
 * `list_maintenance_windows` (`F4.359` PR 6, ADR 0099 Amendment 19 decision 6,
 * ruling Q3) — the windows page's own read (`MaintenanceWindowsService.list`),
 * with the caller's own window scope (`readScopeFor`: the readable assets,
 * locations and organizations, and the subtree grant), so the copilot sees
 * exactly the windows and targets the route shows this caller. One call per
 * organization the turn may read (`targetOrganizations`), each filtered on it;
 * the filters go through the route's own query schema, so they only narrow. An
 * item names its first 10 targets and counts them all (`targetCount`): one
 * 200-target window would otherwise fill the budget alone and be dropped. The
 * covered assets are a count (a location target can cover hundreds), given only
 * for an active window: the service resolves them for no other, and only the
 * ones the caller may read, narrowed by the filters. Unpaged:
 * at most 25 items, fitted to the tool-result budget (`truncated` first); the
 * filters find a named window. The `id` is what an extend, end or cancel names.
 */
export const listMaintenanceWindowsTool = defineReadTool({
  name: "list_maintenance_windows",
  description:
    "List maintenance windows (id, reason, state, startsAt, endsAt, endedAt, targets: the first 10, targetCount: all, " +
    "workOrder, maintenanceSchedule). An active window also has readableCoveredAssetCount: the assets it covers now " +
    "that you can read, narrowed by assetId or locationId. Alarms on an active window's targets are suppressed. " +
    "Optional organizationId, state (active, future, past), assetId and locationId narrow the list; truncated means there are more.",
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
    // F4.108: the route's own query schema, safely parsed once (the tool's input
    // schema already validated the args, so a refusal here is unexpected).
    const filters = maintenanceWindowListQuerySchema.safeParse({
      ...(args.state ? { state: args.state } : {}),
      ...(args.assetId ? { assetId: args.assetId } : {}),
      ...(args.locationId ? { locationId: args.locationId } : {}),
    });
    if (!filters.success) return { ok: false, error: "The maintenance-window filters are not valid." };
    return pageOrganizations(target.ids, undefined, async (organizationId, room) => {
      const query = {
        ...filters.data,
        organizationId,
        limit: Math.min(room + 1, MAINTENANCE_WINDOWS_SERVICE_CAP),
      };
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
          targets: item.targets.slice(0, LIST_WINDOW_TARGETS_CAP),
          targetCount: item.targets.length,
          ...(item.state === "active" ? { readableCoveredAssetCount: item.assetIds.length } : {}),
          workOrder: item.workOrder,
          maintenanceSchedule: item.maintenanceSchedule,
        })),
      };
    });
  },
});
