import { loadTrendResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";
import { COPILOT_SERIES_MAX_BUCKETS, meanOf, resampleSeries, round2 } from "./energy-read-helpers";

type LoadPoint = { t: string; totalKw: number };

/** Peak, minimum and mean over the whole series, before the resample. */
function statsOf(points: readonly LoadPoint[]): Record<string, unknown> {
  let peak: LoadPoint | null = null;
  let min: number | null = null;
  for (const point of points) {
    if (peak === null || point.totalKw > peak.totalKw) peak = point;
    if (min === null || point.totalKw < min) min = point.totalKw;
  }
  return {
    peakKw: peak === null ? null : round2(peak.totalKw),
    peakAt: peak?.t ?? null,
    minKw: min === null ? null : round2(min),
    avgKw: meanOf(points.map((p) => p.totalKw)),
    pointCount: points.length,
  };
}

/**
 * `get_load_trend` (`F4.275`) — `DashboardService.loadTrend`, the
 * `GET /dashboard/load-trend` read behind the `/` trend chart: total kW per
 * minute. A 168-hour window is 10,080 points, so the series comes back as at
 * most 24 mean buckets per organization, with the peak, minimum and mean over
 * every point beside it.
 */
export const getLoadTrendTool = defineReadTool({
  name: "get_load_trend",
  description: "Read total kW per organization over the last windowHours (1-168, default 1): up to 24 averaged buckets, plus peak, min and average kW.",
  schema: z
    .object({ organizationId: z.string().uuid().optional(), windowHours: z.number().int().min(1).max(168).optional() })
    .strict(),
  async run({ access, portfolio }, args, ctx) {
    const window = `${args.windowHours ?? 1}h`;
    return readPerOrganization(access, ctx, args.organizationId, async (_organizationId, assetIds, room) => {
      const { points } = parseStoredContract(
        loadTrendResponseSchema,
        await portfolio.loadTrend(window, [...assetIds]),
        "copilot_tools.get_load_trend.result",
      );
      const buckets = Math.min(COPILOT_SERIES_MAX_BUCKETS, room);
      const items = resampleSeries(points, buckets, (group) => ({ t: group[0]!.t, totalKw: meanOf(group.map((p) => p.totalKw)) ?? 0 }));
      return { items, extra: statsOf(points), more: buckets < COPILOT_SERIES_MAX_BUCKETS && points.length > buckets };
    });
  },
});
