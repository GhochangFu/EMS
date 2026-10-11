import { dashboardsListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { collectByOrganization, defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, targetOrganizations } from "./copilot-tool-scope";

export const COPILOT_DASHBOARDS_WRONG_ORGANIZATION = "The dashboard list returned a row from another organization.";

/**
 * `list_dashboards` — `DashboardsService.list`, one call per organization
 * (its `organizationId` argument is always set; the service ANDs it onto the
 * caller's `readableOrganizationIds`).
 */
export const listDashboardsTool = defineReadTool({
  name: "list_dashboards",
  description:
    "List dashboards (slug, title, organization). Optional organizationId narrows the list. open_page /dashboards/<slug> opens one.",
  schema: z.object({ organizationId: z.string().uuid().optional() }).strict(),
  async run({ dashboards }, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const out = collectByOrganization<z.infer<typeof dashboardsListResponseSchema>["items"][number]>();
    let room = COPILOT_TOOL_LIST_MAX_ITEMS;
    let truncated = false;
    for (const organizationId of target.ids) {
      if (room <= 0) {
        truncated = true;
        break;
      }
      const page = parseStoredContract(
        dashboardsListResponseSchema,
        await dashboards.list(ctx.user, organizationId),
        "copilot_tools.list_dashboards.page",
      );
      if (page.items.some((item) => item.organizationId !== organizationId)) {
        return { ok: false, error: COPILOT_DASHBOARDS_WRONG_ORGANIZATION };
      }
      if (page.items.length > room) truncated = true;
      room -= out.add(organizationId, page.items, room);
    }
    return { ok: true, result: { organizations: out.organizations, truncated }, organizationIds: out.read };
  },
});
