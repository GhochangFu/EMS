import { assetPointPickerListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, COPILOT_TOOL_RECORD_OUT_OF_SCOPE, organizationOfAsset } from "./copilot-tool-scope";

/**
 * `list_asset_points` (`F4.274`) — `AssetsService.listPoints`, the active
 * point keys of one asset, so the telemetry tools name a real key rather than
 * a guessed one. The service reads on the fleet pool by id, so the asset is
 * placed in an allowed organization with the caller's read scope first.
 * Cut at `COPILOT_TOOL_LIST_MAX_ITEMS`; `truncated` says there are more.
 */
export const listAssetPointsTool = defineReadTool({
  name: "list_asset_points",
  description: "List one asset's point keys and units. Optional search matches part of the key. Use a key with the get_*_values and get_point_aggregate tools.",
  schema: z
    .object({
      assetId: z.string().uuid(),
      search: z.string().min(1).max(64).optional(),
    })
    .strict(),
  async run({ access, assets }, args, ctx) {
    const organizationId = await organizationOfAsset(access, ctx.user, ctx.allowedOrganizationIds, args.assetId);
    if (organizationId === null) return { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE };
    const page = parseStoredContract(
      assetPointPickerListResponseSchema,
      await assets.listPoints(args.assetId),
      "copilot_tools.list_asset_points.page",
    );
    const needle = args.search?.toLowerCase();
    const rows = needle === undefined ? page.items : page.items.filter((row) => row.pointKey.toLowerCase().includes(needle));
    return {
      ok: true,
      result: {
        organizationId,
        assetId: args.assetId,
        assetName: page.items[0]?.assetName ?? null,
        points: rows.slice(0, COPILOT_TOOL_LIST_MAX_ITEMS).map((row) => ({ pointKey: row.pointKey, unit: row.unit })),
        truncated: rows.length > COPILOT_TOOL_LIST_MAX_ITEMS,
      },
      organizationIds: [organizationId],
    };
  },
});
