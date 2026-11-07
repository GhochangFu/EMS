import { z } from "zod";

import { dashboardTabKeySchema } from "./dashboard-tabs";
import { templateWidgetResolutionDtoSchema } from "./dashboard-templates";

/**
 * `F3.73` plan D6 (rulings Q3a, Q4, Q4b) — the answers of the site-layout copy action:
 * `POST /admin/locations/:id/site-layout`, the site arm of
 * `POST /admin/dashboard-templates/:id/instantiate`, and the bulk
 * `POST /admin/dashboard-templates/:id/apply-to-sites`.
 *
 * Plain `z.object` throughout: there is no shared base to compose from (ADR 0030). `F4.320` PR 2
 * adds the Replace answers, the one place a base exists: the replace result is a
 * `z.intersection` of the make result (ADR 0030, AGENTS.md §4.8).
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

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decisions 3 and 7) — what one site's Replace answers: the
 * make answer of the rebuilt copy (a new `dashboardId`, the same `dashboardSlug`), the version it
 * now holds, and the copy it replaced. The previous ids are the ones the replace audit row carries.
 */
export const siteLayoutReplaceResultDtoSchema = z.intersection(
  siteLayoutResultDtoSchema,
  z.object({
    templateId: z.string().uuid(),
    version: z.number().int(),
    previousDashboardId: z.string().uuid(),
    previousTemplateId: z.string().uuid(),
    previousVersion: z.number().int(),
  }),
);

/**
 * `F4.320` PR 2 (decision 5) — why the bulk Replace left a site as it was: `no_copy` (no template
 * copy: no view row, a builtin or generated view, a removed copy, or a dashboard without a site
 * template stamp), `other_template` (a copy of another template code), `same_version` (the copy
 * already holds this version), `newer_version` (the copy holds a newer version than this one: the
 * bulk Replace replaces only an older copy, owner ruling 2026-11-07), plus the make skips
 * `ambiguous`, `no_assets` and `slug_taken`.
 *
 * Built from the make vocabulary (AGENTS.md §4.8: declared once, derived elsewhere): the make
 * skips minus `has_view`, which Replace reports as `no_copy`, plus the Replace-only reasons.
 */
export const siteLayoutReplaceSkipReasonSchema = z.enum([
  "no_copy",
  "other_template",
  "same_version",
  "newer_version",
  ...siteLayoutSkipReasonSchema.exclude(["has_view"]).options,
]);

/** The bulk Replace's answer: one transaction per site, so `replaced` stays replaced past a skip. */
export const siteLayoutBulkReplaceResultDtoSchema = z.object({
  replaced: z.array(siteLayoutReplaceResultDtoSchema),
  skipped: z.array(
    z.object({
      locationId: z.string().uuid(),
      reason: siteLayoutReplaceSkipReasonSchema,
      ambiguous: z.array(siteLayoutAmbiguousTabSchema).optional(),
    }),
  ),
});

/**
 * `F4.320` PR 2 (decision 9) — the edit flag of one copy: the count of `entity_type = 'dashboard'`
 * audit rows on the copy's dashboard id, and the time of the newest. `lastEditedBy` is the newest
 * row's actor email, present only for a caller who may read the audit log (`admin`,
 * `organization_admin`) and absent for a `location_admin`; `null` when there is no edit or the
 * actor is unknown. Advice only: Replace never refuses an edited copy.
 */
export const siteLayoutCopyEditsSchema = z.object({
  count: z.number().int().nonnegative(),
  lastEditedAt: z.string().datetime({ offset: true }).nullable(),
  lastEditedBy: z.string().nullable().optional(),
});

/** The template copy a site holds now: its dashboard and the version stamped on it. */
export const siteLayoutHeldCopySchema = z.object({
  dashboardId: z.string().uuid(),
  templateId: z.string().uuid(),
  templateCode: z.string(),
  version: z.number().int(),
});

/**
 * What Replace would do at the site: `replace`, or the copy-level reason it would not (the first
 * four of `siteLayoutReplaceSkipReasonSchema`). A group or slug refusal is known only when the
 * Replace runs, so the preview never answers `ambiguous`, `no_assets` or `slug_taken`. Derived
 * with `.extract()` from the skip vocabulary, so the copy-level reasons are not restated.
 */
export const siteLayoutReplaceOutcomeSchema = z.enum([
  "replace",
  ...siteLayoutReplaceSkipReasonSchema.extract(["no_copy", "other_template", "same_version", "newer_version"]).options,
]);

/** One site of the preview. `held` and `edits` are `null` when the site holds no template copy. */
export const siteLayoutReplacePreviewSiteSchema = z.object({
  locationId: z.string().uuid(),
  locationName: z.string(),
  held: siteLayoutHeldCopySchema.nullable(),
  outcome: siteLayoutReplaceOutcomeSchema,
  edits: siteLayoutCopyEditsSchema.nullable(),
});

/**
 * `F4.320` PR 2 (decisions 8 and 9) — the read the confirm step runs before a Replace: the
 * version Replace would copy and, per site, the copy held, the outcome and the edit flag. The
 * per-site read answers one site; the bulk read answers every active site of the organization.
 */
export const siteLayoutReplacePreviewDtoSchema = z.object({
  templateId: z.string().uuid(),
  templateCode: z.string(),
  version: z.number().int(),
  sites: z.array(siteLayoutReplacePreviewSiteSchema),
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
