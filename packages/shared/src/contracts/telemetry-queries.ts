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
 * precedent. `bucketStats` (`F4.297`) follows it.
 *
 * **`F4.297` (ADR 0108 decision 1.2) — a custom `from`/`to`.** `windowMinutes`
 * has no `.default` any more, so its absence is detectable: the api's
 * `resolveAggregateRange` applies the one-day default to the trailing form, so
 * a widget request does not change. One `.superRefine` holds the custom-range
 * rules, each a 400: both ends or neither; exclusive with `windowMinutes`; each
 * end inside the at-instant range (no year 0000, no instant past now + 1 day);
 * `to > from`; a span of at most `MAX_WIDGET_WINDOW_MINUTES`. The
 * `.describe(...)` comes AFTER the refinement (ADR 0029 Amendment 1). The
 * schema stays non-strict, as it was.
 */
const MAX_AGGREGATE_SPAN_MS = MAX_WIDGET_WINDOW_MINUTES * 60_000;

function aggregateInstant(name: "from" | "to") {
  return z
    .string()
    .datetime({ offset: true, message: `${name} must be an ISO 8601 instant with an explicit offset` })
    .optional();
}

export const pointAggregateQuerySchema = z
  .object({
    windowMinutes: z.coerce.number().int().positive().max(MAX_WIDGET_WINDOW_MINUTES).optional(),
    /** The start of a custom window (inclusive). Given with `to`, never with `windowMinutes`. */
    from: aggregateInstant("from"),
    /** The end of a custom window (exclusive). Given with `from`, never with `windowMinutes`. */
    to: aggregateInstant("to"),
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
    /**
     * `F4.297` — adds `min`, `average`, `max` and `sampleCount` to every bucket
     * (current and compare). Meaningful only with a `bucketFunction`.
     */
    bucketStats: z
      .enum(["true", "false"], { errorMap: () => ({ message: "bucketStats must be true or false" }) })
      .optional()
      .transform((value) => value === "true"),
  })
  .superRefine((query, ctx) => {
    const { from, to, windowMinutes } = query;
    if (from === undefined && to === undefined) {
      return;
    }
    if (from === undefined || to === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "from and to must be given together" });
      return;
    }
    if (windowMinutes !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "from/to and windowMinutes are exclusive; give one or the other",
      });
      return;
    }
    for (const [name, at] of [
      ["from", from],
      ["to", to],
    ] as const) {
      if (!atInstantIsInRange(at)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: `${name} must lie between 1970-01-01T00:00:00Z and one day after now`,
        });
        return;
      }
    }
    const spanMs = new Date(to).getTime() - new Date(from).getTime();
    if (!(spanMs > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "to must be after from" });
      return;
    }
    if (spanMs > MAX_AGGREGATE_SPAN_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `the from/to span must not exceed ${MAX_WIDGET_WINDOW_MINUTES} minutes`,
      });
    }
  })
  .describe(
    "A trailing window (`windowMinutes`, default 1440, ending now) or a custom window (`from` " +
      "and `to`, ISO 8601 with an offset, both or neither, never with `windowMinutes`). Each " +
      "end lies between 1970-01-01T00:00:00Z and one day after now, `to` is after `from`, and " +
      `the span is at most ${MAX_WIDGET_WINDOW_MINUTES} minutes. \`compare\` adds the equal ` +
      "period that ends at the window's start; `bucketFunction` asks for the plotted buckets and " +
      "`bucketStats` adds min, average, max and sample count to each.",
  );

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
