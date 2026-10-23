import { energySourceMixResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";
import {
  COPILOT_ENERGY_DEFAULT_WINDOW,
  COPILOT_SERIES_MAX_BUCKETS,
  copilotEnergyWindowSchema,
  meanOf,
  resampleSeries,
} from "./energy-read-helpers";

type MixPoint = { t: string; gridKw: number; solarKw: number; dgKw: number };

const meanMix = (group: readonly MixPoint[]): MixPoint => ({
  t: group[0]!.t,
  gridKw: meanOf(group.map((p) => p.gridKw)) ?? 0,
  solarKw: meanOf(group.map((p) => p.solarKw)) ?? 0,
  dgKw: meanOf(group.map((p) => p.dgKw)) ?? 0,
});

/**
 * `get_energy_source_mix` (`F4.275`) — `DashboardService.energySourceMix`, the
 * `GET /dashboard/energy/source-mix` read behind the `/energy` stacked chart.
 * A 24-hour window is 1,440 points, so the series comes back as at most 24
 * mean buckets per organization, with `averageKw` per source over every point.
 */
export const getEnergySourceMixTool = defineReadTool({
  name: "get_energy_source_mix",
  description: "Read grid, solar and DG kW per organization over window (24h default, 7d, 30d): up to 24 averaged buckets, plus averageKw per source.",
  schema: z.object({ organizationId: z.string().uuid().optional(), window: copilotEnergyWindowSchema.optional() }).strict(),
  async run({ access, portfolio }, args, ctx) {
    const window = args.window ?? COPILOT_ENERGY_DEFAULT_WINDOW;
    return readPerOrganization(access, ctx, args.organizationId, async (_organizationId, assetIds, room) => {
      const { points } = parseStoredContract(
        energySourceMixResponseSchema,
        await portfolio.energySourceMix(window, [...assetIds]),
        "copilot_tools.get_energy_source_mix.result",
      );
      const buckets = Math.min(COPILOT_SERIES_MAX_BUCKETS, room);
      return {
        items: resampleSeries(points, buckets, meanMix),
        extra: {
          averageKw: {
            grid: meanOf(points.map((p) => p.gridKw)),
            solar: meanOf(points.map((p) => p.solarKw)),
            dg: meanOf(points.map((p) => p.dgKw)),
          },
          pointCount: points.length,
        },
        more: buckets < COPILOT_SERIES_MAX_BUCKETS && points.length > buckets,
      };
    });
  },
});
