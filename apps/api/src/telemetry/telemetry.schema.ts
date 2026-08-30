import { MAX_WIDGET_WINDOW_MINUTES, pointAggregateFunctionSchema } from "@bms/shared";
import { z } from "zod";

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
