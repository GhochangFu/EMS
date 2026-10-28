import { z } from "zod";

import { alarmSeverityCodeSchema } from "./operations";

/**
 * `F4.291` PR 2 (ADR 0099 Amendment 9 E5(b)) — the copilot's `get_alarm_stats`
 * answer for one organization over `[from, to)`: alarms raised in the window
 * counted by severity and by location, the ten assets that raised the most,
 * and the mean times to acknowledge and to clear. `open` counts the alarms of
 * the window that are not cleared now (`cleared_at IS NULL`, ADR 0057).
 *
 * `mttaSeconds` / `mttrSeconds` are the mean over the window's alarms that
 * carry the stamp, in whole seconds, and `null` (never absent) when none
 * does: the model must see "nothing was acknowledged" said, not inferred
 * from a missing key. `byLocation` is cut at 25 rows (`moreLocations` says
 * more exist), `topAssets` at 10.
 *
 * **Encoding (§4.8):** plain `z.object` throughout — no `.merge()`, no
 * `.extend()` of another contract, no intersection. Not `.readonly()`: the
 * sibling alarm and telemetry contracts (`alarmsListResponseSchema`,
 * `pointAggregateResponseSchema`) are mutable and the service builds this
 * one from mutable literals. Not `.strict()`: an extra key a later service
 * adds is stripped by the tool's parse, never sent to the model.
 */

const countSchema = z.number().int().min(0);

export const alarmStatsSeverityRowSchema = z.object({
  severity: alarmSeverityCodeSchema,
  raised: countSchema,
  open: countSchema,
});

export const alarmStatsLocationRowSchema = z.object({
  locationId: z.string().uuid(),
  locationName: z.string(),
  raised: countSchema,
  open: countSchema,
});

export const alarmStatsAssetRowSchema = z.object({
  assetId: z.string().uuid(),
  assetCode: z.string(),
  assetName: z.string(),
  raised: countSchema,
});

/** The most locations one answer lists; `moreLocations` says more raised alarms. */
export const ALARM_STATS_MAX_LOCATIONS = 25;
/** The most assets `topAssets` lists. */
export const ALARM_STATS_TOP_ASSETS = 10;

export const alarmStatsSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  raised: countSchema,
  open: countSchema,
  bySeverity: z.array(alarmStatsSeverityRowSchema),
  byLocation: z.array(alarmStatsLocationRowSchema).max(ALARM_STATS_MAX_LOCATIONS),
  moreLocations: z.boolean(),
  topAssets: z.array(alarmStatsAssetRowSchema).max(ALARM_STATS_TOP_ASSETS),
  mttaSeconds: countSchema.nullable(),
  mttrSeconds: countSchema.nullable(),
  acknowledgedCount: countSchema,
  clearedCount: countSchema,
});
