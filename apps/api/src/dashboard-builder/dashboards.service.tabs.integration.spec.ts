import { BadRequestException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { putDashboardWidgetsBodySchema, TAB_GROUP_SCOPE_MESSAGE, TAB_LOCATION_MOVE_MESSAGE } from "./dashboards.schema";
import type { DashboardsService } from "./dashboards.service";

/**
 * `F3.73` (plan D1, D2, Task 1.4) — `DashboardsService`'s tabs against a real database. A new
 * sibling, not an addition to `dashboards.service.rls.integration.spec.ts`/`.test.ts`: those two
 * sit at 981 and 939 lines against the §4.5 1000-line cap, and `dashboards.service.mimic.spec.ts`
 * is the precedent for the split. Assertions live here; `dashboards.service.tabs.integration.test.ts`
 * is the Vitest entry point (ADR 0014) and owns the fixture, the pools and the cleanup.
 */

export type TabsFixture = {
  readonly service: DashboardsService;
  readonly actor: JwtPayload;
  /** `bms_fleet` (BYPASSRLS) — sees every row, so a read here proves a write committed. */
  readonly fleetPool: pg.Pool;
  /** A genuine superuser — the only role that can write the cross-organization row. */
  readonly superuserPool: pg.Pool;
  readonly phewbOrgId: string;
  readonly siteDashboardId: string;
  readonly siteDashboardSlug: string;
  readonly overviewOnlyDashboardId: string;
  /** Two tabs without groups, for the key swap. */
  readonly swapDashboardId: string;
  readonly otherLocationId: string;
  readonly groupHereId: string;
  readonly groupElsewhereId: string;
  readonly phewbGroupId: string;
};

const tile = (tabKey: string, id?: string) => ({
  ...(id === undefined ? {} : { id }),
  tabKey,
  widgetType: "value_tile",
  title: "Active alarms",
  gridX: 0,
  gridY: 0,
  gridW: 3,
  gridH: 2,
  config: {},
  points: [],
  sources: [{ catalogKey: "alarms.active.count", params: {} }],
});

const mimic = (tabKey: string) => ({
  tabKey,
  widgetType: "mimic",
  title: "Electrical",
  gridX: 0,
  gridY: 4,
  gridW: 12,
  gridH: 6,
  config: { source: "preset", preset: "water_train" },
  points: [],
});

async function tabIdsOnDisk(f: TabsFixture, dashboardId: string): Promise<Map<string, string>> {
  const rows = await f.fleetPool.query<{ id: string; tab_key: string }>(
    `SELECT id, tab_key FROM bms.dashboard_tabs WHERE dashboard_id = $1`,
    [dashboardId],
  );
  return new Map(rows.rows.map((row) => [row.tab_key, row.id]));
}

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return undefined;
}

/** A PUT with tabs stores both tabs and each widget's `tab_id`, and the DTO carries them. */
export async function putWithTabsStoresTabIds(f: TabsFixture): Promise<void> {
  const dto = await f.service.putWidgets(
    f.actor,
    f.siteDashboardId,
    putDashboardWidgetsBodySchema.parse({
      tabs: [
        { key: "overview", label: "Overview", sortOrder: 0 },
        { key: "electrical", label: "Electrical", sortOrder: 1, assetGroupId: f.groupHereId },
      ],
      widgets: [tile("overview"), mimic("electrical")],
    }),
  );
  const onDisk = await tabIdsOnDisk(f, f.siteDashboardId);
  expect([...onDisk.keys()].sort(), "both tabs must be stored").toEqual(["electrical", "overview"]);
  expect(dto.tabs.map((tab) => tab.key), "the DTO lists the tabs in sort order").toEqual(["overview", "electrical"]);
  expect(dto.tabs[1]?.assetGroupId).toBe(f.groupHereId);

  const widgets = await f.fleetPool.query<{ widget_type: string; tab_id: string | null }>(
    `SELECT widget_type, tab_id FROM bms.dashboard_widgets WHERE dashboard_id = $1`,
    [f.siteDashboardId],
  );
  const byType = new Map(widgets.rows.map((row) => [row.widget_type, row.tab_id]));
  expect(byType.get("value_tile"), "the tile is stored on the overview tab").toBe(onDisk.get("overview"));
  expect(byType.get("mimic"), "the mimic is stored on the electrical tab").toBe(onDisk.get("electrical"));
  const dtoMimic = dto.widgets.find((widget) => widget.widgetType === "mimic");
  expect(dtoMimic?.tabId, "the DTO widget carries its tabId").toBe(onDisk.get("electrical"));
  // Another dashboard of the same organization keeps its tab: the PUT wrote this dashboard only.
  const neighbour = await tabIdsOnDisk(f, f.overviewOnlyDashboardId);
  expect([...neighbour.keys()], "the neighbouring dashboard's tab is untouched").toEqual(["overview"]);
}

/**
 * Two kept tabs swap their keys. The key UNIQUE is not deferrable, so this passes only through
 * the placeholder key `writeDashboardTabs` writes first; without it the first UPDATE is a 23505.
 */
export async function twoTabsSwapTheirKeys(f: TabsFixture): Promise<void> {
  const put = (tabs: unknown[], widgets: unknown[]) =>
    f.service.putWidgets(f.actor, f.swapDashboardId, putDashboardWidgetsBodySchema.parse({ tabs, widgets }));
  const first = await put(
    [
      { key: "left", label: "Left", sortOrder: 0 },
      { key: "right", label: "Right", sortOrder: 1 },
    ],
    [tile("left"), { ...tile("right"), gridY: 2 }],
  );
  const leftId = first.tabs.find((tab) => tab.key === "left")?.id ?? "";
  const rightId = first.tabs.find((tab) => tab.key === "right")?.id ?? "";
  const onLeft = first.widgets.find((widget) => widget.tabId === leftId)?.id;
  const onRight = first.widgets.find((widget) => widget.tabId === rightId)?.id;

  const swapped = await put(
    [
      { id: leftId, key: "right", label: "Left", sortOrder: 0 },
      { id: rightId, key: "left", label: "Right", sortOrder: 1 },
    ],
    [tile("right", onLeft), { ...tile("left", onRight), gridY: 2 }],
  );
  expect(swapped.tabs.map((tab) => [tab.id, tab.key]), "each tab keeps its id and takes the other key").toEqual([
    [leftId, "right"],
    [rightId, "left"],
  ]);
  expect(swapped.widgets.find((widget) => widget.id === onLeft)?.tabId, "a widget stays on its tab").toBe(leftId);
  expect(swapped.widgets.find((widget) => widget.id === onRight)?.tabId).toBe(rightId);
}

/**
 * Dropping a tab while its widget moves to another tab keeps the widget. The widgets' FK to the
 * tab cascades, so a tab deleted before its kept widget is moved would take the widget with it.
 */
export async function aKeptWidgetSurvivesTheDeleteOfItsOldTab(f: TabsFixture): Promise<void> {
  const before = await tabIdsOnDisk(f, f.siteDashboardId);
  const stored = await f.fleetPool.query<{ id: string }>(
    `SELECT id FROM bms.dashboard_widgets WHERE dashboard_id = $1 AND widget_type = 'value_tile'`,
    [f.siteDashboardId],
  );
  const tileId = stored.rows[0]?.id ?? "";
  const dto = await f.service.putWidgets(
    f.actor,
    f.siteDashboardId,
    putDashboardWidgetsBodySchema.parse({
      tabs: [
        { id: before.get("electrical"), key: "electrical", label: "Electrical", sortOrder: 0, assetGroupId: f.groupHereId },
      ],
      widgets: [tile("electrical", tileId), mimic("electrical")],
    }),
  );
  const after = await tabIdsOnDisk(f, f.siteDashboardId);
  expect([...after.keys()], "the overview tab is deleted").toEqual(["electrical"]);
  expect(after.get("electrical"), "the kept tab keeps its id").toBe(before.get("electrical"));
  const moved = dto.widgets.find((widget) => widget.id === tileId);
  expect(moved, "the tile the body kept must survive the delete of its old tab").toBeDefined();
  expect(moved?.tabId).toBe(before.get("electrical"));
}

async function expectLocationMoveRefused(f: TabsFixture, body: Parameters<DashboardsService["update"]>[2]): Promise<void> {
  const caught = await refusal(() => f.service.update(f.actor, f.siteDashboardId, body));
  expect(caught, `${JSON.stringify(body)} must be refused with a 400, got ${String(caught)}`).toBeInstanceOf(
    BadRequestException,
  );
  expect((caught as BadRequestException).message).toBe(TAB_LOCATION_MOVE_MESSAGE);
}

export async function patchToAnotherSiteIsRefused(f: TabsFixture): Promise<void> {
  await expectLocationMoveRefused(f, { locationId: f.otherLocationId });
}

export async function patchToOrgWideIsRefused(f: TabsFixture): Promise<void> {
  await expectLocationMoveRefused(f, { locationId: null });
}

export async function patchToAGroupScopeIsRefused(f: TabsFixture): Promise<void> {
  await expectLocationMoveRefused(f, { locationId: null, assetGroupId: f.groupHereId });
}

/** An Overview tab stores `location_id NULL`, so its composite FK is inert and the move is legal. */
export async function patchOnAnOverviewOnlyDashboardSucceeds(f: TabsFixture): Promise<void> {
  const moved = await f.service.update(f.actor, f.overviewOnlyDashboardId, { locationId: f.otherLocationId });
  expect(moved.locationId).toBe(f.otherLocationId);
  expect(moved.tabs.map((tab) => tab.key)).toEqual(["overview"]);
}

async function expectGroupRefused(f: TabsFixture, groupId: string): Promise<void> {
  const caught = await refusal(() =>
    f.service.putWidgets(
      f.actor,
      f.siteDashboardId,
      putDashboardWidgetsBodySchema.parse({
        tabs: [{ key: "foreign", label: "Foreign", sortOrder: 0, assetGroupId: groupId }],
        widgets: [],
      }),
    ),
  );
  expect(caught, `a tab naming group ${groupId} must be a 400, got ${String(caught)}`).toBeInstanceOf(
    BadRequestException,
  );
  const message = (caught as BadRequestException).message;
  expect(message).toBe(TAB_GROUP_SCOPE_MESSAGE);
  expect(message.includes(groupId), "the 400 never echoes the group id").toBe(false);
}

export async function aGroupOfAnotherOrganizationIsRefused(f: TabsFixture): Promise<void> {
  await expectGroupRefused(f, f.phewbGroupId);
}

export async function aGroupAtAnotherSiteIsRefused(f: TabsFixture): Promise<void> {
  await expectGroupRefused(f, f.groupElsewhereId);
}

/**
 * The fleet predicate on the tabs read — the `dashboard-source-scope` fixture shape. A PHEWB-
 * stamped tab on the ESKOM dashboard is written as the superuser (every other role's policy
 * refuses it), shown to exist through the fleet pool, and then must not appear in `getBySlug`'s
 * DTO, which a global admin reads on the BYPASSRLS fleet branch.
 */
export async function theFleetReadOmitsAForeignStampedTab(f: TabsFixture): Promise<void> {
  const leak = await f.superuserPool.query<{ id: string }>(
    `INSERT INTO bms.dashboard_tabs (organization_id, dashboard_id, tab_key, label, sort_order)
     VALUES ($1, $2, 'phewb-leak', 'PHEWB leak', 99) RETURNING id`,
    [f.phewbOrgId, f.siteDashboardId],
  );
  const leakId = leak.rows[0]?.id ?? "";
  try {
    const onDisk = await f.fleetPool.query(`SELECT 1 FROM bms.dashboard_tabs WHERE id = $1 AND organization_id = $2`, [
      leakId,
      f.phewbOrgId,
    ]);
    expect(onDisk.rows.length, "the manufactured PHEWB-stamped tab must exist on disk").toBe(1);

    const dto = await f.service.getBySlug(f.actor, f.siteDashboardSlug);
    expect(dto.tabs.map((tab) => tab.key), "the ESKOM tabs only — never the PHEWB-stamped row").toEqual([
      "electrical",
    ]);
  } finally {
    await f.superuserPool.query(`DELETE FROM bms.dashboard_tabs WHERE id = $1`, [leakId]);
  }
}
