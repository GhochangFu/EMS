import { z } from "zod";

import { dashboardTabKeySchema } from "./dashboard-tabs";

/**
 * `F4.305` / ADR 0108 Amendment 3 — the `trend_strip` dashboard widget.
 *
 * Its height in grid rows, one number read by the stock template, the seed's v5 step and the
 * widget picker's `defaultSize`.
 */
export const TREND_STRIP_WIDGET_ROWS = 4;

/**
 * The three default ranges. Declared here rather than imported from `./trend-strip`: that module
 * reaches `dashboard-builder` through `envelopes`, and `dashboard-builder` imports this file, so
 * the import would be a cycle. `trend-strip-widget.spec.ts` holds this list equal to
 * `trendStripRangeSchema`.
 */
const widgetRangeSchema = z.enum(["24h", "7d", "30d"]);

/**
 * Stored config (owner answer 2026-11-01, call C1): `tabKey` names a tab of the same dashboard
 * whose bound asset group scopes the strip; absent means the whole site. `defaultRange` is
 * required, so a stored config is canonical and the seed chain's JSON comparison is stable.
 * A plain `z.object`: the write side composes `.strict()` through `bindsNothingArm`.
 */
export const trendStripWidgetConfigSchema = z.object({
  // `.describe()` AFTER the shared refinement (ADR 0029 decision 10), as
  // `moduleSummaryCardConfigSchema.targetTabKey` does: the document emits nothing for the
  // reserved-key refusal.
  tabKey: dashboardTabKeySchema
    .describe(
      "The key of a tab of the same dashboard whose asset group scopes the strip: lowercase " +
        "letters, digits and hyphens, 1 to 64 characters. `assets` is reserved. Absent means " +
        "the whole site.",
    )
    .optional(),
  defaultRange: widgetRangeSchema,
});
