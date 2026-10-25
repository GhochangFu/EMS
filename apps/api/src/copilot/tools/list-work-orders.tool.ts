import { workOrdersListResponseSchema, workOrderStatusSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";

/**
 * `list_work_orders` (`F4.284`, ADR 0106; ADR 0099 Amendment 8 D7; owner ruling
 * DC7) — the work-orders board's own read (`WorkOrdersService.list`), one call per
 * organization with that organization's readable asset ids (`readPerOrganization`),
 * so the service never sees `null` (the whole fleet) or `[]`. `search` (title,
 * case-insensitive, as `titleSearch`) and `status` narrow in the service's SQL,
 * **before** its 100-row cap and the 25-item cap (the `F4.274` live-check rule), so
 * a work order past the first 100 is still found by its title. The ids it lists are
 * what a status change, a close or a reorder names.
 */
export const listWorkOrdersTool = defineReadTool({
  name: "list_work_orders",
  description:
    "List work orders (id, title, status, priority, sortOrder, asset, alarmId, assignedTo, dueAt). Optional " +
    "organizationId, search (title) and status narrow the list; truncated means there are more.",
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      search: z.string().min(1).max(64).optional(),
      status: workOrderStatusSchema.optional(),
    })
    .strict(),
  async run({ access, workOrders }, args, ctx) {
    return readPerOrganization(access, ctx, args.organizationId, async (_organizationId, assetIds, room) => {
      const page = parseStoredContract(
        workOrdersListResponseSchema,
        await workOrders.list(
          { limit: 100, assetIds: [...assetIds] },
          { ...(args.search ? { titleSearch: args.search } : {}), ...(args.status ? { status: args.status } : {}) },
        ),
        "copilot_tools.list_work_orders.page",
      );
      return {
        items: page.items.slice(0, room).map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          priority: item.priority,
          sortOrder: item.sortOrder,
          assetId: item.assetId,
          assetName: item.assetName,
          alarmId: item.alarmId,
          assignedTo: item.assignedTo,
          dueAt: item.dueAt,
        })),
        more: page.items.length > room,
      };
    });
  },
});
