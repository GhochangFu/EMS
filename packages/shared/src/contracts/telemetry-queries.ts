import { z } from "zod";

import { MAX_WIDGET_WINDOW_MINUTES, pointAggregateFunctionSchema } from "./dashboard-builder";
import { DEFAULT_RAW_RECORDS_LIMIT, MAX_RAW_RECORDS_LIMIT } from "./envelopes";

/**
 * `F4.297` U1 (ADR 0108 decision 1.2) — the telemetry read query contracts,
 * moved to `@bms/shared` (ADR 0030, AGENTS §4.8) so the web and the API share one
 * declaration. The precedent is `energyReportQuerySchema` in `report-writes.ts`.
 * `apps/api/src/telemetry/telemetry.schema.ts` re-exports the helpers below and
 * keeps no copy of either schema.
 */

/** The earliest `at` the at-instant read accepts: the Unix epoch. */
export const MIN_AT_INSTANT_MS = 0;

/** How far past the server's clock an `at` may lie: one day of clock skew. */
export const MAX_AT_INSTANT_LEAD_MS = 86_400_000;

/**
 * `true` when `at` names an instant in `[1970-01-01T00:00:00Z, now + 1 day]`.
 * Parsed with `new Date(at)`, the same parse the controller hands the service,
 * so the bound checks the instant that reaches SQL. Written so `NaN` fails.
 */
export function atInstantIsInRange(at: string, nowMs: number = Date.now()): boolean {
  const ms = new Date(at).getTime();
  return Number.isFinite(ms) && ms >= MIN_AT_INSTANT_MS && ms <= nowMs + MAX_AT_INSTANT_LEAD_MS;
}

/**
 * The one general aggregate read this API has: the query contract for
 * `GET /telemetry/points/:pointRef/aggregate` (`F3.35` Stage A, ADR 0048
 * decision 3).
 *
 * **`windowMinutes` is bounded by `MAX_WIDGET_WINDOW_MINUTES`, the same constant
 * both widget configs use.** The two must agree: the contract is what validates
 * a saved dashboard, and `granularityFor` is what answers it. A contract that
 * admits a longer window than the ladder answers would let a dashboard save
 * successfully and then throw on every read.
 * `tests/f3.35-aggregate-window-bounds.test.ts` holds them equal.
 *
 * **`compare` and `bucketFunction` are a string enum, not `z.coerce.boolean()`.**
 * `coerce.boolean("false")` is `true` — every non-empty string is — so a caller
 * writing `?compare=false` would get a compare window and a delta they asked not
 * to have. `activeFilterSchema` in `admin.schema.ts` already sets this
 * precedent.
 */
export const pointAggregateQuerySchema = z.object({
  windowMinutes: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_WIDGET_WINDOW_MINUTES)
    .default(1_440),
  /** The tile's *vs yesterday* half. Adds the preceding window's scalar statistics. */
  compare: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  /**
   * The chart's half. Naming a function asks for the plotted bucket array;
   * omitting it returns `buckets: null`, so a tile never pays for 2,880 rows.
   */
  bucketFunction: pointAggregateFunctionSchema.optional(),
});

/**
 * `F4.297` (ADR 0108 decision 1.6) — the query contract for
 * `GET /telemetry/points/:pointRef/raw?limit=&before=`: a bounded page size and
 * an optional exclusive upper time bound (the cursor). `before` shares the
 * at-instant range rule, which refuses year 0000 (a Postgres 500) and a far
 * future instant.
 */
export const pointRawQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_RAW_RECORDS_LIMIT)
      .default(DEFAULT_RAW_RECORDS_LIMIT),
    before: z
      .string()
      .datetime({ offset: true })
      .refine((before) => atInstantIsInRange(before), {
        message: "before must lie between 1970-01-01T00:00:00Z and one day after now",
      })
      .describe(
        "An ISO 8601 instant with an explicit offset: only records strictly older than it are " +
          "returned. Omit it for the newest records. Not before 1970-01-01T00:00:00Z and not " +
          "more than one day after the server's clock.",
      )
      .optional(),
  })
  .strict();
