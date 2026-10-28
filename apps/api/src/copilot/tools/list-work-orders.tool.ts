import { workOrdersListResponseSchema, workOrderStatusSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { CURSOR_PHRASE, LOCATION_ID_PHRASE, listCursorSchema, offsetKeySchema, offsetPage, serviceCapOf } from "./copilot-list-paging";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";

/** The most rows `WorkOrdersService.list` answers (its `limit` clamp). */
const WORK_ORDERS_SERVICE_CAP = 100;

/**
 * `list_work_orders` (`F4.284`, ADR 0106; ADR 0099 Amendment 8 D7; owner ruling
 * DC7) — the work-orders board's own read (`WorkOrdersService.list`), one call per
 * organization with that organization's readable asset ids (`readPerOrganization`),
 * so the service never sees `null` (the whole fleet) or `[]`. `search` (title,
 * case-insensitive, as `titleSearch`) and `status` narrow in the service's SQL,
 * **before** its 100-row cap and the 25-item cap (the `F4.274` live-check rule), so
 * a work order past the first 100 is still found by its title. The ids it lists are
 * what a status change, a close or a reorder names.
 *
 * `F4.291` (ADR 0099 Amendment 9 E5): `locationId` reads the work orders of the
 * caller's readable assets of that site's subtree; `cursor` is an offset into the
 * service's rows (its order ends in `id`, so it is total). **Known limit:** the
 * service answers at most 100 rows, so the cursor pages inside those 100 only;
 * when it answers 100 the entry carries `serviceCap: 100` and the last page stays
 * `truncated` with a `null` cursor (`serviceCapOf`) — `search` and `status` are
 * what find a named work order there.
 */
export const listWorkOrdersTool = defineReadTool({
  name: "list_work_orders",
  description:
    "List work orders (id, title, status, priority, sortOrder, asset, alarmId, assignedTo, dueAt). Optional " +
    `organizationId, ${LOCATION_ID_PHRASE}, search (title) and status narrow the list; truncated means there are more, with ${CURSOR_PHRASE}.`,
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      search: z.string().min(1).max(64).optional(),
      status: workOrderStatusSchema.optional(),
      cursor: listCursorSchema.optional(),
    })
    .strict(),
  async run(services, args, ctx) {
    const scope = { organizationId: args.organizationId, locationId: args.locationId, paging: { cursor: args.cursor, key: offsetKeySchema } };
    return readPerOrganization(services, ctx, scope, async (_organizationId, assetIds, room, resume) => {
      const page = parseStoredContract(
        workOrdersListResponseSchema,
        await services.workOrders.list(
          { limit: WORK_ORDERS_SERVICE_CAP, assetIds: [...assetIds] },
          { ...(args.search ? { titleSearch: args.search } : {}), ...(args.status ? { status: args.status } : {}) },
        ),
        "copilot_tools.list_work_orders.page",
      );
      const { items, ...rest } = offsetPage(page.items, resume, room);
      return {
        ...rest,
        ...serviceCapOf(page.items.length, WORK_ORDERS_SERVICE_CAP),
        items: items.map((item) => ({
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
      };
    });
  },
});
