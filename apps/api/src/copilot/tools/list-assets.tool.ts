import { assetListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { collectByOrganization, defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, targetOrganizations } from "./copilot-tool-scope";

/**
 * `list_assets` — `AssetsService.listAll`, one call per organization with
 * that organization's readable asset ids (never `null`, never no filter).
 */
export const listAssetsTool = defineReadTool({
  name: "list_assets",
  description:
    "List assets (id, code, name, site, location, domain). Optional organizationId narrows the list. " +
    "The result groups assets by organization; truncated means there are more.",
  schema: z.object({ organizationId: z.string().uuid().optional() }).strict(),
  async run({ access, assets }, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const out = collectByOrganization<z.infer<typeof assetListResponseSchema>[number]>();
    let room = COPILOT_TOOL_LIST_MAX_ITEMS;
    let truncated = false;
    for (const organizationId of target.ids) {
      if (room <= 0) {
        truncated = true;
        break;
      }
      const assetIds = await access.readableAssetIdsInOrganization(ctx.user, organizationId);
      if (assetIds.length === 0) {
        out.add(organizationId, [], room);
        continue;
      }
      const rows = parseStoredContract(
        assetListResponseSchema,
        await assets.listAll(assetIds, organizationId),
        "copilot_tools.list_assets.rows",
      );
      if (rows.length > room) truncated = true;
      room -= out.add(organizationId, rows, room);
    }
    return { ok: true, result: { organizations: out.organizations, truncated }, organizationIds: out.read };
  },
});
