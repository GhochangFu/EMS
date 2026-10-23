import { pointsLatestResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { DEFAULT_LATEST_WINDOW_MINUTES, MAX_LATEST_WINDOW_MINUTES, pointKeySchema } from "../../telemetry/telemetry.schema";
import { defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_RECORD_OUT_OF_SCOPE, organizationsOfAssets } from "./copilot-tool-scope";

/** The most assets, and the most point keys, one `get_latest_values` call names: at most 25 pairs. */
export const COPILOT_LATEST_MAX_ASSETS = 5;
export const COPILOT_LATEST_MAX_POINT_KEYS = 5;

/**
 * `get_latest_values` (`F4.274`) — `TelemetryService.latestPointValues`, the
 * `GET /telemetry/points/latest` read. `telemetry.point_values` has no Row
 * Level Security, so every asset is placed first (`organizationsOfAssets`)
 * and one unplaced asset refuses the whole call, as the controller's 403
 * does. 5 × 5 pairs bound the result structurally.
 */
export const getLatestValuesTool = defineReadTool({
  name: "get_latest_values",
  description: "Read the latest value of each point key on each asset within the window (minutes, default 15). A pair with no sample is absent.",
  schema: z
    .object({
      assetIds: z.array(z.string().uuid()).min(1).max(COPILOT_LATEST_MAX_ASSETS),
      pointKeys: z.array(pointKeySchema).min(1).max(COPILOT_LATEST_MAX_POINT_KEYS),
      windowMinutes: z.number().int().min(1).max(MAX_LATEST_WINDOW_MINUTES).optional(),
    })
    .strict(),
  async run({ access, telemetry }, args, ctx) {
    const placed = await organizationsOfAssets(access, ctx.user, ctx.allowedOrganizationIds, args.assetIds);
    if (placed === null) return { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE };
    const organizationIds = ctx.allowedOrganizationIds.filter((id) => [...placed.values()].includes(id));
    const page = parseStoredContract(
      pointsLatestResponseSchema,
      {
        items: await telemetry.latestPointValues(
          args.assetIds,
          args.pointKeys,
          args.windowMinutes ?? DEFAULT_LATEST_WINDOW_MINUTES,
        ),
      },
      "copilot_tools.get_latest_values.result",
    );
    return { ok: true, result: { organizationIds, items: page.items }, organizationIds };
  },
});
