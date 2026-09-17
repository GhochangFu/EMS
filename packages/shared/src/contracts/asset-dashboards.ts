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

/**
 * What the backfill did with one asset.
 *
 * - `created` — it wrote this version's dashboards.
 * - `skipped_existing` — the asset already carries a dashboard stamped from
 *   this template's version set, so it was left alone (decision 4).
 * - `skipped_slug_conflict` — a dashboard slug this asset needs is already
 *   taken in the organization, so **that asset alone** was rolled back to the
 *   savepoint it was written in and the call carried on (Q8, ruled
 *   2026-09-17). A third member rather than a second meaning on
 *   `skipped_existing`: the two states need different operator actions — one
 *   is normal, the other asks a human to rename a hand-made dashboard — and a
 *   count that mixed them could not be read at all.
 */
export const defaultDashboardsBackfillOutcomeSchema = z.enum([
  "created",
  "skipped_existing",
  "skipped_slug_conflict",
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
  /** Assets left alone because they are already stamped — `skipped_existing`
   * only. A slug collision is counted by {@link conflictCount} instead, so the
   * three counts partition the asset list rather than overlapping. */
  skippedCount: z.number().int(),
  /** Assets whose write was rolled back to its savepoint because a slug it
   * needs is taken — `skipped_slug_conflict` (Q8). */
  conflictCount: z.number().int(),
});
