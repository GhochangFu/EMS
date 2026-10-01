import { z } from "zod";

import { dashboardTabKeySchema } from "./dashboard-tabs";
import {
  alarmListItemSchema,
  alarmSeverityCodeSchema,
  alarmSeverityCountSchema,
  assetRoleSummaryItemSchema,
  pillToneSchema,
} from "./operations";

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
 * The five widget types this file configures, in `widgetTypeSchema`'s order. Declared here so the
 * enum in `./dashboard-builder` and this list are held equal by the spec, not by a comment.
 */
export const SITE_WIDGET_TYPES = [
  "active_alarms_rail",
  "state_legend",
  "asset_class_strip",
  "module_summary_card",
  "critical_systems_list",
] as const;

/** The most alarm rows the rail draws — also the response's cap, so the two cannot disagree. */
export const MAX_SITE_ALARM_ROWS = 20;

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
 * `GET /api/v1/dashboards/:id/site-widgets?tab=<key>` — one read per dashboard tab.
 *
 * `scope.assetCount` is the tab group's members (the dashboard scope for the Overview or a legacy
 * canvas) intersected with what the caller may read. `tabKey` is null for that Overview or legacy
 * read. `alarms.active` is capped at `MAX_SITE_ALARM_ROWS`; `alarms.summary` is the complete
 * per-severity count, like `GET /alarms/summary`.
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
});
