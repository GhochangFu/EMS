import { dashboardKpisResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { LOCATION_ID_PHRASE } from "./copilot-list-paging";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";

/**
 * `get_dashboard_kpis` (`F4.275`) — `DashboardService.kpis`, the
 * `GET /dashboard/kpis` read behind the `/` KPI row, once per organization with
 * its readable asset ids. The page overlays the socket's live sum on the Total
 * kW tile (`use-executive-dashboard.ts`), so the tile can differ from this
 * REST figure; the description says so (the row's own requirement).
 */
export const getDashboardKpisTool = defineReadTool({
  name: "get_dashboard_kpis",
  description:
    "Read the home-page KPIs per organization: total kW, sites online/total, open and critical alarms, PUE; total kW, open alarms and PUE also 24 h earlier. " +
    "The on-screen Total kW tile may show a newer live socket value than this read. Optional organizationId or " +
    `${LOCATION_ID_PHRASE} narrows the read.`,
  schema: z.object({ organizationId: z.string().uuid().optional(), locationId: z.string().uuid().optional() }).strict(),
  async run(services, args, ctx) {
    return readPerOrganization(services, ctx, { organizationId: args.organizationId, locationId: args.locationId }, async (_organizationId, assetIds) => ({
      items: [parseStoredContract(dashboardKpisResponseSchema, await services.portfolio.kpis([...assetIds]), "copilot_tools.get_dashboard_kpis.result")],
    }));
  },
});
