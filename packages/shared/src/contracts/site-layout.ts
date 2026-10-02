import { z } from "zod";

import { dashboardTabKeySchema } from "./dashboard-tabs";
import { templateWidgetResolutionDtoSchema } from "./dashboard-templates";

/**
 * `F3.73` plan D6 (rulings Q3a, Q4, Q4b) — the answers of the site-layout copy action:
 * `POST /admin/locations/:id/site-layout`, the site arm of
 * `POST /admin/dashboard-templates/:id/instantiate`, and the bulk
 * `POST /admin/dashboard-templates/:id/apply-to-sites`.
 *
 * Plain `z.object` throughout: there is no shared base to compose from (ADR 0030).
 */

/** How a kept tab got its group — the planner's `SiteLayoutResolvedVia` (plan D5). */
export const siteLayoutResolvedViaSchema = z.enum(["overview", "choice", "group_code", "single"]);

/** One kept tab of the copy: the group it binds, how, and what became of each widget. */
export const siteLayoutTabResolutionSchema = z.object({
  tabKey: dashboardTabKeySchema,
  assetGroupId: z.string().uuid().nullable(),
  via: siteLayoutResolvedViaSchema,
  widgets: z.array(templateWidgetResolutionDtoSchema),
});

/** A template tab the site cannot hold: no group of its domain. */
export const siteLayoutOmittedTabSchema = z.object({
  tabKey: dashboardTabKeySchema,
  domain: z.string(),
});

/**
 * An Overview card removed because the tab it opens was omitted. `F3.74` — also an Overview mimic
 * removed because the tab its `config.tabKey` names was omitted; `targetTabKey` then holds that
 * `tabKey`.
 */
export const siteLayoutDroppedCardSchema = z.object({
  tabKey: dashboardTabKeySchema,
  widgetKey: z.string(),
  targetTabKey: dashboardTabKeySchema,
});

/**
 * A role-bound value tile left out of a kept tab because it bound no point at the site
 * (`isUnboundRoleTile`). It has no `resolution` row, so the answer names it here: ADR 0049
 * Amendment 2 decision 1 reports every widget of a copy.
 */
export const siteLayoutOmittedTileSchema = z.object({
  tabKey: dashboardTabKeySchema,
  widgetKey: z.string(),
});

/** The copy one site received. */
export const siteLayoutResultDtoSchema = z.object({
  locationId: z.string().uuid(),
  dashboardId: z.string().uuid(),
  dashboardSlug: z.string(),
  omittedTabs: z.array(siteLayoutOmittedTabSchema),
  droppedCards: z.array(siteLayoutDroppedCardSchema),
  omittedTiles: z.array(siteLayoutOmittedTileSchema),
  resolution: z.array(siteLayoutTabResolutionSchema),
});

/** One group an administrator may pick for an ambiguous tab. */
export const siteLayoutCandidateSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
});

export const siteLayoutAmbiguousTabSchema = z.object({
  tabKey: dashboardTabKeySchema,
  domain: z.string(),
  candidates: z.array(siteLayoutCandidateSchema),
});

/**
 * The 409 body of the per-site action when two or more untaken groups of one domain remain
 * for a tab. It carries the candidates, so the web's picker needs no second read (plan D10).
 */
export const siteLayoutAmbiguousDtoSchema = z.object({
  message: z.string(),
  ambiguous: z.array(siteLayoutAmbiguousTabSchema),
});

/** Why the bulk action skipped a site. */
export const siteLayoutSkipReasonSchema = z.enum(["has_view", "ambiguous", "no_assets", "slug_taken"]);

/** The bulk action's answer: one transaction per site, so `made` stays made past a skip. */
export const siteLayoutBulkResultDtoSchema = z.object({
  made: z.array(siteLayoutResultDtoSchema),
  skipped: z.array(
    z.object({
      locationId: z.string().uuid(),
      reason: siteLayoutSkipReasonSchema,
      ambiguous: z.array(siteLayoutAmbiguousTabSchema).optional(),
    }),
  ),
});

/** `dashboards.slug` is `varchar(64)`; the prefix takes 12 of it. */
const SITE_LAYOUT_SLUG_MAX = 64;
export const SITE_LAYOUT_SLUG_PREFIX = "site-layout-";

/**
 * The slug of a site's copy: `site-layout-<location slug>`, the one rule the API action and the
 * seed (`packages/db/src/site-layout-seed.ts`) share, so each finds the other's copy. A location
 * slug longer than the 52 characters left is cut, and a trailing hyphen dropped. Two long slugs
 * that share their first 52 characters then meet on one dashboard slug, and the second site's
 * action answers `409 SITE_LAYOUT_SLUG_TAKEN_MESSAGE` rather than a 500.
 */
export function siteLayoutDashboardSlug(locationSlug: string): string {
  const room = SITE_LAYOUT_SLUG_MAX - SITE_LAYOUT_SLUG_PREFIX.length;
  return `${SITE_LAYOUT_SLUG_PREFIX}${locationSlug.slice(0, room).replace(/-+$/, "")}`;
}
