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
    "List assets (id, code, name, site, location, domain). Optional organizationId narrows the list; " +
    "optional search matches part of the name or code. The result groups assets by organization; truncated means there are more.",
  schema: z
    .object({ organizationId: z.string().uuid().optional(), search: z.string().min(1).max(64).optional() })
    .strict(),
  async run({ access, assets }, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    // `F4.274` live check: the filter runs before the 25-item cap, so a named asset past the 25th is found.
    const needle = args.search?.trim().toLowerCase() || undefined;
    const matches = (row: { name: string; code: string }): boolean =>
      needle === undefined || row.name.toLowerCase().includes(needle) || row.code.toLowerCase().includes(needle);
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
      ).filter(matches);
      if (rows.length > room) truncated = true;
      room -= out.add(organizationId, rows, room);
    }
    return { ok: true, result: { organizations: out.organizations, truncated }, organizationIds: out.read };
  },
});
