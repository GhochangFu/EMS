import { randomUUID } from "node:crypto";

import type pg from "pg";
import { expect } from "vitest";

import type { DashboardMimicNodesResponseDto, GeneratedSitePointDto, MimicLayoutWidgetNodesDto, MimicNodeDto } from "@bms/shared";

import { countingClient } from "../control-room/generated-site-view.integration.spec";
import {
  one,
  readService,
  seedAsset,
  seedDashboard,
  seedMimicWidget,
  seedSite,
  txNowMs,
} from "./mimic-nodes.service.integration.spec";

/**
 * `F4.307` / ADR 0081 Amendment 1 (plan T6, C3–C5) — a layout unit's listed points, resolved per
 * node against a real database. The sibling `.integration.test.ts` owns the pool; the assertions
 * live here (ADR 0014, AGENTS.md §4.6). The F3.32 harness is reused: every case runs in one
 * transaction that is rolled back, and the service is built over that same client.
 *
 * **The fixture.** One group: a `wtp` asset and two `ro` assets, each holding four ranked keys
 * `r1`…`r4` (active, sampled at `10 × rank + the asset's index`, so a member can only answer its
 * own sample). The `wtp` asset also has three keys outside the headline: `inactive` (its asset
 * point is inactive, and sampled), `catalog` (a catalog row and a sample, no asset point) and
 * `retired` (a catalog-INACTIVE key the asset holds active, sampled). A read that forgets the
 * `held` gate on the window lateral answers a value for the first two.
 *
 * **Needs migration `0124`** (`bms.mimic_layout_node_points`).
 */

type Site = Awaited<ReturnType<typeof seedSite>>;

interface ListKeys {
  readonly r1: string;
  readonly r2: string;
  readonly r3: string;
  readonly r4: string;
  readonly inactive: string;
  readonly catalog: string;
  readonly retired: string;
}

interface ListSite {
  readonly site: Site;
  readonly groupId: string;
  readonly dashboardId: string;
  readonly wtpId: string;
  /** The two `ro` members by code. */
  readonly roIds: readonly [string, string];
  readonly keys: ListKeys;
}

/** The value `asset index` (wtp 0, ro 1, ro 2) samples for key `r<rank>`. */
const valueOf = (rank: number, assetIndex: number): number => 10 * rank + assetIndex;

async function registerPoint(client: pg.PoolClient, site: Site, assetId: string, key: string, active = true): Promise<void> {
  await client.query(
    `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit, active)
     VALUES ($1, $2, $3, $4, NULL, $5)`,
    [site.organizationId, assetId, key, `src_${assetId}_${key}`, active],
  );
}

async function sample(client: pg.PoolClient, assetId: string, key: string, value: number): Promise<void> {
  await client.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     VALUES (now() - interval '10 seconds', $1, $2, $3, 'u')`,
    [assetId, key, value],
  );
}

async function seedListSite(client: pg.PoolClient): Promise<ListSite> {
  const site = await seedSite(client);
  const group = await one<{ id: string }>(
    client,
    `INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
     VALUES ($1, $2, $3, NULL, $4) RETURNING id`,
    [site.locationId, `${site.tag}-GRP`.toLowerCase(), "F4.307 point-list group", site.organizationId],
    "the group",
  );
  const wtpId = await seedAsset(client, site, `${site.tag}-WTP`);
  // The later code first, so neither insertion order nor a missing `ORDER BY` answers code order.
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

  const prefix = `f4307_${site.tag.slice(-8).toLowerCase()}`;
  const keys: ListKeys = {
    r1: `${prefix}_r1`,
    r2: `${prefix}_r2`,
    r3: `${prefix}_r3`,
    r4: `${prefix}_r4`,
    inactive: `${prefix}_inactive`,
    catalog: `${prefix}_catalog`,
    retired: `${prefix}_retired`,
  };
  for (const [code, rank, active] of [
    [keys.r1, 1, true],
    [keys.r2, 2, true],
    [keys.r3, 3, true],
    [keys.r4, 4, true],
    [keys.inactive, null, true],
    [keys.catalog, null, true],
    [keys.retired, null, false],
  ] as const) {
    await client.query("INSERT INTO bms.point_keys (code, name, unit, headline_rank, active) VALUES ($1, $2, 'u', $3, $4)", [
      code,
      `F4.307 ${code}`,
      rank,
      active,
    ]);
  }
  for (const [assetIndex, assetId] of [wtpId, roA, roB].entries()) {
    for (const [index, key] of [keys.r1, keys.r2, keys.r3, keys.r4].entries()) {
      await registerPoint(client, site, assetId, key);
      await sample(client, assetId, key, valueOf(index + 1, assetIndex));
    }
  }
  await registerPoint(client, site, wtpId, keys.inactive, false);
  await sample(client, wtpId, keys.inactive, 91);
  await sample(client, wtpId, keys.catalog, 92);
  await registerPoint(client, site, wtpId, keys.retired);
  await sample(client, wtpId, keys.retired, 93);

  const dashboardId = await seedDashboard(client, site, group.id);
  return { site, groupId: group.id, dashboardId, wtpId, roIds: [roA, roB], keys };
}

interface ListedUnit {
  readonly key: string;
  readonly roleCode: string;
  readonly fanOut?: boolean;
  readonly pointKeys?: readonly string[];
}

/**
 * One layout of units, each with its stored list — rows inserted in REVERSE `ord`, so the
 * insertion order is not the answer — as a layout widget at `gridY`; answers the layout id.
 */
async function seedListedLayout(client: pg.PoolClient, fixture: ListSite, units: readonly ListedUnit[], gridY = 0): Promise<string> {
  const { organizationId } = fixture.site;
  const layout = await one<{ id: string }>(
    client,
    `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h)
     VALUES ($1, 'F4.307 fixture plant', $2, 60, 40) RETURNING id`,
    [organizationId, `f4307-${randomUUID().slice(0, 8)}`],
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
  await seedMimicWidget(client, organizationId, fixture.dashboardId, { source: "layout", layoutId: layout.id }, gridY);
  return layout.id;
}

async function readFixture(client: pg.PoolClient, fixture: ListSite): Promise<DashboardMimicNodesResponseDto> {
  return readService(client as unknown as pg.Pool).read(fixture.site.organizationId, fixture.dashboardId, null, await txNowMs(client));
}

function layoutWidget(dto: DashboardMimicNodesResponseDto): MimicLayoutWidgetNodesDto {
  const widget = dto.widgets.find((candidate) => candidate.source === "layout");
  if (widget === undefined || widget.source !== "layout") throw new Error("no layout widget in the mimic-nodes answer");
  return widget;
}

function unitOf(widget: { nodes: readonly MimicNodeDto[] }, key: string): MimicNodeDto {
  const node = widget.nodes.find((candidate) => candidate.key === key);
  if (!node) throw new Error(`unit ${key} is absent from the mimic-nodes answer`);
  return node;
}

/** Each point as `[key, latest value or null]`, in the answer's order. */
const keyValues = (points: readonly GeneratedSitePointDto[] | undefined) =>
  (points ?? []).map((point) => [point.pointKey, point.latest?.value ?? null]);

/** R1 — a unit listing `[r4, r1]` answers those two, in that order: not the headline `r1, r2, r3`. */
export async function assertListedUnitAnswersItsListInOrder(client: pg.PoolClient): Promise<void> {
  const fixture = await seedListSite(client);
  const { keys } = fixture;
  await seedListedLayout(client, fixture, [{ key: "w", roleCode: "wtp", pointKeys: [keys.r4, keys.r1] }]);
  const unit = unitOf(layoutWidget(await readFixture(client, fixture)), "w");
  expect(keyValues(unit.asset?.points)).toEqual([
    [keys.r4, valueOf(4, 0)],
    [keys.r1, valueOf(1, 0)],
  ]);
}

/**
 * R2 — plan Q2 / ADR Q3: a key whose asset point is inactive and a catalog-only key each answer
 * the catalog name and `latest: null` although both have a sample; a catalog-INACTIVE key the
 * asset holds active answers its value. List order throughout.
 */
export async function assertKeyTheAssetDoesNotHoldReadsItsNameAndNoSample(client: pg.PoolClient): Promise<void> {
  const fixture = await seedListSite(client);
  const { keys } = fixture;
  await seedListedLayout(client, fixture, [
    { key: "w", roleCode: "wtp", pointKeys: [keys.inactive, keys.catalog, keys.retired] },
  ]);
  const unit = unitOf(layoutWidget(await readFixture(client, fixture)), "w");
  expect((unit.asset?.points ?? []).map((point) => [point.pointKey, point.name, point.latest?.value ?? null])).toEqual([
    [keys.inactive, `F4.307 ${keys.inactive}`, null],
    [keys.catalog, `F4.307 ${keys.catalog}`, null],
    [keys.retired, `F4.307 ${keys.retired}`, 93],
  ]);
}

/**
 * R3 — two units on ONE asset, one listing `[r4, r1]` and one listing nothing, answer different
 * points from the same read: the list, and the headline three.
 */
export async function assertTwoUnitsOnOneAssetAnswerTheirOwnPoints(client: pg.PoolClient): Promise<void> {
  const fixture = await seedListSite(client);
  const { keys } = fixture;
  await seedListedLayout(client, fixture, [
    { key: "w", roleCode: "wtp", pointKeys: [keys.r4, keys.r1] },
    { key: "w2", roleCode: "wtp" },
  ]);
  const widget = layoutWidget(await readFixture(client, fixture));
  expect({
    assets: [unitOf(widget, "w").asset?.id, unitOf(widget, "w2").asset?.id],
    listed: keyValues(unitOf(widget, "w").asset?.points).map(([key]) => key),
    headline: keyValues(unitOf(widget, "w2").asset?.points).map(([key]) => key),
  }).toEqual({
    assets: [fixture.wtpId, fixture.wtpId],
    listed: [keys.r4, keys.r1],
    headline: [keys.r1, keys.r2, keys.r3],
  });
}

/**
 * R4 — plan Q4: a fan-out unit listing `[r4, r2]` answers the list on `asset` and on EVERY
 * `members[].asset`, each with its own member's samples.
 */
export async function assertFanOutListedUnitAnswersTheListOnEveryMember(client: pg.PoolClient): Promise<void> {
  const fixture = await seedListSite(client);
  const { keys } = fixture;
  await seedListedLayout(client, fixture, [{ key: "r", roleCode: "ro", fanOut: true, pointKeys: [keys.r4, keys.r2] }]);
  const unit = unitOf(layoutWidget(await readFixture(client, fixture)), "r");
  const listFor = (assetIndex: number) => [
    [keys.r4, valueOf(4, assetIndex)],
    [keys.r2, valueOf(2, assetIndex)],
  ];
  expect({
    asset: keyValues(unit.asset?.points),
    members: unit.members.map((member) => [member.asset.id, keyValues(member.asset.points)]),
  }).toEqual({
    asset: listFor(1),
    members: [
      [fixture.roIds[0], listFor(1)],
      [fixture.roIds[1], listFor(2)],
    ],
  });
}

/**
 * R5 — the lists cost no statement: a layout of listed units (two lists on one asset, one fan-out
 * list) is still five statements, as F3.32c's L3 counts for a layout with none.
 */
export async function assertListedLayoutIsStillFiveStatements(client: pg.PoolClient): Promise<void> {
  const fixture = await seedListSite(client);
  const { keys } = fixture;
  await seedListedLayout(client, fixture, [
    { key: "w", roleCode: "wtp", pointKeys: [keys.r4, keys.r1] },
    { key: "w2", roleCode: "wtp", pointKeys: [keys.catalog] },
    { key: "r", roleCode: "ro", fanOut: true, pointKeys: [keys.r3] },
  ]);
  const nowMs = await txNowMs(client);
  const counting = countingClient(client);
  await readService(counting.pool).read(fixture.site.organizationId, fixture.dashboardId, null, nowMs);
  expect(counting.count()).toBe(5);
}

/**
 * R6 — a preset widget beside a layout that lists `[r4, r1]` on the same `wtp` asset answers the
 * headline three exactly as before (a preset carries no list); the layout unit still answers its
 * list.
 */
export async function assertPresetBesideAListedLayoutAnswersTheHeadline(client: pg.PoolClient): Promise<void> {
  const fixture = await seedListSite(client);
  const { keys } = fixture;
  await seedMimicWidget(client, fixture.site.organizationId, fixture.dashboardId, { source: "preset", preset: "water_train" }, 0);
  await seedListedLayout(client, fixture, [{ key: "w", roleCode: "wtp", pointKeys: [keys.r4, keys.r1] }], 6);
  const dto = await readFixture(client, fixture);
  const preset = dto.widgets[0];
  if (preset?.source !== "preset") throw new Error("no preset widget first in the mimic-nodes answer");
  expect({
    preset: keyValues(unitOf(preset, "wtp").asset?.points),
    layout: keyValues(unitOf(layoutWidget(dto), "w").asset?.points).map(([key]) => key),
  }).toEqual({
    preset: [
      [keys.r1, valueOf(1, 0)],
      [keys.r2, valueOf(2, 0)],
      [keys.r3, valueOf(3, 0)],
    ],
    layout: [keys.r4, keys.r1],
  });
}
