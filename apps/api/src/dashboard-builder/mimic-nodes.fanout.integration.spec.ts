import { randomUUID } from "node:crypto";

import type pg from "pg";
import { expect } from "vitest";

import {
  MIMIC_PRESETS,
  type DashboardMimicNodesResponseDto,
  type MimicLayoutWidgetNodesDto,
  type MimicNodeDto,
} from "@bms/shared";

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
 * `F3.74` / ADR 0088 plan D4, D3b, D7 (Task 2.2) — the fan-out resolver, both arms, against a
 * real database. The sibling `.integration.test.ts` owns the pool; the assertions live here (ADR
 * 0014, AGENTS.md §4.6). The F3.32 harness is reused: every case runs in one transaction that is
 * rolled back, and the service is built over that same client.
 *
 * **Per-run state keys.** Each fixture creates its own `bms.point_keys` codes and their
 * `bms.point_key_states` rows inside the transaction, so no case leans on the seed's
 * `breaker_main` / `breaker_trip` rows — and F5 can tell "the keys seen" from "every key with a
 * row" on a database where the seed's rows exist.
 *
 * **Needs migration `0097`** (the five breaker roles, `bms.point_key_states`, the layout flags).
 */

type Site = Awaited<ReturnType<typeof seedSite>>;

const LV = "lv_single_line" as const;

/** A per-run state key with OPEN (0) and CLOSED (1) rows, and a per-run TRIPPED (1) key. */
interface StateKeys {
  readonly sw: string;
  readonly trip: string;
  /** Registered and sampled like `sw`, but with no `point_key_states` row. */
  readonly plain: string;
}

async function seedStateKeys(client: pg.PoolClient, site: Site): Promise<StateKeys> {
  const prefix = `f374_${site.tag.slice(-8).toLowerCase()}`;
  const keys = { sw: `${prefix}_sw`, trip: `${prefix}_trip`, plain: `${prefix}_plain` };
  for (const code of [keys.sw, keys.trip, keys.plain]) {
    await client.query("INSERT INTO bms.point_keys (code, name, unit, headline_rank, active) VALUES ($1, $2, NULL, NULL, true)", [
      code,
      `F3.74 ${code}`,
    ]);
  }
  await client.query(
    `INSERT INTO bms.point_key_states (point_key_code, value, label, tone)
     VALUES ($1, 1, 'CLOSED', 'closed'), ($1, 0, 'OPEN', 'open'), ($2, 1, 'TRIPPED', 'tripped')`,
    [keys.sw, keys.trip],
  );
  return keys;
}

async function seedGroup(client: pg.PoolClient, site: Site, suffix = "GRP"): Promise<string> {
  const group = await one<{ id: string }>(
    client,
    `INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
     VALUES ($1, $2, $3, NULL, $4) RETURNING id`,
    [site.locationId, `${site.tag}-${suffix}`.toLowerCase(), `F3.74 group ${suffix}`, site.organizationId],
    `group ${suffix}`,
  );
  return group.id;
}

/**
 * `count` members of `role` in `groupId`, codes `<tag>-<prefix>-01…`, inserted in REVERSE code
 * order so neither insertion order nor a missing `ORDER BY` answers code order. Ids by code.
 */
async function seedMembers(
  client: pg.PoolClient,
  site: Site,
  groupId: string,
  role: string,
  count: number,
  prefix: string,
): Promise<string[]> {
  const ids: string[] = new Array(count);
  for (let index = count - 1; index >= 0; index -= 1) {
    const id = await seedAsset(client, site, `${site.tag}-${prefix}-${String(index + 1).padStart(2, "0")}`);
    await client.query("INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role) VALUES ($1, $2, $3)", [
      groupId,
      id,
      role,
    ]);
    ids[index] = id;
  }
  return ids;
}

async function registerPoint(client: pg.PoolClient, site: Site, assetId: string, key: string, active = true): Promise<void> {
  await client.query(
    `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit, active)
     VALUES ($1, $2, $3, $4, NULL, $5)`,
    [site.organizationId, assetId, key, `src_${assetId}_${key}`, active],
  );
}

async function sample(client: pg.PoolClient, assetId: string, key: string, value: number, ageSeconds: number): Promise<void> {
  await client.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     VALUES (now() - make_interval(secs => $4), $1, $2, $3, NULL)`,
    [assetId, key, value, ageSeconds],
  );
}

async function seedAlarm(client: pg.PoolClient, site: Site, assetId: string, severity: string, message: string): Promise<void> {
  await client.query(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
     VALUES ($1, $2, $3, $4, now() - interval '1 hour', NULL)`,
    [site.organizationId, assetId, severity, message],
  );
}

/** A group-scoped dashboard holding one `lv_single_line` preset mimic; `mainBreakers` members. */
interface BreakerSite {
  readonly site: Site;
  readonly groupId: string;
  readonly dashboardId: string;
  readonly mainBreakers: string[];
}

async function seedBreakerSite(client: pg.PoolClient, mainBreakers: number): Promise<BreakerSite> {
  const site = await seedSite(client);
  const groupId = await seedGroup(client, site);
  const ids = await seedMembers(client, site, groupId, "main-breaker", mainBreakers, "Q");
  const dashboardId = await seedDashboard(client, site, groupId);
  await seedMimicWidget(client, site.organizationId, dashboardId, { source: "preset", preset: LV });
  return { site, groupId, dashboardId, mainBreakers: ids };
}

async function readDashboard(client: pg.PoolClient, site: Site, dashboardId: string): Promise<DashboardMimicNodesResponseDto> {
  return readService(client as unknown as pg.Pool).read(site.organizationId, dashboardId, null, await txNowMs(client));
}

function nodeOf(dto: DashboardMimicNodesResponseDto, key: string, widgetIndex = 0): MimicNodeDto {
  const node = dto.widgets[widgetIndex]?.nodes.find((candidate) => candidate.key === key);
  if (!node) throw new Error(`node ${key} is absent from the mimic-nodes answer`);
  return node;
}

// ---------------------------------------------------------------- preset arm

/** F1 — three `main-breaker` members: three members in code order, `asset` the first, count 3. */
export async function assertFanOutAnswersEveryMemberInCodeOrder(client: pg.PoolClient): Promise<void> {
  const fixture = await seedBreakerSite(client, 3);
  const node = nodeOf(await readDashboard(client, fixture.site, fixture.dashboardId), "main_breaker");
  expect({
    members: node.members.map((member) => member.asset.id),
    asset: node.asset?.id,
    memberCount: node.memberCount,
  }).toEqual({ members: fixture.mainBreakers, asset: fixture.mainBreakers[0], memberCount: 3 });
}

/** F2 — seventeen members: the first sixteen by code, and the true count 17. */
export async function assertFanOutIsCappedAtSixteen(client: pg.PoolClient): Promise<void> {
  const fixture = await seedBreakerSite(client, 17);
  const node = nodeOf(await readDashboard(client, fixture.site, fixture.dashboardId), "main_breaker");
  expect({ members: node.members.map((member) => member.asset.id), memberCount: node.memberCount }).toEqual({
    members: fixture.mainBreakers.slice(0, 16),
    memberCount: 17,
  });
}

/**
 * F3 — a member's ACTIVE state-mapped point answers its latest sample in `statePoints`; a
 * state-mapped key registered INACTIVE on the same member is not a state point.
 */
export async function assertActiveStatePointCarriesItsLatestValue(client: pg.PoolClient): Promise<void> {
  const fixture = await seedBreakerSite(client, 2);
  const keys = await seedStateKeys(client, fixture.site);
  const [first, second] = fixture.mainBreakers as [string, string];
  await registerPoint(client, fixture.site, first, keys.sw);
  await registerPoint(client, fixture.site, first, keys.trip, false);
  await sample(client, first, keys.sw, 0, 120);
  await sample(client, first, keys.sw, 1, 10);
  await sample(client, first, keys.trip, 1, 10);
  await registerPoint(client, fixture.site, second, keys.sw);
  await sample(client, second, keys.sw, 0, 10);
  const node = nodeOf(await readDashboard(client, fixture.site, fixture.dashboardId), "main_breaker");
  const valuesOf = (points: MimicNodeDto["statePoints"]) => points.map((point) => [point.pointKey, point.latest?.value]);
  expect({
    node: valuesOf(node.statePoints),
    first: valuesOf(node.members[0]?.statePoints ?? []),
    second: valuesOf(node.members[1]?.statePoints ?? []),
  }).toEqual({ node: [[keys.sw, 1]], first: [[keys.sw, 1]], second: [[keys.sw, 0]] });
}

/** F4 — an active, sampled key with NO `point_key_states` row is not a state point. */
export async function assertKeyWithoutStateRowIsNotAStatePoint(client: pg.PoolClient): Promise<void> {
  const fixture = await seedBreakerSite(client, 1);
  const keys = await seedStateKeys(client, fixture.site);
  const [first] = fixture.mainBreakers as [string];
  await registerPoint(client, fixture.site, first, keys.sw);
  await registerPoint(client, fixture.site, first, keys.plain);
  await sample(client, first, keys.sw, 1, 10);
  await sample(client, first, keys.plain, 1, 10);
  const node = nodeOf(await readDashboard(client, fixture.site, fixture.dashboardId), "main_breaker");
  expect(node.members[0]?.statePoints.map((point) => point.pointKey)).toEqual([keys.sw]);
}

/**
 * F5 — `stateMaps` lists exactly the keys the answer's state points carry, each with every row
 * by value: not the inactive `trip` key, and not the seed's own `breaker_*` rows.
 */
export async function assertStateMapsListOnlyTheKeysSeen(client: pg.PoolClient): Promise<void> {
  const fixture = await seedBreakerSite(client, 1);
  const keys = await seedStateKeys(client, fixture.site);
  const [first] = fixture.mainBreakers as [string];
  await registerPoint(client, fixture.site, first, keys.sw);
  await registerPoint(client, fixture.site, first, keys.trip, false);
  await sample(client, first, keys.sw, 1, 10);
  const dto = await readDashboard(client, fixture.site, fixture.dashboardId);
  expect(dto.stateMaps).toEqual([
    {
      pointKey: keys.sw,
      states: [
        { value: 0, label: "OPEN", tone: "open" },
        { value: 1, label: "CLOSED", tone: "closed" },
      ],
    },
  ]);
}

/** F6 — a node without `fanOut` (`transformer`) answers `members: []` and its first member as before. */
export async function assertNonFanOutNodeHasNoMembers(client: pg.PoolClient): Promise<void> {
  const fixture = await seedBreakerSite(client, 1);
  const transformers = await seedMembers(client, fixture.site, fixture.groupId, "transformer", 2, "TX");
  const node = nodeOf(await readDashboard(client, fixture.site, fixture.dashboardId), "transformer");
  expect({ members: node.members, asset: node.asset?.id, memberCount: node.memberCount }).toEqual({
    members: [],
    asset: transformers[0],
    memberCount: 2,
  });
}

/**
 * F7 — a fan-out node's `activeAlarms` is the sum across its members and `topAlarm` the most
 * severe among them. The worst alarm is on the THIRD member, so the first member's alarm (a
 * warning) can answer neither.
 */
export async function assertFanOutAlarmsAreSummedAndWorst(client: pg.PoolClient): Promise<void> {
  const fixture = await seedBreakerSite(client, 3);
  const [first, , third] = fixture.mainBreakers as [string, string, string];
  await seedAlarm(client, fixture.site, first, "warning", "F3.74 first member warning");
  await seedAlarm(client, fixture.site, third, "critical", "F3.74 third member critical");
  await seedAlarm(client, fixture.site, third, "info", "F3.74 third member info");
  const node = nodeOf(await readDashboard(client, fixture.site, fixture.dashboardId), "main_breaker");
  expect({
    activeAlarms: node.activeAlarms,
    top: node.topAlarm?.message,
    perMember: node.members.map((member) => [member.activeAlarms, member.topAlarm?.severity ?? null]),
  }).toEqual({
    activeAlarms: 3,
    top: "F3.74 third member critical",
    perMember: [
      [1, "warning"],
      [0, null],
      [2, "critical"],
    ],
  });
}

/** F8 — a preset node with `roleCode: null` (`main_bus`) is absent; a roled one is present. */
export async function assertRolelessPresetNodeIsAbsent(client: pg.PoolClient): Promise<void> {
  const fixture = await seedBreakerSite(client, 1);
  const dto = await readDashboard(client, fixture.site, fixture.dashboardId);
  const keys = dto.widgets[0]?.nodes.map((node) => node.key) ?? [];
  expect({ mainBus: keys.includes("main_bus"), mainBreaker: keys.includes("main_breaker"), keys }).toEqual({
    mainBus: false,
    mainBreaker: true,
    keys: MIMIC_PRESETS[LV].nodes.flatMap((node) => (node.roleCode === null ? [] : [node.key])),
  });
}

/**
 * F11 — a state point's sample counts toward `latestTelemetryAt`. The member's three ranked
 * headline points were sampled an hour ago; the state key ranks past them, so it is NOT one of
 * the shown points, and its 5 s old sample is the newest.
 */
export async function assertStatePointCountsTowardFreshness(client: pg.PoolClient): Promise<void> {
  const fixture = await seedBreakerSite(client, 1);
  const keys = await seedStateKeys(client, fixture.site);
  const [first] = fixture.mainBreakers as [string];
  const ranked = [1, 2, 3].map((rank) => `${keys.sw}_r${rank}`);
  for (const [index, code] of ranked.entries()) {
    await client.query("INSERT INTO bms.point_keys (code, name, unit, headline_rank, active) VALUES ($1, $1, NULL, $2, true)", [
      code,
      index + 1,
    ]);
    await registerPoint(client, fixture.site, first, code);
    await sample(client, first, code, 5, 3600);
  }
  await registerPoint(client, fixture.site, first, keys.sw);
  await sample(client, first, keys.sw, 1, 5);
  const nowMs = await txNowMs(client);
  const node = nodeOf(await readDashboard(client, fixture.site, fixture.dashboardId), "main_breaker");
  expect({
    shown: node.asset?.points.map((point) => point.pointKey),
    latestTelemetryAt: node.asset?.latestTelemetryAt,
  }).toEqual({ shown: ranked, latestTelemetryAt: new Date(nowMs - 5_000).toISOString() });
}

// ---------------------------------------------------------------- a mimic names a tab (D7)

interface TabbedBreakerSite {
  readonly site: Site;
  readonly dashboardId: string;
  readonly groupId: string;
  readonly mainBreaker: string;
}

/** A site dashboard (no group) and one group holding one `main-breaker` member. No tabs yet. */
async function seedTabbedBreakerSite(client: pg.PoolClient): Promise<TabbedBreakerSite> {
  const site = await seedSite(client);
  const groupId = await seedGroup(client, site);
  const [mainBreaker] = (await seedMembers(client, site, groupId, "main-breaker", 1, "Q")) as [string];
  const dashboardId = await seedSiteDashboard(client, site, "tabs");
  return { site, dashboardId, groupId, mainBreaker };
}

async function seedSiteDashboard(client: pg.PoolClient, site: Site, suffix: string): Promise<string> {
  const dashboard = await one<{ id: string }>(
    client,
    `INSERT INTO bms.dashboards (organization_id, slug, name, location_id)
     VALUES ($1, $2, 'F3.74 tabbed mimic fixture', $3) RETURNING id`,
    [site.organizationId, `${site.tag}-${suffix}`.toLowerCase(), site.locationId],
    `site dashboard ${suffix}`,
  );
  return dashboard.id;
}

async function seedTab(
  client: pg.PoolClient,
  site: Site,
  dashboardId: string,
  key: string,
  groupId: string | null,
  stampOrganizationId: string = site.organizationId,
): Promise<string> {
  const tab = await one<{ id: string }>(
    client,
    `INSERT INTO bms.dashboard_tabs (organization_id, dashboard_id, location_id, asset_group_id, tab_key, label)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [stampOrganizationId, dashboardId, groupId === null ? null : site.locationId, groupId, key],
    `tab ${key}`,
  );
  return tab.id;
}

/** The Overview mimic naming `sld`, on `dashboardId`'s Overview tab. */
async function seedOverviewMimic(client: pg.PoolClient, site: Site, dashboardId: string): Promise<void> {
  const overview = await seedTab(client, site, dashboardId, "overview", null);
  await seedMimicWidget(client, site.organizationId, dashboardId, { source: "preset", preset: LV, tabKey: "sld" }, 0, overview);
}

/** F9 — an Overview mimic with `config.tabKey = 'sld'` resolves through the `sld` tab's group. */
export async function assertOverviewMimicResolvesThroughTheNamedTab(client: pg.PoolClient): Promise<void> {
  const fixture = await seedTabbedBreakerSite(client);
  await seedTab(client, fixture.site, fixture.dashboardId, "sld", fixture.groupId);
  await seedOverviewMimic(client, fixture.site, fixture.dashboardId);
  const dto = await readDashboard(client, fixture.site, fixture.dashboardId);
  expect(nodeOf(dto, "main_breaker").asset?.id).toBe(fixture.mainBreaker);
}

/**
 * F10a — `tabKey` naming a tab that exists only on ANOTHER dashboard (same organization, same
 * group) answers unassigned and does not throw.
 */
export async function assertTabKeyOfAnotherDashboardIsUnassigned(client: pg.PoolClient): Promise<void> {
  const fixture = await seedTabbedBreakerSite(client);
  const other = await seedSiteDashboard(client, fixture.site, "other");
  await seedTab(client, fixture.site, other, "sld", fixture.groupId);
  await seedOverviewMimic(client, fixture.site, fixture.dashboardId);
  const node = nodeOf(await readDashboard(client, fixture.site, fixture.dashboardId), "main_breaker");
  expect({ asset: node.asset, memberCount: node.memberCount }).toEqual({ asset: null, memberCount: 0 });
}

/**
 * F10b — an `sld` tab on THIS dashboard, bound to this organization's group but stamped with
 * ANOTHER organization's id (the fleet pool bypasses RLS), answers unassigned: the named-tab
 * join carries its own organization predicate.
 */
export async function assertForeignStampedNamedTabIsUnassigned(client: pg.PoolClient): Promise<void> {
  const fixture = await seedTabbedBreakerSite(client);
  const foreign = await seedSite(client);
  await seedTab(client, fixture.site, fixture.dashboardId, "sld", fixture.groupId, foreign.organizationId);
  await seedOverviewMimic(client, fixture.site, fixture.dashboardId);
  const node = nodeOf(await readDashboard(client, fixture.site, fixture.dashboardId), "main_breaker");
  expect({ asset: node.asset, memberCount: node.memberCount }).toEqual({ asset: null, memberCount: 0 });
}

// ---------------------------------------------------------------- layout arm (D3b)

interface FlagNode {
  readonly key: string;
  readonly symbol: string;
  readonly roleCode: string | null;
  readonly fanOut: boolean;
  readonly isSource: boolean;
  readonly x: number;
}

/** One layout of units only, each with its stored `fan_out` / `is_source`; answers its id. */
async function seedFlagLayout(client: pg.PoolClient, site: Site, nodes: readonly FlagNode[]): Promise<string> {
  const layout = await one<{ id: string }>(
    client,
    `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h)
     VALUES ($1, 'F3.74 fixture SLD', $2, 60, 40) RETURNING id`,
    [site.organizationId, `f374-${randomUUID().slice(0, 8)}`],
    "the layout",
  );
  for (const node of nodes) {
    await client.query(
      `INSERT INTO bms.mimic_layout_nodes
         (organization_id, layout_id, key, kind, symbol, label, role_code, tone, x, y, w, h, z, fan_out, is_source)
       VALUES ($1, $2, $3, 'unit', $4, $3, $5, NULL, $6, 10, 6, 6, 1, $7, $8)`,
      [site.organizationId, layout.id, node.key, node.symbol, node.roleCode, node.x, node.fanOut, node.isSource],
    );
  }
  return layout.id;
}

const SLD_UNITS: readonly FlagNode[] = [
  { key: "src", symbol: "transformer", roleCode: "incoming-supply", fanOut: false, isSource: true, x: 2 },
  { key: "qf", symbol: "breaker", roleCode: "main-breaker", fanOut: true, isSource: false, x: 20 },
  { key: "qs", symbol: "breaker", roleCode: "main-breaker", fanOut: false, isSource: false, x: 40 },
];

async function readLayoutWidget(client: pg.PoolClient): Promise<{ widget: MimicLayoutWidgetNodesDto; mainBreakers: string[] }> {
  const site = await seedSite(client);
  const groupId = await seedGroup(client, site);
  const mainBreakers = await seedMembers(client, site, groupId, "main-breaker", 3, "Q");
  const dashboardId = await seedDashboard(client, site, groupId);
  const layoutId = await seedFlagLayout(client, site, SLD_UNITS);
  await seedMimicWidget(client, site.organizationId, dashboardId, { source: "layout", layoutId });
  const widget = (await readDashboard(client, site, dashboardId)).widgets[0];
  if (widget?.source !== "layout") throw new Error("no layout widget in the mimic-nodes answer");
  return { widget, mainBreakers };
}

function layoutNode(widget: MimicLayoutWidgetNodesDto, key: string): MimicNodeDto {
  const node = widget.nodes.find((candidate) => candidate.key === key);
  if (!node) throw new Error(`layout unit ${key} is absent from the mimic-nodes answer`);
  return node;
}

/** F12 — a `breaker` unit stored with `fan_out = true` and three role members answers three members. */
export async function assertLayoutFanOutUnitAnswersEveryMember(client: pg.PoolClient): Promise<void> {
  const { widget, mainBreakers } = await readLayoutWidget(client);
  expect(layoutNode(widget, "qf").members.map((member) => member.asset.id)).toEqual(mainBreakers);
}

/** F13 — the layout geometry in the response carries each node's stored `fanOut` and `isSource`. */
export async function assertLayoutGeometryCarriesTheStoredFlags(client: pg.PoolClient): Promise<void> {
  const { widget } = await readLayoutWidget(client);
  expect(widget.layout.nodes.map((node) => [node.key, node.fanOut, node.isSource])).toEqual(
    SLD_UNITS.map((node) => [node.key, node.fanOut, node.isSource]),
  );
}

/** F14 — a unit with `fan_out = false` and three members answers the first, no members, count 3. */
export async function assertLayoutUnitWithoutFanOutShowsOneMember(client: pg.PoolClient): Promise<void> {
  const { widget, mainBreakers } = await readLayoutWidget(client);
  const node = layoutNode(widget, "qs");
  expect({ asset: node.asset?.id, members: node.members, memberCount: node.memberCount }).toEqual({
    asset: mainBreakers[0],
    members: [],
    memberCount: 3,
  });
}
