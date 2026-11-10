import type { Pool } from "pg";
import { expect } from "vitest";

import { dashboardMimicNodesResponseSchema } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { MimicNodesService } from "./mimic-nodes.service";

/**
 * `F4.308` / ADR 0081 Amendment 2 (plan T2, C4, C5) — `readLayoutPreview` over a SCRIPTED pool,
 * no database. The pool answers by statement (1b, 1c, 2, 3) and records every SQL text and its
 * parameters, so the shape of the answer and what the read sends are proven here; the SQL itself
 * is proven by `mimic-nodes.preview.integration.spec.ts`, which needs Postgres.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const LAYOUT = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const WTP = "44444444-4444-4444-8444-444444444444";
const NOW = Date.parse("2026-11-05T10:00:00.000Z");

interface Sent {
  readonly sql: string;
  readonly params: readonly unknown[];
}

const nodeRow = (key: string, roleCode: string | null, z: number) => ({
  layout_id: LAYOUT,
  name: "Preview plant",
  canvas_w: 60,
  canvas_h: 40,
  key,
  kind: "unit",
  symbol: "tank",
  org_symbol_key: null,
  label: key.toUpperCase(),
  role_code: roleCode,
  tone: null,
  x: 1,
  y: 1,
  w: 8,
  h: 8,
  z,
  fan_out: false,
  is_source: false,
  is_switching: false,
  point_keys: [],
});

const memberRow = {
  asset_group_id: GROUP,
  role: "wtp",
  rn: 1,
  asset_id: WTP,
  asset_code: "WTP-01",
  asset_name: "WTP",
  rtu_display_name: null,
  location_name: null,
  domain: "water",
  member_count: 1,
  freshness_window_seconds: 150,
  active_alarms: 2,
  top_alarm_severity: null,
  top_alarm_tone: null,
  top_alarm_label: null,
  top_alarm_message: null,
  top_alarm_raised_at: null,
  top_alarm_rank: null,
};

/** A pool that answers each statement of the resolver, and throws on any other. */
function scriptedPool(): { pool: Pool; sent: Sent[] } {
  const sent: Sent[] = [];
  const pool = {
    query: async (sql: string, params: readonly unknown[] = []) => {
      sent.push({ sql, params });
      if (sql.includes("FROM bms.mimic_layouts l")) {
        const asked = params[0] as readonly string[];
        return { rows: params[1] === ORG && asked.includes(LAYOUT) ? [nodeRow("a", "wtp", 1), nodeRow("b", "ro", 2), nodeRow("d", null, 3)] : [] };
      }
      if (sql.includes("bms.mimic_layout_pipes")) return { rows: [] };
      if (sql.includes("bms.asset_group_members")) return { rows: [memberRow] };
      if (sql.includes("AS sa(id)")) return { rows: [] };
      throw new Error(`unscripted statement: ${sql.slice(0, 80)}`);
    },
  } as unknown as Pool;
  return { pool, sent };
}

const serviceOver = (pool: Pool) => new MimicNodesService({} as never, pool, {} as AccessControlService);

/** U1 — the answer parses the shared schema: one layout widget, the layout id in `dashboardId`, `widgetId`, `layoutId` (Q1 a). */
export async function previewAnswersOneLayoutWidgetUnderTheLayoutId(): Promise<void> {
  const { pool } = scriptedPool();
  const dto = await serviceOver(pool).readLayoutPreview(ORG, LAYOUT, GROUP, null, NOW);
  const parsed = dashboardMimicNodesResponseSchema.parse(dto);
  const widget = parsed.widgets[0];
  expect({
    dashboardId: parsed.dashboardId,
    resolvedAt: parsed.resolvedAt,
    count: parsed.widgets.length,
    source: widget?.source,
    widgetId: widget?.widgetId,
    layoutId: widget?.source === "layout" ? widget.layoutId : null,
  }).toEqual({
    dashboardId: LAYOUT,
    resolvedAt: new Date(NOW).toISOString(),
    count: 1,
    source: "layout",
    widgetId: LAYOUT,
    layoutId: LAYOUT,
  });
}

/** U2 — roled units resolve against the GIVEN group (statement 2's `$1`); a role with no member reads `asset: null`; a passive unit is not resolved. */
export async function previewResolvesRoledUnitsAgainstTheGivenGroup(): Promise<void> {
  const { pool, sent } = scriptedPool();
  const dto = await serviceOver(pool).readLayoutPreview(ORG, LAYOUT, GROUP, null, NOW);
  const members = sent.find((entry) => entry.sql.includes("bms.asset_group_members"));
  expect({
    groupParam: members?.params[0],
    orgParam: members?.params[1],
    nodes: dto.widgets[0]?.nodes.map((node) => [node.key, node.asset?.id ?? null, node.activeAlarms]),
  }).toEqual({
    groupParam: [GROUP],
    orgParam: ORG,
    nodes: [
      ["a", WTP, 2],
      ["b", null, 0],
    ],
  });
}

/** U3 — the preview reads no `bms.dashboards` / `bms.dashboard_*` table and sends no write. */
export async function previewReadsNoDashboardAndWritesNothing(): Promise<void> {
  const { pool, sent } = scriptedPool();
  await serviceOver(pool).readLayoutPreview(ORG, LAYOUT, GROUP, null, NOW);
  expect({
    dashboards: sent.filter((entry) => /bms\.dashboard/.test(entry.sql)).length,
    writes: sent.filter((entry) => /\b(INSERT|UPDATE|DELETE)\b/i.test(entry.sql)).length,
    statements: sent.length,
  }).toEqual({ dashboards: 0, writes: 0, statements: 4 });
}

/** U4 — `readableAssetIds = []`: every unit unassigned, and no members statement (only 1b and 1c run). */
export async function previewWithNoReadableAssetSendsNoMembersStatement(): Promise<void> {
  const { pool, sent } = scriptedPool();
  const dto = await serviceOver(pool).readLayoutPreview(ORG, LAYOUT, GROUP, [], NOW);
  expect({
    statements: sent.length,
    members: sent.some((entry) => entry.sql.includes("bms.asset_group_members")),
    assets: dto.widgets[0]?.nodes.map((node) => node.asset),
  }).toEqual({ statements: 2, members: false, assets: [null, null] });
}

/** U5 — a layout this organization does not hold (1b answers nothing) → `widgets: []`, no further statement. */
export async function previewOfALayoutTheOrganizationDoesNotHoldIsEmpty(): Promise<void> {
  const { pool, sent } = scriptedPool();
  const dto = await serviceOver(pool).readLayoutPreview("55555555-5555-4555-8555-555555555555", LAYOUT, GROUP, null, NOW);
  expect({ widgets: dto.widgets, stateMaps: dto.stateMaps, dashboardId: dto.dashboardId, statements: sent.length }).toEqual({
    widgets: [],
    stateMaps: [],
    dashboardId: LAYOUT,
    statements: 1,
  });
}
