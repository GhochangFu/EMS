import { encodePointRef, recentTelemetryResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { pointKeySchema } from "../../telemetry/telemetry.schema";
import { defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_RECORD_OUT_OF_SCOPE, organizationOfAsset } from "./copilot-tool-scope";

/** The widest window, in minutes (the route's `1–168` bound, read as minutes). */
export const COPILOT_RECENT_MAX_WINDOW_MINUTES = 168;
export const COPILOT_RECENT_DEFAULT_WINDOW_MINUTES = 15;
/** The most rows one call returns, and the default. */
export const COPILOT_RECENT_MAX_ROWS = 25;
export const COPILOT_RECENT_DEFAULT_ROWS = 10;

/**
 * `get_recent_values` (`F4.274`) — `TelemetryService.recentForPoint`, the
 * `GET /telemetry/points/:pointRef/recent` read, newest first. The asset is
 * placed first (`telemetry.point_values` has no RLS). The tool asks the
 * service for `limit + 1` rows (at most 26), keeps `limit`, and says
 * `truncated` when the extra row came back.
 */
export const getRecentValuesTool = defineReadTool({
  name: "get_recent_values",
  description: "Read one point's newest samples on one asset over the last windowMinutes (default 15, max 168). limit: rows, default 10, max 25.",
  schema: z
    .object({
      assetId: z.string().uuid(),
      pointKey: pointKeySchema,
      windowMinutes: z.number().int().min(1).max(COPILOT_RECENT_MAX_WINDOW_MINUTES).optional(),
      limit: z.number().int().min(1).max(COPILOT_RECENT_MAX_ROWS).optional(),
    })
    .strict(),
  async run({ access, telemetry }, args, ctx) {
    const organizationId = await organizationOfAsset(access, ctx.user, ctx.allowedOrganizationIds, args.assetId);
    if (organizationId === null) return { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE };
    const windowMinutes = args.windowMinutes ?? COPILOT_RECENT_DEFAULT_WINDOW_MINUTES;
    const limit = args.limit ?? COPILOT_RECENT_DEFAULT_ROWS;
    const all = await telemetry.recentForPoint(encodePointRef(args.assetId, args.pointKey), `${windowMinutes}m`, limit + 1);
    const rows = parseStoredContract(recentTelemetryResponseSchema, all.slice(0, limit), "copilot_tools.get_recent_values.rows");
    return {
      ok: true,
      result: {
        organizationId,
        assetId: args.assetId,
        pointKey: args.pointKey,
        windowMinutes,
        truncated: all.length > limit,
        readings: rows.map((row) => ({ time: row.time, value: row.value, unit: row.unit })),
      },
      organizationIds: [organizationId],
    };
  },
});
