import { z } from "zod";

import { CATALOG_CODE_PATTERN } from "../constants";

import { dashboardTabKeySchema } from "./dashboard-tabs";

/**
 * `F4.306` / ADR 0108 Amendment 7 — the most points one strip may select. Thirty points of at
 * most `TREND_STRIP_MAX_ASSETS_PER_POINT` (6) assets each is `TREND_STRIP_MAX_SERIES` (180); the
 * spec holds that product. Not imported from `./trend-strip`: the cycle noted below.
 */
export const TREND_STRIP_WIDGET_MAX_POINTS = 30;

/** The longest `asset_domains.code` (`varchar(64)`), the segment half of a selection. */
export const TREND_STRIP_SEGMENT_CODE_MAX = 64;

/** The longest `point_keys.code` (`varchar(128)`), the point half of a selection. */
export const TREND_STRIP_POINT_CODE_MAX = 128;

/** The eight series colour roles a selected point may draw in (ADR 0078 Amendment 4). */
export const seriesRoleSchema = z.enum([
  "series-1",
  "series-2",
  "series-3",
  "series-4",
  "series-5",
  "series-6",
  "series-7",
  "series-8",
]);
export const SERIES_ROLE_NAMES = seriesRoleSchema.options;

/**
 * `F4.323` PR 3 / ADR 0108 Amendment 8 — how a selected point's sparkline is drawn. Absent means
 * `line`, today's look.
 */
export const trendStripPointStyleSchema = z.enum(["line", "area", "bar"]);
export const TREND_STRIP_POINT_STYLES = trendStripPointStyleSchema.options;

/** `CATALOG_CODE_PATTERN` without its anchors, so the selection patterns restate nothing. */
const CODE = CATALOG_CODE_PATTERN.source.slice(1, -1);

/** One selected point: `<segment code>:<point code>`, each half a catalog code. */
export const pointSelectionPattern = new RegExp(`^${CODE}:${CODE}$`);

const segmentCodeSchema = z.string().min(1).max(TREND_STRIP_SEGMENT_CODE_MAX).regex(CATALOG_CODE_PATTERN);

const pointSelectionSchema = z
  .string()
  .max(TREND_STRIP_SEGMENT_CODE_MAX + 1 + TREND_STRIP_POINT_CODE_MAX)
  .regex(pointSelectionPattern);

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
  // `F4.306` / ADR 0108 Amendment 7 — the selection, all three optional: a config without them
  // is exactly the `F4.305` config. No refinement here (the arm must stay a plain `ZodObject`):
  // a repeat, a point outside `segments`, a point off its list and a `colors` key outside
  // `points` are the write path's check against the organization's lists.
  segments: z
    .array(segmentCodeSchema)
    .min(1)
    .max(TREND_STRIP_WIDGET_MAX_POINTS)
    .describe("The segment (asset domain) codes the strip draws, in order; absent means every segment.")
    .optional(),
  points: z
    .array(pointSelectionSchema)
    .min(1)
    .max(TREND_STRIP_WIDGET_MAX_POINTS)
    .describe(
      "The points the strip draws, each `<segment>:<point code>` on its segment's trend-point " +
        "list, at most 30; absent means each chosen segment's default points.",
    )
    .optional(),
  colors: z
    .record(pointSelectionSchema, seriesRoleSchema)
    .describe("A series colour role per selected point, keyed `<segment>:<point code>`.")
    .optional(),
  // `F4.323` PR 3 / ADR 0108 Amendment 8 — stored like `colors`; a key outside `points` is the
  // write path's check, as for `colors`.
  styles: z
    .record(pointSelectionSchema, trendStripPointStyleSchema)
    .describe("A draw style per selected point (line, area or bar), keyed `<segment>:<point code>`; absent is line.")
    .optional(),
});
