import { z } from "zod";

import { assetIdsQueryField } from "../auth/asset-scope.schema";

/**
 * `GET /api/v1/alarms` (`F3.28`, ADR 0074, plan decisions 1 and 4).
 *
 * `state` defaults to `"all"` — today's behaviour, unchanged for a caller who
 * sends nothing. `"active"` is the alarms rail's read: raised and not yet
 * cleared, acknowledged or not (`activeAlarmFilter`, task 1.5).
 *
 * `limit` keeps today's clamp-to-100 semantics — the service still owns the
 * `Math.min(100, Math.max(1, …))` clamp, so this schema only checks that a
 * caller who sends one sends a whole, positive number, never that it is
 * inside the clamp's own bound.
 */
export const alarmListQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().positive().optional(),
    state: z.enum(["all", "active"]).default("all"),
    assetIds: assetIdsQueryField,
  })
  .strict();

export type AlarmListQuery = z.infer<typeof alarmListQuerySchema>;

/**
 * `GET /api/v1/alarms/summary` (`F3.28`, ADR 0074, plan decision 7) — the
 * active-count-by-severity read. No `state`: the summary is always over
 * active alarms, and no `cursor`/`limit`: it returns one row per severity,
 * never a page.
 */
export const alarmSummaryQuerySchema = z
  .object({
    assetIds: assetIdsQueryField,
  })
  .strict();

export type AlarmSummaryQuery = z.infer<typeof alarmSummaryQuerySchema>;
