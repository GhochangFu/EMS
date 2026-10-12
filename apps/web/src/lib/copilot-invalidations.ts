import type { QueryKey } from "@tanstack/react-query";

/**
 * `F3.85` PR 8 (plan §10.3) — the query keys a confirmed copilot change makes
 * stale, by catalog entry. Each key is a prefix: TanStack Query invalidates
 * every query that starts with it, so `["dashboards"]` reaches the list, the
 * detail, the control-room list and the mimic nodes alike.
 *
 * An entry with no row here invalidates nothing; `copilot-card-logic.spec.ts`
 * requires a row for every catalog entry, so a new entry cannot ship without
 * one.
 */
const DASHBOARDS: QueryKey = ["dashboards"];
const TEMPLATES: QueryKey = ["admin", "dashboard-templates"];
const TEMPLATE: QueryKey = ["admin", "dashboard-template"];
const CALC_PARAMETERS: QueryKey = ["admin", "calc-parameters"];
const ASSET_CALC_POINTS: QueryKey = ["admin", "asset-calc-points"];
const ASSET_GROUPS: QueryKey = ["admin", "asset-groups"];
// The pair `asset-template-detail-page.tsx`'s own `afterChange` invalidates.
const ASSET_TEMPLATES: QueryKey = ["admin", "asset-templates"];
const ASSET_TEMPLATE: QueryKey = ["admin", "asset-template"];
// `F3.86` PR 4: the users list, and by prefix each user's grants (`api/admin/users.ts`).
const USERS: QueryKey = ["admin", "users"];

const BY_ENTRY: Readonly<Record<string, readonly QueryKey[]>> = {
  "dashboard.create": [DASHBOARDS],
  "dashboard.update": [DASHBOARDS],
  "dashboard.widgets.replace": [DASHBOARDS],
  "dashboardTemplate.create": [TEMPLATES],
  "dashboardTemplate.update": [TEMPLATES, TEMPLATE],
  "dashboardTemplate.publish": [TEMPLATES, TEMPLATE],
  "dashboardTemplate.archive": [TEMPLATES, TEMPLATE],
  "dashboardTemplate.draft": [TEMPLATES, TEMPLATE],
  // Instantiating makes dashboards; a site layout also makes asset groups.
  "dashboardTemplate.instantiate": [TEMPLATES, TEMPLATE, DASHBOARDS, ASSET_GROUPS],
  "dashboardTemplate.importStock": [TEMPLATES],
  "dashboardTemplate.applyToSites": [TEMPLATES, TEMPLATE, DASHBOARDS, ASSET_GROUPS],
  "calcParameter.create": [CALC_PARAMETERS],
  "calcParameter.update": [CALC_PARAMETERS],
  "calcOverride.set": [ASSET_CALC_POINTS],
  "assetTemplate.update": [ASSET_TEMPLATES, ASSET_TEMPLATE],
  "assetTemplate.publish": [ASSET_TEMPLATES, ASSET_TEMPLATE],
  "user.create": [USERS],
  "user.update": [USERS],
  "user.deactivate": [USERS],
  "user.reactivate": [USERS],
  "userGrant.add": [USERS],
  "userGrant.remove": [USERS],
};

/** The query-key prefixes to invalidate after the change `catalogId` is applied. */
export function invalidationKeysFor(catalogId: string): readonly QueryKey[] {
  return BY_ENTRY[catalogId] ?? [];
}

/** The catalog entries this file names (for its spec). */
export const INVALIDATED_ENTRIES: readonly string[] = Object.keys(BY_ENTRY);
