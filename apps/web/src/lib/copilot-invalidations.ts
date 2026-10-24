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
// `F3.86` PR 3d: the locations page (and the stored view setting, keyed under it) and the site
// page's resolve read (`site-page.tsx`).
const LOCATIONS: QueryKey = ["admin", "locations"];
const SITE_VIEW: QueryKey = ["control-room", "site-view"];
// `F3.86` PR 3c: the point-key page and the two pickers that list the catalog.
const POINT_KEYS: QueryKey = ["admin", "point-keys"];
// `F3.86` PR 3a: the summaries the breadcrumb and the RTU and asset pages name (`admin-breadcrumb.tsx`),
// and the RTU lists (`rtus-page.tsx`, `hierarchy-filter-bar.tsx`, `assets-page.tsx`).
const LOCATION_SUMMARY: QueryKey = ["admin", "location-summary"];
const RTUS: QueryKey = ["admin", "rtus"];
const RTU_SUMMARY: QueryKey = ["admin", "rtu-summary"];
// `F3.86` PR 3b: the asset lists (`assets-page.tsx`, `hierarchy-filter-bar.tsx`), the summary the
// breadcrumb and the points page name (`admin-breadcrumb.tsx`, `asset-points-page.tsx`), and the
// point mappings (`asset-points-page.tsx`, `point-picker.tsx`'s `dashboard-scope` read under it).
const ASSETS: QueryKey = ["admin", "assets"];
const ASSET_SUMMARY: QueryKey = ["admin", "asset-summary"];
const ASSET_POINTS: QueryKey = ["admin", "asset-points"];
// `F3.87` PR 5: the layout list and, under the same prefix, each layout the editor reads.
const MIMIC_LAYOUTS: QueryKey = ["mimic-layouts"];
// `F3.87` PR 6b: the symbol catalog of every organization (`use-mimic-symbol-libraries.ts`, a prefix), and
// the vocabularies read (`api/vocabularies.ts`) the layout editor's role picker lists.
const MIMIC_SYMBOL_LIBRARIES: QueryKey = ["mimic-symbol-libraries"];
const VOCABULARIES: QueryKey = ["vocabularies"];
// `F4.282` (Amendment 8 Q17): the location-type dropdown (`GET /admin/location-types`) and the two
// vocabulary pages' own reads (`location-types-page.tsx`, `unit-roles-page.tsx`).
const LOCATION_TYPES: QueryKey = ["admin", "location-types"];
const LOCATION_TYPES_CATALOG: QueryKey = ["admin", "location-types-catalog"];
const ASSET_ROLES_CATALOG: QueryKey = ["admin", "asset-roles-catalog"];
/** `F4.278`: the Rule Engine's queries — the list, the executions and the builder catalog (`rules-panel.tsx`). */
const RULES: QueryKey = ["rules"];
/**
 * `F4.279`: the Channels page and the pickers that list channels (`notification-channels-page.tsx`,
 * `escalation-profiles-page.tsx`, `rule-channels-editor.tsx`), the delivery ledger a test send
 * writes a row to, and the Escalation page's profiles and severity map (keyed by organization under
 * the prefix). A rule's channel set is `["rules", ruleId, "notifications"]`, under `RULES`.
 */
const NOTIFICATION_CHANNELS: QueryKey = ["notifications", "channels"];
const NOTIFICATION_DELIVERIES: QueryKey = ["notifications", "deliveries"];
/** `F4.280`: the Reports page's schedule list and its History list (`REPORT_SCHEDULES_QUERY_KEY`, `REPORT_FILES_QUERY_KEY`). */
const REPORT_SCHEDULES: QueryKey = ["report-schedules"];
const REPORT_FILES: QueryKey = ["report-files"];
/** `F4.281`: the Schedule Centre's list (`maintenance-schedules-panel.tsx`, keyed by its filters under the prefix). */
const MAINTENANCE_SCHEDULES: QueryKey = ["maintenance", "schedules"];
const ESCALATION_PROFILES: QueryKey = ["escalation", "profiles"];
const ESCALATION_DEFAULTS: QueryKey = ["escalation", "defaults"];
// `F4.255` PR 3: the copilot dock's list of an organization's open onboarding drafts.
export const ONBOARDING_DRAFTS: QueryKey = ["admin", "onboarding", "drafts"];

/**
 * `F4.255` (ADR 0099 Amendment 2 A1): the dock's draft list of one organization, or — with no
 * id — of the caller's home organization (the `"home"` segment). {@link ONBOARDING_DRAFTS} is the
 * prefix of both, so one invalidation reaches every list.
 */
export function onboardingDraftsKey(organizationId?: string): QueryKey {
  return [...ONBOARDING_DRAFTS, organizationId ?? "home"];
}

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
  "assetTemplate.create": [ASSET_TEMPLATES],
  "assetTemplate.update": [ASSET_TEMPLATES, ASSET_TEMPLATE],
  "assetTemplate.publish": [ASSET_TEMPLATES, ASSET_TEMPLATE],
  "assetTemplate.archive": [ASSET_TEMPLATES, ASSET_TEMPLATE],
  "assetTemplate.draft": [ASSET_TEMPLATES, ASSET_TEMPLATE],
  // `F4.254` PR 2: the stock list is keyed under ASSET_TEMPLATES too (`["admin", "asset-templates", "stock"]`).
  "assetTemplate.importStock": [ASSET_TEMPLATES],
  // `F4.254` PR 3: instantiating builds assets and their default dashboards (ADR 0067).
  "assetTemplate.instantiate": [ASSETS, ASSET_SUMMARY, DASHBOARDS],
  "user.create": [USERS],
  "user.update": [USERS],
  "user.deactivate": [USERS],
  "user.reactivate": [USERS],
  "userGrant.add": [USERS],
  "userGrant.remove": [USERS],
  "location.create": [LOCATIONS, LOCATION_SUMMARY],
  "location.update": [LOCATIONS, LOCATION_SUMMARY],
  "location.deactivate": [LOCATIONS, LOCATION_SUMMARY],
  "location.reactivate": [LOCATIONS, LOCATION_SUMMARY],
  "rtu.create": [RTUS, RTU_SUMMARY],
  "rtu.update": [RTUS, RTU_SUMMARY],
  "rtu.deactivate": [RTUS, RTU_SUMMARY],
  "rtu.reactivate": [RTUS, RTU_SUMMARY],
  "asset.create": [ASSETS, ASSET_SUMMARY],
  // A rename or move also changes the labels the point rows and a group's members join in
  // (`assetCode`, `assetName`, `locationName`; `assetDomain`).
  "asset.update": [ASSETS, ASSET_SUMMARY, ASSET_POINTS, ASSET_GROUPS],
  "asset.deactivate": [ASSETS, ASSET_SUMMARY, ASSET_POINTS],
  "asset.reactivate": [ASSETS, ASSET_SUMMARY],
  "assetPoint.create": [ASSET_POINTS],
  "assetPoint.update": [ASSET_POINTS],
  "assetPoint.deactivate": [ASSET_POINTS],
  "assetPoint.reactivate": [ASSET_POINTS],
  "location.controlRoomView.set": [LOCATIONS, SITE_VIEW],
  // The copy makes a dashboard, possibly asset groups, and sets the site's view to the copy.
  "location.siteLayout.make": [SITE_VIEW, LOCATIONS, DASHBOARDS, ASSET_GROUPS],
  // `F3.86` PR 3c — `["admin","asset-groups"]` is the prefix of both the
  // group list and a group's members (`api/admin/asset-groups.ts`).
  "assetGroup.create": [ASSET_GROUPS],
  "assetGroup.update": [ASSET_GROUPS],
  "assetGroup.member.add": [ASSET_GROUPS],
  "assetGroup.member.setRole": [ASSET_GROUPS],
  "assetGroup.member.remove": [ASSET_GROUPS],
  "pointKey.create": [POINT_KEYS],
  "pointKey.update": [POINT_KEYS],
  "pointKey.deactivate": [POINT_KEYS],
  "pointKey.reactivate": [POINT_KEYS],
  // `F3.24b` (ADR 0103) — a discovery writes only the draft's `_discovery`, so only the session reads go stale.
  "onboarding.discovery": [["onboarding"]],
  // `F3.86` PR 6 — an onboarding commit creates the site, its RTUs, assets, mappings, groups and templates.
  "onboarding.commit": [
    LOCATIONS,
    ["admin", "rtus"],
    ["admin", "assets"],
    ["admin", "asset-points"],
    ASSET_GROUPS,
    ASSET_TEMPLATES,
    // `F4.255`: the committed session is no longer a draft, so it leaves the dock's list.
    ONBOARDING_DRAFTS,
  ],
  // `F3.87` PR 5: the layout library (`use-mimic-layouts.ts`) and each layout (`mimic-layout-editor-page.tsx`).
  "mimicLayout.create": [MIMIC_LAYOUTS],
  "mimicLayout.replace": [MIMIC_LAYOUTS],
  // `F3.87` PR 6b: the libraries page and every picker that lists an organization's symbols.
  "mimicLibrary.setting": [MIMIC_SYMBOL_LIBRARIES],
  "mimicLibrary.create": [MIMIC_SYMBOL_LIBRARIES],
  "mimicLibrary.update": [MIMIC_SYMBOL_LIBRARIES],
  "mimicSymbol.update": [MIMIC_SYMBOL_LIBRARIES],
  "mimicSymbol.upload": [MIMIC_SYMBOL_LIBRARIES],
  "assetRole.create": [VOCABULARIES, ASSET_ROLES_CATALOG],
  "assetRole.update": [VOCABULARIES, ASSET_ROLES_CATALOG],
  "assetRole.deactivate": [VOCABULARIES, ASSET_ROLES_CATALOG],
  "assetRole.reactivate": [VOCABULARIES, ASSET_ROLES_CATALOG],
  "locationType.create": [LOCATION_TYPES, LOCATION_TYPES_CATALOG],
  "locationType.update": [LOCATION_TYPES, LOCATION_TYPES_CATALOG],
  "locationType.deactivate": [LOCATION_TYPES, LOCATION_TYPES_CATALOG],
  "locationType.reactivate": [LOCATION_TYPES, LOCATION_TYPES_CATALOG],
  // `F4.278` (Amendment 8): the alarm rules.
  "rule.create": [RULES],
  "rule.update": [RULES],
  "rule.duplicate": [RULES],
  "rule.publish": [RULES],
  "rule.enable": [RULES],
  "rule.disable": [RULES],
  "rule.archive": [RULES],
  // `F4.279` (Amendment 8): notification channels, escalation, and the rule channel set.
  "notificationChannel.create": [NOTIFICATION_CHANNELS, NOTIFICATION_DELIVERIES],
  "notificationChannel.update": [NOTIFICATION_CHANNELS, NOTIFICATION_DELIVERIES],
  "notificationChannel.deactivate": [NOTIFICATION_CHANNELS, NOTIFICATION_DELIVERIES],
  "notificationChannel.reactivate": [NOTIFICATION_CHANNELS, NOTIFICATION_DELIVERIES],
  "notificationChannel.test": [NOTIFICATION_CHANNELS, NOTIFICATION_DELIVERIES],
  "escalationProfile.create": [ESCALATION_PROFILES, ESCALATION_DEFAULTS],
  "escalationProfile.update": [ESCALATION_PROFILES, ESCALATION_DEFAULTS],
  "escalationDefaults.set": [ESCALATION_PROFILES, ESCALATION_DEFAULTS],
  "escalationDefaults.clear": [ESCALATION_PROFILES, ESCALATION_DEFAULTS],
  "rule.notifications.set": [RULES],
  // `F4.280` (Amendment 8): the report schedules and the on-demand file save.
  "reportSchedule.create": [REPORT_SCHEDULES],
  "reportSchedule.update": [REPORT_SCHEDULES],
  "reportFile.save": [REPORT_FILES],
  // `F4.281` (Amendment 8): the maintenance schedules.
  "maintenanceSchedule.create": [MAINTENANCE_SCHEDULES],
  "maintenanceSchedule.activate": [MAINTENANCE_SCHEDULES],
  "maintenanceSchedule.deactivate": [MAINTENANCE_SCHEDULES],
};

/** The query-key prefixes to invalidate after the change `catalogId` is applied. */
export function invalidationKeysFor(catalogId: string): readonly QueryKey[] {
  return BY_ENTRY[catalogId] ?? [];
}

/** The catalog entries this file names (for its spec). */
export const INVALIDATED_ENTRIES: readonly string[] = Object.keys(BY_ENTRY);
