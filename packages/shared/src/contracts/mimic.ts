import { z } from "zod";

import { mimicPresetSchema } from "./dashboard-builder";
import { generatedSiteAssetSchema } from "./generated-site-view";
import { alarmSeverityCodeSchema, pillToneSchema } from "./operations";

/**
 * `F3.32` / ADR 0079 — `GET /api/v1/dashboards/:id/mimic-nodes` (plan D1).
 *
 * One read answers every `mimic` widget on a dashboard, each with its preset's nodes resolved
 * against the dashboard's asset group at read time. Plain `z.object` throughout — no
 * `.merge()`, no `.extend()`, no `.pick()`, no `.readonly()` (plan D4, ADR 0030 decision 2).
 *
 * A node's `asset` reuses F3.68's `generatedSiteAssetSchema` so the web can hand the renderer a
 * synthetic `GeneratedSiteViewDto` and reuse the live-overlay machinery unchanged (plan D2).
 */

/** How many of a node's points, ordered `headline_rank ASC NULLS LAST, point_key ASC`, a node
 * shows. The server's `LIMIT` reads this. */
export const MIMIC_HEADLINE_POINTS = 3;

/**
 * `F3.32b` (ADR 0079 Amendment 2) — the shown asset's most severe open alarm, drawn as a
 * callout under the unit that raised it, as the client's reference does. Most severe first by
 * the severity vocabulary's rank, then newest. `message` is the alarm's own stored text.
 *
 * `tone` and `label` are the severity's own `bms.alarm_severities` row, read in the same
 * statement (ADR 0032 decision 9: behaviour is read from the vocabulary, never from a list of
 * codes), so a level added by an `INSERT` draws in its declared colour with its declared name.
 */
export const mimicNodeAlarmSchema = z.object({
  severity: alarmSeverityCodeSchema,
  tone: pillToneSchema,
  label: z.string(),
  message: z.string(),
  raisedAt: z.string(),
});

/**
 * One preset node, resolved.
 *
 * `asset` is `null` when no member of the group carries `roleCode`, or when the caller cannot
 * read the member that does (plan D6) — both read "Not assigned". `memberCount` is how many
 * members carry the role; above one, the node shows the first by code and a `+N` badge.
 * `activeAlarms` counts the shown asset's open alarms, and drives the alarm status (plan D5).
 */
export const mimicNodeSchema = z.object({
  key: z.string(),
  label: z.string(),
  roleCode: z.string(),
  asset: generatedSiteAssetSchema.nullable(),
  memberCount: z.number().int().min(0),
  activeAlarms: z.number().int().min(0),
  /** `null` when the node has no asset or the asset has no open alarm. */
  topAlarm: mimicNodeAlarmSchema.nullable(),
});

/** One `mimic` widget and its nodes, in the preset's declared order. */
export const mimicWidgetNodesSchema = z.object({
  widgetId: z.string().uuid(),
  preset: mimicPresetSchema,
  nodes: z.array(mimicNodeSchema),
});

/** The whole response: every mimic widget on one dashboard. */
export const dashboardMimicNodesResponseSchema = z.object({
  dashboardId: z.string().uuid(),
  resolvedAt: z.string(),
  widgets: z.array(mimicWidgetNodesSchema),
});
