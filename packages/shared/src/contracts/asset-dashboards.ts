import { z } from "zod";

import { templateWidgetResolutionDtoSchema } from "./dashboard-templates";

/**
 * `F3.2` / [ADR 0067](../../../../docs/adr/0067-per-asset-default-dashboards.md)
 * decisions 3 and 5 — the report each per-asset default-dashboard view carries,
 * and the on-demand backfill's response.
 *
 * `admin.ts` is 950 lines (its own docblock records why new content goes in a
 * new file); this file holds the dashboard-instantiation report shapes and
 * imports `templateWidgetResolutionDtoSchema` from `dashboard-templates.ts`
 * rather than restating it — a template widget has no key of its own, so the
 * per-widget resolution is reported the same way ADR 0049's is, keyed
 * `"<view>#<index>"` (decision 5, plan §12 Q2).
 */

/**
 * One view of an asset template's `content.dashboards` instantiated for one
 * asset. `.readonly()` — nothing mutates a report, the
 * `templateWidgetResolutionDtoSchema` precedent.
 */
export const instantiatedDashboardDtoSchema = z
  .object({
    slug: z.string(),
    view: z.string(),
    widgetCount: z.number().int(),
    boundPoints: z.number().int(),
    /** How many `featured` keys were dropped by the `MAX_DASHBOARD_WIDGETS`
     * fallback cap — a view-level cut, distinct from a per-widget `truncated`
     * (decision 3, decision 5; plan §12 Q3). */
    omittedFeatured: z.number().int().min(0),
    resolutions: z.array(templateWidgetResolutionDtoSchema),
  })
  .readonly();

/** Whether the backfill wrote a fresh set of dashboards for an asset, or found
 * one already stamped from this template's version set and left it alone. */
export const defaultDashboardsBackfillOutcomeSchema = z.enum([
  "created",
  "skipped_existing",
]);

export const defaultDashboardsBackfillAssetDtoSchema = z.object({
  assetId: z.string().uuid(),
  code: z.string(),
  outcome: defaultDashboardsBackfillOutcomeSchema,
  dashboards: z.array(instantiatedDashboardDtoSchema),
});

/** The response of `POST /admin/asset-templates/:id/default-dashboards`
 * (decision 4, decision 5). */
export const defaultDashboardsBackfillResultDtoSchema = z.object({
  templateId: z.string().uuid(),
  templateCode: z.string(),
  templateVersion: z.number().int(),
  assets: z.array(defaultDashboardsBackfillAssetDtoSchema),
  createdCount: z.number().int(),
  skippedCount: z.number().int(),
});
