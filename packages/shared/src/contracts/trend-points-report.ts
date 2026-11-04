import { z } from "zod";

import { CATALOG_CODE_PATTERN } from "../constants";
import { MAX_WIDGET_POINTS } from "./dashboard-builder";

/**
 * `F4.303` U10 (ADR 0108 Amendment 6 items 6 and 8) — the second report template and the
 * `params` a schedule carries.
 *
 * `trendPointsReportTemplateSchema` has the shape of `energyReportTemplateSchema`
 * (`operations.ts`) with its own id literal; `reportTemplateIdSchema` (`reports.ts`) is the enum
 * of the two literals' `.value`, never restated.
 *
 * `reportScheduleParamsSchema` is a union of two `.strict()` objects (§4.8: nothing here is
 * `A & B`, so no intersection): `{ compare }` parses as the energy arm only, and
 * `{ points, compare }` as the trend arm only. The service discriminates with `"points" in params`.
 */

export const trendPointsReportTemplateSchema = z.object({
  id: z.literal("trend_points"),
  title: z.string(),
  description: z.string(),
  formats: z.array(z.string()),
  active: z.boolean(),
});

/** An `energy_consumption` schedule's params: compare the cadence period with the one before. */
export const energyReportParamsSchema = z.object({ compare: z.boolean() }).strict();

/** One `(asset, point)` pair of a `trend_points` schedule. */
export const trendPointsReportPointSchema = z
  .object({
    assetId: z.string().uuid(),
    pointKey: z.string().regex(CATALOG_CODE_PATTERN),
  })
  .strict();

/** A `trend_points` schedule's params: 1 to {@link MAX_WIDGET_POINTS} pairs and the compare flag. */
export const trendPointsReportParamsSchema = z
  .object({
    points: z.array(trendPointsReportPointSchema).min(1).max(MAX_WIDGET_POINTS),
    compare: z.boolean(),
  })
  .strict();

export const reportScheduleParamsSchema = z.union([energyReportParamsSchema, trendPointsReportParamsSchema]);
