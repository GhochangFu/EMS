import { MAX_WIDGET_WINDOW_MINUTES } from "@bms/shared";
import { z } from "zod";

/**
 * `E1.3` (ADR 0050 + Amendment 1) — the query contracts for the two health
 * reads.
 *
 * In a `*.schema.ts` and never in the controller, for the reason
 * `telemetry.schema.ts` records: ADR 0029 / `F4.20` found `statusQuerySchema`
 * declared inside a controller where the OpenAPI registry could not see it, and
 * `tests/adr-0029-openapi-contract.test.ts` now scans controller files for
 * exactly that.
 *
 * **`windowMinutes` is bounded by `MAX_WIDGET_WINDOW_MINUTES`, the same
 * constant `pointAggregateQuerySchema` uses**, and imported rather than
 * restated. ADR 0050 decision 6 says the health read reuses `F3.35`'s ladder and
 * does not declare a second one; a second bound would be the first step towards
 * a second ladder, and the symptom would be a health figure and a trend chart
 * covering different windows while both looked right.
 */
export const assetHealthQuerySchema = z.object({
  windowMinutes: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_WIDGET_WINDOW_MINUTES)
    .default(1_440),
});

export type AssetHealthQuery = z.infer<typeof assetHealthQuerySchema>;

/**
 * The summary adds an optional location filter — the plant tier of
 * `asset → plant → enterprise`. Omitting it is the enterprise donut.
 *
 * **There is no `organizationId` parameter, deliberately.** The caller's
 * readable scope decides which assets are counted, and a parameter would invite
 * a caller to name an organization they cannot read — which the guard would
 * then have to refuse, turning an authorization boundary into an input
 * validation problem.
 */
export const healthSummaryQuerySchema = assetHealthQuerySchema.extend({
  locationId: z.string().uuid().optional(),
});

export type HealthSummaryQuery = z.infer<typeof healthSummaryQuerySchema>;
