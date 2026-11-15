import { dashboardKpisResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { LOCATION_ID_PHRASE } from "./copilot-list-paging";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";

/**
 * `get_dashboard_kpis` (`F4.275`) — `DashboardService.kpis`, the
 * `GET /dashboard/kpis` read behind the `/` KPI row, once per organization with
 * its readable asset ids. `F4.375` (ADR 0133 Amendment 2, plan Q1): the Total
 * load tile shows this same server figure, which sums only the locations whose
 * energy is shown and is `null` when none in scope does; the description says
 * so, and no longer warns of a newer socket value.
 *
 * `F3.16`: the open and critical alarm counts include device alarms, as the
 * ribbon and the alarm centre do, while `list_alarms` lists rule alarms only.
 * Kept: this tool reports the screen's numbers and names no alarm to act on.
 */
export const getDashboardKpisTool = defineReadTool({
  name: "get_dashboard_kpis",
  description:
    "Read the home-page KPIs per organization: total kW, sites online/total, open and critical alarms, PUE; total kW, open alarms and PUE also 24 h earlier. " +
    "Total kW sums only locations that show energy; it is null when no location in scope shows energy (energyShown false), or when no shown location has a kW value. Optional organizationId or " +
    `${LOCATION_ID_PHRASE} narrows the read.`,
  schema: z.object({ organizationId: z.string().uuid().optional(), locationId: z.string().uuid().optional() }).strict(),
  async run(services, args, ctx) {
    return readPerOrganization(services, ctx, { organizationId: args.organizationId, locationId: args.locationId }, async (_organizationId, assetIds) => ({
      items: [parseStoredContract(dashboardKpisResponseSchema, await services.portfolio.kpis([...assetIds]), "copilot_tools.get_dashboard_kpis.result")],
    }));
  },
});
