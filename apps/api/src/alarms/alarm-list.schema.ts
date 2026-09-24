import { z } from "zod";

import { assetIdsQueryField } from "../auth/asset-scope.schema";

/**
 * `GET /api/v1/alarms` (`F3.28`, ADR 0074, plan decisions 1 and 4).
 *
 * `state` defaults to `"all"` — today's behaviour, unchanged for a caller who
 * sends nothing. `"active"` is the alarms rail's read: raised and not yet
 * cleared, acknowledged or not (`activeAlarmFilter`, task 1.5).
 *
 * `limit` keeps today's semantics exactly (plan decision 4): the old read was
 * `limitRaw ? Number(limitRaw) : 20`, and the service owns the
 * `Math.min(100, Math.max(1, …))` clamp. So every numeric value parses and
 * clamps as before — `0` and a negative number to 1, `Infinity` and `150.5`
 * to 100, `0.5` to 1 — and an empty `limit=` is absent (the default 20). Only
 * a non-numeric value (`NaN` after coercion) is a 400, as before. There is no
 * `.int()`: a fractional value is not refused here; the service truncates
 * after the clamp, so none reaches SQL's `LIMIT` as a non-integer (the old
 * read let one through). zod 3's `z.number()` accepts `Infinity`, so no
 * `.finite()` and no explicit allowance.
 */
export const alarmListQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.coerce.number().optional(),
    ),
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
