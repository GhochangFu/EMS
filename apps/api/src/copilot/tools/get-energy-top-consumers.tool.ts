import { energyTopConsumersResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { LOCATION_ID_PHRASE } from "./copilot-list-paging";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS } from "./copilot-tool-scope";
import { COPILOT_ENERGY_DEFAULT_WINDOW, copilotEnergyWindowSchema } from "./energy-read-helpers";

/**
 * `get_energy_top_consumers` (`F4.275`) — `DashboardService.energyTopConsumers`,
 * the `GET /dashboard/energy/top-consumers` read behind the `/energy` table,
 * once per organization. The service `limit` is the lesser of the asked limit
 * and the room left, so the result never passes 25 rows in total.
 */
export const getEnergyTopConsumersTool = defineReadTool({
  name: "get_energy_top_consumers",
  description:
    "List the assets using the most energy per organization over window (24h default, 7d, 30d), with site, average kW and estimated kWh. limit 1-25, default 10. " +
    `Optional organizationId or ${LOCATION_ID_PHRASE} narrows the read.`,
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      window: copilotEnergyWindowSchema.optional(),
      limit: z.number().int().min(1).max(COPILOT_TOOL_LIST_MAX_ITEMS).optional(),
    })
    .strict(),
  async run(services, args, ctx) {
    const window = args.window ?? COPILOT_ENERGY_DEFAULT_WINDOW;
    return readPerOrganization(services, ctx, { organizationId: args.organizationId, locationId: args.locationId }, async (_organizationId, assetIds, room) => {
      const limit = Math.min(args.limit ?? 10, room);
      const { consumers } = parseStoredContract(
        energyTopConsumersResponseSchema,
        await services.portfolio.energyTopConsumers(window, limit, [...assetIds]),
        "copilot_tools.get_energy_top_consumers.page",
      );
      return { items: consumers, more: consumers.length >= limit };
    });
  },
});
