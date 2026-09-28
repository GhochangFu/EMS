import { z } from "zod";

import { mimicPresetSchema } from "./dashboard-builder";
import { generatedSiteAssetSchema } from "./generated-site-view";

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
