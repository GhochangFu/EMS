import { z } from "zod";

import { dashboardTabKeySchema } from "./dashboard-tabs";
import { generatedSiteAssetSchema } from "./generated-site-view";
import { mimicNodeAlarmSchema } from "./mimic";
import {
  alarmListItemSchema,
  alarmSeverityCodeSchema,
  alarmSeverityCountSchema,
  assetRoleSummaryItemSchema,
  pillToneSchema,
} from "./operations";
import { pointKeyStateMapSchema } from "./point-key-states";

/**
 * `F3.73` (plan D9, Task 3.2) — the five site widgets and the read they draw from.
 *
 * A site widget binds neither a point nor a catalog source: it reads one response,
 * `GET /api/v1/dashboards/:id/site-widgets`, scoped to the widget's tab. So each config here holds
 * presentation only, and `{0, 0}` in both cardinality records in `./dashboard-builder` is the
 * whole binding statement (`widgetTypeBindsNothing` reads it).
 *
 * The item schemas of the response are `operations.ts`'s own — the alarm rail, the class strip and
 * the list reuse the existing contracts, so no new query field opens on `/alarms` or
 * `/assets/role-summary`. They are imported and not re-exported: `./index` already exports both
 * files, and a second path to one name is how an ambiguous `export *` starts.
 */

/**
 * The widget types this file configures, in `widgetTypeSchema`'s order. Declared here so the
 * enum in `./dashboard-builder` and this list are held equal by the spec, not by a comment.
 */
export const SITE_WIDGET_TYPES = [
  "active_alarms_rail",
  "state_legend",
  "asset_class_strip",
  "module_summary_card",
  "critical_systems_list",
  "breaker_table",
] as const;

/** The most alarm rows the rail draws — also the response's cap, so the two cannot disagree. */
export const MAX_SITE_ALARM_ROWS = 20;

/**
 * `F3.74` — the most breaker rows one read answers: the member statement's `LIMIT` and the
 * response's `.max()`, so the two cannot disagree. A site's SLD draws a few dozen breakers at most.
 */
export const MAX_SITE_BREAKER_ROWS = 64;

/** The rail of active alarms in the widget's tab scope. `rows` caps the list, not the count. */
export const activeAlarmsRailConfigSchema = z.object({
  rows: z.number().int().min(1).max(MAX_SITE_ALARM_ROWS).default(8),
  showSummary: z.boolean().default(true),
});

/** The severity and state legend. Nothing to configure: it names the closed palette. */
export const stateLegendConfigSchema = z.object({});

/** The per-class asset strip. Nothing to configure: the classes come from the roles in scope. */
export const assetClassStripConfigSchema = z.object({});

/**
 * One card per domain tab on the Overview. `targetTabKey` is the tab the card links to; the
 * write path refuses a key that names no tab of the same dashboard (plan D2).
 */
export const moduleSummaryCardConfigSchema = z.object({
  // `.describe()` AFTER the shared refinement (ADR 0029 decision 10), as `siteTemplateTabSchema`
  // does for the tab's own key: the document emits nothing for the reserved-key refusal.
  targetTabKey: dashboardTabKeySchema.describe(
    "The key of a tab of the same dashboard: lowercase letters, digits and hyphens, 1 to 64 " +
      "characters. `assets` is reserved: it is the site page's own Assets & RTUs segment.",
  ),
});

/** The critical-systems list: one row per group tab. Nothing to configure. */
export const criticalSystemsListConfigSchema = z.object({});

/**
 * `F3.74` / ADR 0088 decision 10 — the breaker table: one row per breaker-role member of the
 * bound group (the tab's, else the dashboard's own). Nothing to configure: the rows come from the roles in scope.
 */
export const breakerTableConfigSchema = z.object({});

/**
 * One tab's status as the module card and the critical-systems row read it (ruling Q6a): the worst
 * active alarm severity among the tab group's members in scope, plus the offline asset count.
 * `worstSeverity` is null when none of them has an active alarm; `tone` is then `ok`.
 */
export const siteWidgetTabStatusSchema = z.object({
  worstSeverity: alarmSeverityCodeSchema.nullable(),
  tone: pillToneSchema,
  activeAlarms: z.number().int().nonnegative(),
  offlineAssets: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
});

/**
 * One group tab of the dashboard. `status` is null for a tab whose members the caller may not
 * read — the list shows "Outside scope" for it, never a zero that would read as healthy.
 */
export const siteWidgetTabSchema = z.object({
  tabKey: dashboardTabKeySchema,
  label: z.string(),
  assetGroupId: z.string().uuid().nullable(),
  status: siteWidgetTabStatusSchema.nullable(),
});

/**
 * `F3.74` (plan D8) — the point keys a breaker row's `asset.points` holds besides its state keys:
 * the table's I (A), kW and kWh columns. The read selects these by name, never by headline rank.
 */
export const BREAKER_TABLE_POINT_KEYS = ["current_a", "kw", "kwh_today"] as const;

/**
 * `F3.74` (plan D8, ADR 0088 decision 10) — one member of a breaker role (`BREAKER_ROLE_CODES`) in
 * the bound group (the tab's, else the dashboard's own) that the caller may read. `asset.points` holds the active registered points among
 * `BREAKER_TABLE_POINT_KEYS` plus every active key with a `bms.point_key_states` row; the web
 * derives the state from those and the response's `stateMaps` (`deriveBreakerState`, plan D12).
 * `roleLabel` is the role's `bms.asset_roles` label; `rating` and `tripCause` are the asset's own
 * columns (0097). `activeAlarms` and `topAlarm` read as a mimic node's do.
 */
export const breakerRowSchema = z.object({
  asset: generatedSiteAssetSchema,
  roleCode: z.string(),
  roleLabel: z.string(),
  rating: z.string().nullable(),
  tripCause: z.string().nullable(),
  activeAlarms: z.number().int().nonnegative(),
  topAlarm: mimicNodeAlarmSchema.nullable(),
});

/**
 * `GET /api/v1/dashboards/:id/site-widgets?tab=<key>` — one read per dashboard tab.
 *
 * `scope.assetCount` is the tab group's members (the dashboard scope for the Overview or a legacy
 * canvas) intersected with what the caller may read. `tabKey` is null for that Overview or legacy
 * read. `alarms.active` is capped at `MAX_SITE_ALARM_ROWS`; `alarms.summary` is the complete
 * per-severity count, like `GET /alarms/summary`.
 *
 * `breakers` (`F3.74`, plan D8) is the bound group's breaker rows — the tab's group, else the
 * dashboard's own `assetGroupId` — by `asset_roles.sort_order` then asset code, at most
 * `MAX_SITE_BREAKER_ROWS`, and only when the caller may read that group. A group-less tab of a
 * location, organization or asset dashboard (its Overview, or a legacy canvas) answers `[]`. `stateMaps` holds
 * the `bms.point_key_states` rows of the state keys those rows carry, and only those.
 */
export const siteWidgetsResponseSchema = z.object({
  dashboardId: z.string().uuid(),
  tabKey: z.string().nullable(),
  resolvedAt: z.string(),
  scope: z.object({ assetCount: z.number().int().nonnegative() }),
  alarms: z.object({
    active: z.array(alarmListItemSchema).max(MAX_SITE_ALARM_ROWS),
    summary: z.array(alarmSeverityCountSchema),
  }),
  roles: z.array(assetRoleSummaryItemSchema),
  tabs: z.array(siteWidgetTabSchema),
  breakers: z.array(breakerRowSchema).max(MAX_SITE_BREAKER_ROWS),
  stateMaps: z.array(pointKeyStateMapSchema),
});
