import { z } from "zod";

import type { SiteLayoutChoiceRefusal } from "../site-layout-planner";

/**
 * `F3.73` plan D6 — the site-layout copy action's request body and its refusal sentences.
 *
 * The body of `POST /admin/locations/:id/site-layout`. `.strict()`: both keys are optional, so a
 * misspelt `tabGroup` dropped silently would run the action with no choice at all and answer 409
 * `ambiguous` for a reason the caller cannot see. `tabGroups` maps a template tab key (the
 * `dashboard_tabs.tab_key` shape) to an asset group id; `templateId` absent means the
 * organization's newest published site template (OQ4).
 */
export const siteLayoutBodySchema = z
  .object({
    tabGroups: z.record(z.string().regex(/^[a-z0-9-]{1,64}$/), z.string().uuid()).optional(),
    templateId: z.string().uuid().optional(),
  })
  .strict();

export type SiteLayoutBody = z.infer<typeof siteLayoutBodySchema>;

/** 409 — the site already has a view row that is not a removed copy (ruling Q4). */
export const SITE_HAS_VIEW_MESSAGE =
  "This site already has a Control Room view; a site layout never replaces a built-in view or an existing copy";

/** 409 — no `templateId` and the organization holds no published site template (OQ4). */
export const NO_SITE_TEMPLATE_MESSAGE =
  "This organization has no published site template to copy; publish one first";

/** 409 — another dashboard of the organization already holds the copy's slug. */
export const SITE_LAYOUT_SLUG_TAKEN_MESSAGE =
  "A dashboard with this site's layout slug already exists in this organization; rename or delete it first";

/** 409 — two or more untaken groups of one domain remain for a tab; the body lists them. */
export const SITE_LAYOUT_AMBIGUOUS_MESSAGE =
  "More than one asset group at this site fits a tab; choose one per tab in tabGroups";

/** 409 — the site holds no active asset, so every domain tab would be omitted. */
export const SITE_HAS_NO_ASSETS_MESSAGE =
  "This site has no active assets; a site layout needs at least one to copy a domain tab";

/** 404 — the template is not a published site template of the site's organization. */
export const SITE_TEMPLATE_NOT_FOUND_MESSAGE = "Site template not found for this site's organization";

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decision 2) — 409: Replace rebuilds a template copy only.
 * A site with no view, a built-in or generated view, a removed copy or a dashboard with no site
 * template stamp answers this.
 */
export const SITE_HAS_NO_COPY_MESSAGE =
  "This site holds no site-template copy to replace; use Make site layout, or change the Control Room view";

/** 409 (decision 5) — Replace never crosses template codes; delete the copy and Make instead. */
export const SITE_COPY_OTHER_TEMPLATE_MESSAGE =
  "This site's copy was made from another site template; Replace only rebuilds a copy of the same template";

/**
 * 409 (decision 5) — a per-site Replace with no `templateId` uses the newest published version of
 * the copy's own template code, and that code has none (every version is a draft or archived).
 * Not `NO_SITE_TEMPLATE_MESSAGE`: the organization may well hold other published site templates.
 */
export const COPY_TEMPLATE_NOT_PUBLISHED_MESSAGE =
  "The template this site's copy was made from has no published version; publish one, or name a template";

/**
 * 400 — one sentence per planner refusal (`SITE_LAYOUT_CHOICE_REFUSALS`). None echoes the tab key
 * or the group id the caller sent: an id of another organization's group reads exactly as an id
 * that exists nowhere (`unknown_group`).
 */
export const SITE_LAYOUT_CHOICE_MESSAGES: Readonly<Record<SiteLayoutChoiceRefusal, string>> = {
  unknown_tab: "tabGroups names a tab this site template does not have",
  overview_tab: "tabGroups names the Overview tab, which binds no asset group",
  unknown_group: "tabGroups names an asset group that is not at this site",
  wrong_domain: "tabGroups names an asset group of another domain than its tab",
  taken: "tabGroups names one asset group for two tabs",
};
