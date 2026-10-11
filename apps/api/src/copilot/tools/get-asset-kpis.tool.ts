import { assetKpisResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { DEFAULT_LATEST_WINDOW_MINUTES, MAX_LATEST_WINDOW_MINUTES } from "../../telemetry/telemetry.schema";
import { defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_RECORD_OUT_OF_SCOPE, organizationOfAsset } from "./copilot-tool-scope";

/**
 * `get_asset_kpis` — `AssetKpisService.listKpis`, which takes no organization
 * and reads on the fleet pool. The asset is placed in an allowed organization
 * with the caller's read scope **before** the service runs; for the global
 * admin `canReadAsset` passes every asset, so this is the check that keeps an
 * own-key organization's asset from the platform provider (decision 10).
 */
export const getAssetKpisTool = defineReadTool({
  name: "get_asset_kpis",
  description:
    "Read one asset's KPIs over the latest window (minutes, default 15). Take the assetId from list_assets or list_alarms.",
  schema: z
    .object({
      assetId: z.string().uuid(),
      windowMinutes: z.number().int().positive().max(MAX_LATEST_WINDOW_MINUTES).optional(),
    })
    .strict(),
  async run({ access, kpis }, args, ctx) {
    const organizationId = await organizationOfAsset(access, ctx.user, ctx.allowedOrganizationIds, args.assetId);
    if (organizationId === null) return { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE };
    const result = parseStoredContract(
      assetKpisResponseSchema,
      await kpis.listKpis(args.assetId, args.windowMinutes ?? DEFAULT_LATEST_WINDOW_MINUTES, ctx.now),
      "copilot_tools.get_asset_kpis.result",
    );
    return { ok: true, result: { organizationId, kpis: result }, organizationIds: [organizationId] };
  },
});
