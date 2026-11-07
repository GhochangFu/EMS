import { z } from "zod";

/**
 * `F4.332` / ADR 0112 Amendment 3 item 1 — the periods `energy.cost.total` sums the daily cost
 * over (ADR 0070 Amendment 7 decision 3): today, the last seven local days with today, and the
 * calendar month so far. Each is a sum of the same rounded daily figures `energy.cost_by_day`
 * returns, so a tile and the chart beside it cannot disagree.
 */
export const energyCostPeriodSchema = z.enum(["today", "last_7_days", "this_month"]);

/** `F4.332` — the longest window `energy.cost_by_day` reads, in local days (ADR 0070 Amendment 7 decision 6). */
export const ENERGY_COST_MAX_DAYS = 90;

/**
 * `F4.332` — why a day's cost (or a period total) is `null` (ADR 0070 Amendment 7 decision 5).
 * Never `0`: a missing rate, a second currency or no energy is not a cost of zero.
 */
export const energyCostReasonSchema = z.enum(["rate_missing", "currency_mixed", "no_energy"]);

/** A local calendar date, `YYYY-MM-DD`, in the zone of the location the cost belongs to. */
export const LOCAL_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `F4.332` — one row of the `energy.cost_by_day` dataset (ADR 0112 Amendment 3 item 1): one local
 * day, oldest first and today last. `kwh` is the day's hourly energy summed (`null` with
 * `no_energy`); `cost` is that energy priced hour by hour at the rate in force, rounded to two
 * decimals once (`null` with a `reason`); `currency` is the one ISO 4217 code in scope, `null`
 * when there is none or more than one. The catalog dataset carries these as plain cells; the API
 * builds them through this schema and the web parses them back through it.
 */
export const energyCostDayRowSchema = z.object({
  day: z.string().regex(LOCAL_DAY_PATTERN),
  kwh: z.number().nullable(),
  cost: z.number().nullable(),
  currency: z.string().nullable(),
  reason: energyCostReasonSchema.nullable(),
});

export type EnergyCostPeriod = z.infer<typeof energyCostPeriodSchema>;
export type EnergyCostReason = z.infer<typeof energyCostReasonSchema>;
export type EnergyCostDayRow = z.infer<typeof energyCostDayRowSchema>;
