import { energyCentreSummarySchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";
import { COPILOT_ENERGY_DEFAULT_WINDOW, copilotEnergyWindowSchema } from "./energy-read-helpers";

/**
 * `get_energy_summary` (`F4.275`) — `DashboardService.energySummary`, the
 * `GET /dashboard/energy/summary` read behind the `/energy` ribbon, once per
 * organization with its readable asset ids. One item per organization.
 */
export const getEnergySummaryTool = defineReadTool({
  name: "get_energy_summary",
  description: "Read energy per organization over window (24h default, 7d, 30d): total kWh, peak kW, PUE and indicative cost with its currency.",
  schema: z.object({ organizationId: z.string().uuid().optional(), window: copilotEnergyWindowSchema.optional() }).strict(),
  async run({ access, portfolio }, args, ctx) {
    const window = args.window ?? COPILOT_ENERGY_DEFAULT_WINDOW;
    return readPerOrganization(access, ctx, args.organizationId, async (_organizationId, assetIds) => ({
      items: [
        parseStoredContract(energyCentreSummarySchema, await portfolio.energySummary(window, [...assetIds]), "copilot_tools.get_energy_summary.result"),
      ],
    }));
  },
});
