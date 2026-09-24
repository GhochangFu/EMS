import { MAX_WIDGET_WINDOW_MINUTES, pointAggregateFunctionSchema } from "@bms/shared";
import { z } from "zod";

import { foldRepeatedQueryValue } from "../auth/asset-scope.schema";

/**
 * `F3.35` Stage A (ADR 0048 decision 3) — the query contract for
 * `GET /telemetry/points/:pointRef/aggregate`.
 *
 * In a `*.schema.ts` and never in the controller: ADR 0029 / `F4.20` found
 * `statusQuerySchema` inside a controller, where the OpenAPI registry could not
 * see it, and `tests/adr-0029-openapi-contract.test.ts` now scans controller
 * files for exactly this declaration.
 */

/**
 * The one general aggregate read this API has.
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

export type PointAggregateQuery = z.infer<typeof pointAggregateQuerySchema>;

/** The most refs one `GET /telemetry/points/at-instant` call may name. */
export const MAX_AT_INSTANT_REFS = 50;

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
 * `F3.28` (ADR 0074 decision 2 / plan decision 2) — the query contract for
 * `GET /telemetry/points/at-instant?at=<ISO offset>&refs=<ref>&refs=<ref>`.
 *
 * **`refs` is folded the way `assetIdsQueryField` folds a repeated asset-scope
 * parameter** (`../auth/asset-scope.schema.ts`), for the identical reason:
 * Nest hands a bare string for one occurrence and an array for more than one,
 * and past 20 occurrences `qs`'s default `arrayLimit` turns the value into an
 * index-keyed object instead. Only `foldRepeatedQueryValue`'s exact overflow
 * shape folds back into an array; any other object reaches `z.array` as an
 * object and is refused.
 *
 * **`at` requires an explicit offset.** `z.string().datetime()` without
 * `{ offset: true }` accepts only a bare `Z`, and a caller's local offset
 * (`+02:00`) would be a 400 for no reason this route needs — the "prior
 * instant" it feeds is always compared against stored UTC timestamps, so any
 * valid offset resolves to the same instant.
 *
 * **`at` is bounded to `[1970-01-01T00:00:00Z, now + 1 day]`.** The datetime
 * format admits year `0000`, which Postgres refuses as a `timestamptz` — a 500
 * where the caller made an ordinary mistake. Refused here as a 400 instead.
 */
export const pointValuesAtQuerySchema = z
  .object({
    at: z
      .string()
      .datetime({ offset: true })
      .refine((at) => atInstantIsInRange(at), {
        message: "at must lie between 1970-01-01T00:00:00Z and one day after now",
      })
      .describe(
        "An ISO 8601 instant with an explicit offset, not before 1970-01-01T00:00:00Z and " +
          "not more than one day after the server's clock.",
      ),
    refs: z.preprocess(foldRepeatedQueryValue, z.array(z.string()).min(1).max(MAX_AT_INSTANT_REFS)),
  })
  .strict();

export type PointValuesAtQuery = z.infer<typeof pointValuesAtQuerySchema>;
