import { MAX_WIDGET_WINDOW_MINUTES, pointAggregateResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { resolveAggregateRange } from "../../telemetry/point-aggregate-window";
import { pointKeySchema } from "../../telemetry/telemetry.schema";
import { defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_RECORD_OUT_OF_SCOPE, organizationOfAsset } from "./copilot-tool-scope";

export const COPILOT_AGGREGATE_DEFAULT_WINDOW_MINUTES = 1_440;

/**
 * `get_point_aggregate` (`F4.274`) — `TelemetryService.pointAggregate`, the
 * `GET /telemetry/points/:pointRef/aggregate` read. **Stats only**: the tool
 * never names a `bucketFunction` (a 24-hour window reads at the 1-minute
 * level, 1,440 buckets, past the tool-result cut) and drops any `buckets` the
 * answer carries, so the result is constant in size. The asset is placed
 * first (the rollups carry no RLS).
 */
export const getPointAggregateTool = defineReadTool({
  name: "get_point_aggregate",
  description: "Read one point's sum, average, min, max and peak on one asset over the last windowMinutes (default 1440). compare adds the window before it.",
  schema: z
    .object({
      assetId: z.string().uuid(),
      pointKey: pointKeySchema,
      windowMinutes: z.number().int().min(1).max(MAX_WIDGET_WINDOW_MINUTES).optional(),
      compare: z.boolean().optional(),
    })
    .strict(),
  async run({ access, telemetry }, args, ctx) {
    const organizationId = await organizationOfAsset(access, ctx.user, ctx.allowedOrganizationIds, args.assetId);
    if (organizationId === null) return { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE };
    const answer = parseStoredContract(
      pointAggregateResponseSchema,
      await telemetry.pointAggregate(
        { assetId: args.assetId, pointKey: args.pointKey },
        {
          // `F4.297`: the same range rule the route uses, trailing from the turn's clock.
          ...resolveAggregateRange(
            { windowMinutes: args.windowMinutes ?? COPILOT_AGGREGATE_DEFAULT_WINDOW_MINUTES },
            ctx.now,
          ),
          compare: args.compare ?? false,
          now: ctx.now,
        },
      ),
      "copilot_tools.get_point_aggregate.result",
    );
    return {
      ok: true,
      result: {
        organizationId,
        assetId: args.assetId,
        pointKey: args.pointKey,
        from: answer.from,
        to: answer.to,
        bucketSeconds: answer.bucketSeconds,
        stats: answer.stats,
        // The compare half's scalars only: since `F4.297` the object can carry a
        // bucket array, which this stats-only tool never passes on.
        compare:
          answer.compare === null
            ? null
            : { from: answer.compare.from, to: answer.compare.to, stats: answer.compare.stats },
      },
      organizationIds: [organizationId],
    };
  },
});
