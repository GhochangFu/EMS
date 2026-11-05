import { randomUUID } from "node:crypto";

import type pg from "pg";
import { expect } from "vitest";

import { dashboardMimicNodesResponseSchema, type DashboardMimicNodesResponseDto, type MimicNodeDto } from "@bms/shared";

import { one, readService, seedAsset, seedSite, txNowMs } from "./mimic-nodes.service.integration.spec";

/**
 * `F4.308` / ADR 0081 Amendment 2 (plan T2, C4, C5) — `MimicNodesService.readLayoutPreview`
 * against a real database: one STORED layout resolved against one asset group, with no dashboard
 * and no widget. The sibling `.integration.test.ts` owns the pool; the assertions live here
 * (ADR 0014, AGENTS.md §4.6). The F3.32 harness is reused: every case runs in one transaction
 * that is rolled back, and the service is built over that same client.
 *
 * **The fixture.** One group: a `wtp` asset (one open alarm, two ranked keys sampled, so a list
 * can name one it holds and one it lacks) and two `ro` assets (the later code inserted first).
 * The layout has `w` (wtp), `r` (ro, fan-out), `s` (softener — no member carries it) and a
 * passive unit `d`. No dashboard row exists at all.
 *
 * **Needs migration `0124`** (`bms.mimic_layout_node_points`).
 */

type Site = Awaited<ReturnType<typeof seedSite>>;

interface PreviewSite {
  readonly site: Site;
  readonly groupId: string;
  readonly layoutId: string;
  readonly wtpId: string;
  /** The two `ro` members by code. */
  readonly roIds: readonly [string, string];
  /** `held`: the wtp asset holds it active, sampled 42; `lacking`: a catalog-only key. */
  readonly keys: { readonly held: string; readonly lacking: string };
}

interface PreviewUnit {
  readonly key: string;
  readonly roleCode: string | null;
  readonly fanOut?: boolean;
  readonly pointKeys?: readonly string[];
}

async function seedPreviewLayout(client: pg.PoolClient, organizationId: string, units: readonly PreviewUnit[]): Promise<string> {
  const layout = await one<{ id: string }>(
    client,
    `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h)
     VALUES ($1, 'F4.308 preview plant', $2, 60, 40) RETURNING id`,
    [organizationId, `f4308-${randomUUID().slice(0, 8)}`],
    "the layout",
  );
  for (const [index, unit] of units.entries()) {
    const node = await one<{ id: string }>(
      client,
      `INSERT INTO bms.mimic_layout_nodes
         (organization_id, layout_id, key, kind, symbol, label, role_code, tone, x, y, w, h, z, fan_out)
       VALUES ($1, $2, $3, 'unit', 'tank', $3, $4, NULL, $5, 10, 8, 8, 1, $6) RETURNING id`,
      [organizationId, layout.id, unit.key, unit.roleCode, 2 + index * 10, unit.fanOut === true],
      `layout unit ${unit.key}`,
    );
    for (const [ord, pointKey] of [...(unit.pointKeys ?? []).entries()].reverse()) {
      await client.query(
        "INSERT INTO bms.mimic_layout_node_points (organization_id, node_id, point_key, ord) VALUES ($1, $2, $3, $4)",
        [organizationId, node.id, pointKey, ord],
      );
    }
  }
  return layout.id;
}

async function seedPreviewSite(client: pg.PoolClient): Promise<PreviewSite> {
  const site = await seedSite(client);
  const group = await one<{ id: string }>(
    client,
    `INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
     VALUES ($1, $2, $3, NULL, $4) RETURNING id`,
    [site.locationId, `${site.tag}-GRP`.toLowerCase(), "F4.308 preview group", site.organizationId],
    "the group",
  );
  const wtpId = await seedAsset(client, site, `${site.tag}-WTP`);
  const roB = await seedAsset(client, site, `${site.tag}-RO-B`);
  const roA = await seedAsset(client, site, `${site.tag}-RO-A`);
  for (const [assetId, role] of [
    [wtpId, "wtp"],
    [roB, "ro"],
    [roA, "ro"],
  ] as const) {
    await client.query("INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role) VALUES ($1, $2, $3)", [
      group.id,
      assetId,
      role,
    ]);
  }
  await client.query(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at)
     VALUES ($1, $2, 'critical', 'F4.308 open alarm', now() - interval '1 hour')`,
    [site.organizationId, wtpId],
  );

  const prefix = `f4308_${site.tag.slice(-8).toLowerCase()}`;
  const keys = { held: `${prefix}_held`, lacking: `${prefix}_lacking` };
  for (const code of [keys.held, keys.lacking]) {
    await client.query("INSERT INTO bms.point_keys (code, name, unit, headline_rank, active) VALUES ($1, $2, 'u', NULL, true)", [
      code,
      `F4.308 ${code}`,
    ]);
  }
  await client.query(
    `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit, active)
     VALUES ($1, $2, $3, $4, NULL, true)`,
    [site.organizationId, wtpId, keys.held, `src_${wtpId}_held`],
  );
  await client.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     VALUES (now() - interval '10 seconds', $1, $2, 42, 'u')`,
    [wtpId, keys.held],
  );

  const layoutId = await seedPreviewLayout(client, site.organizationId, [
    { key: "w", roleCode: "wtp", pointKeys: [keys.lacking, keys.held] },
    { key: "r", roleCode: "ro", fanOut: true },
    { key: "s", roleCode: "softener" },
    { key: "d", roleCode: null },
  ]);
  return { site, groupId: group.id, layoutId, wtpId, roIds: [roA, roB], keys };
}

/** A `pg.Pool`-shaped wrapper over one client that records every SQL text it is sent. */
function recordingClient(client: pg.PoolClient): { pool: pg.Pool; sent: string[] } {
  const sent: string[] = [];
  const pool = {
    query: (...args: unknown[]) => {
      sent.push(String(args[0]));
      return (client.query as (...a: unknown[]) => unknown)(...args);
    },
  } as unknown as pg.Pool;
  return { pool, sent };
}

async function preview(
  client: pg.PoolClient,
  fixture: PreviewSite,
  readable: readonly string[] | null = null,
  organizationId = fixture.site.organizationId,
): Promise<DashboardMimicNodesResponseDto> {
  const now = await txNowMs(client);
  return readService(client as unknown as pg.Pool).readLayoutPreview(organizationId, fixture.layoutId, fixture.groupId, readable, now);
}

function unitOf(dto: DashboardMimicNodesResponseDto, key: string): MimicNodeDto {
  const node = dto.widgets[0]?.nodes.find((candidate) => candidate.key === key);
  if (!node) throw new Error(`unit ${key} is absent from the preview answer`);
  return node;
}

/** V1 — plan C5, Q1 (a): the answer parses the shared schema, one layout widget, the layout id in all three ids. */
export async function assertPreviewParsesWithTheLayoutIdInEveryId(client: pg.PoolClient): Promise<void> {
  const fixture = await seedPreviewSite(client);
  const dto = dashboardMimicNodesResponseSchema.parse(await preview(client, fixture));
  const widget = dto.widgets[0];
  expect({
    dashboardId: dto.dashboardId,
    count: dto.widgets.length,
    source: widget?.source,
    widgetId: widget?.widgetId,
    layoutId: widget?.source === "layout" ? widget.layoutId : null,
    drawn: widget?.source === "layout" ? widget.layout.nodes.map((node) => node.key) : [],
  }).toEqual({
    dashboardId: fixture.layoutId,
    count: 1,
    source: "layout",
    widgetId: fixture.layoutId,
    layoutId: fixture.layoutId,
    drawn: ["w", "r", "s", "d"],
  });
}

/** V2 — roled units resolve against the group: `w` to the wtp asset with its one open alarm; the passive `d` is drawn, not resolved. */
export async function assertPreviewResolvesRoledUnitsAgainstTheGroup(client: pg.PoolClient): Promise<void> {
  const fixture = await seedPreviewSite(client);
  const dto = await preview(client, fixture);
  expect(dto.widgets[0]?.nodes.map((node) => [node.key, node.asset?.id ?? null, node.memberCount, node.activeAlarms])).toEqual([
    ["w", fixture.wtpId, 1, 1],
    ["r", fixture.roIds[0], 2, 0],
    ["s", null, 0, 0],
  ]);
}

/** V3 — a role no member of the group carries reads `asset: null`, no alarm, no member. */
export async function assertPreviewUnitWithNoMemberIsUnassigned(client: pg.PoolClient): Promise<void> {
  const fixture = await seedPreviewSite(client);
  const unit = unitOf(await preview(client, fixture), "s");
  expect([unit.asset, unit.memberCount, unit.topAlarm, unit.members]).toEqual([null, 0, null, []]);
}

/** V4 — an F4.307 list answers in list order; the key the asset lacks reads `latest: null`. */
export async function assertPreviewListAnswersInOrder(client: pg.PoolClient): Promise<void> {
  const fixture = await seedPreviewSite(client);
  const unit = unitOf(await preview(client, fixture), "w");
  expect((unit.asset?.points ?? []).map((point) => [point.pointKey, point.latest?.value ?? null])).toEqual([
    [fixture.keys.lacking, null],
    [fixture.keys.held, 42],
  ]);
}

/** V5 — a fan-out unit lists every readable member by code. */
export async function assertPreviewFanOutListsMembers(client: pg.PoolClient): Promise<void> {
  const fixture = await seedPreviewSite(client);
  const unit = unitOf(await preview(client, fixture), "r");
  expect(unit.members.map((member) => member.asset.id)).toEqual([...fixture.roIds]);
}

/** V6 — `readableAssetIds = []`: every unit unassigned, and no members statement is sent. */
export async function assertPreviewWithNoReadableAssetIsUnassigned(client: pg.PoolClient): Promise<void> {
  const fixture = await seedPreviewSite(client);
  const recording = recordingClient(client);
  const now = await txNowMs(client);
  const dto = await readService(recording.pool).readLayoutPreview(fixture.site.organizationId, fixture.layoutId, fixture.groupId, [], now);
  expect({
    assets: dto.widgets[0]?.nodes.map((node) => node.asset),
    members: recording.sent.some((sql) => sql.includes("bms.asset_group_members")),
  }).toEqual({ assets: [null, null, null], members: false });
}

/** V7 — `[one ro member]` narrows `memberCount` to 1 and the fan-out to that member. */
export async function assertPreviewReadableSetNarrowsMemberCount(client: pg.PoolClient): Promise<void> {
  const fixture = await seedPreviewSite(client);
  const unit = unitOf(await preview(client, fixture, [fixture.roIds[1]]), "r");
  expect([unit.memberCount, unit.members.map((member) => member.asset.id)]).toEqual([1, [fixture.roIds[1]]]);
}

/** V8 — the preview reads no `bms.dashboard*` table and sends no `INSERT`, `UPDATE` or `DELETE`. */
export async function assertPreviewReadsNoDashboardAndWritesNothing(client: pg.PoolClient): Promise<void> {
  const fixture = await seedPreviewSite(client);
  const recording = recordingClient(client);
  const now = await txNowMs(client);
  await readService(recording.pool).readLayoutPreview(fixture.site.organizationId, fixture.layoutId, fixture.groupId, null, now);
  expect({
    sent: recording.sent.length > 0,
    dashboards: recording.sent.filter((sql) => /bms\.dashboard/.test(sql)),
    writes: recording.sent.filter((sql) => /\b(INSERT|UPDATE|DELETE)\b/i.test(sql)),
  }).toEqual({ sent: true, dashboards: [], writes: [] });
}

/** V9 — ADR 0043 Amendment 3: the layout read under ANOTHER organization's id answers `widgets: []`. */
export async function assertPreviewOfAnotherOrganizationsLayoutIsEmpty(client: pg.PoolClient): Promise<void> {
  const fixture = await seedPreviewSite(client);
  const foreign = await seedSite(client);
  const dto = await preview(client, fixture, null, foreign.organizationId);
  expect([dto.widgets, dto.stateMaps]).toEqual([[], []]);
}
