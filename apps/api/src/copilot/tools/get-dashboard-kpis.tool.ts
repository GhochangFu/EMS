import { dashboardKpisResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
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
    "The on-screen Total kW tile may show a newer live socket value than this read.",
  schema: z.object({ organizationId: z.string().uuid().optional() }).strict(),
  async run({ access, portfolio }, args, ctx) {
    return readPerOrganization(access, ctx, args.organizationId, async (_organizationId, assetIds) => ({
      items: [parseStoredContract(dashboardKpisResponseSchema, await portfolio.kpis([...assetIds]), "copilot_tools.get_dashboard_kpis.result")],
    }));
  },
});
