import { BadRequestException } from "@nestjs/common";

import {
  dashboardWidgetDtoSchema,
  MIMIC_SCOPE_MESSAGE,
  TAB_GROUP_SCOPE_MESSAGE,
  TAB_ID_UNKNOWN_MESSAGE,
  TAB_LOCATION_MOVE_MESSAGE,
} from "@bms/shared";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  PutDashboardWidgetsBody,
  TabWriteBody,
  WidgetWriteBody,
} from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import type { MasterDataAuditService } from "../admin/master-data-audit.service";
import { diffTabs, diffWidgets, mapDashboardWidget, tabIdsByKey, type StoredWidgetForDiff } from "./dashboards.pure";
import { DashboardsService } from "./dashboards.service";

/**
 * `F3.73` (plan D2, Task 1.4) — the tabs half of `DashboardsService.putWidgets` and its pure
 * helpers, with no database (§4.6). A new sibling of `dashboards.service.spec.ts` so each claim
 * gets its own `it()`; `dashboards.service.tabs.test.ts` is the Vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const DASHBOARD_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION_ID = "77777777-7777-4777-8777-777777777777";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const TAB_OVERVIEW = "aaaaaaaa-0000-4000-8000-000000000001";
const TAB_ELECTRICAL = "aaaaaaaa-0000-4000-8000-000000000002";
const FOREIGN_TAB = "bbbbbbbb-0000-4000-8000-00000000f00d";
const WIDGET_A = "cccccccc-0000-4000-8000-00000000000a";
const POINT_A = "44444444-4444-4444-8444-444444444444";

const FAKE_JWT = {} as unknown as JwtPayload;

const dashboardRow = {
  id: DASHBOARD_ID,
  organizationId: ORG_ID,
  slug: "site-overview",
  name: "Site overview",
  description: null,
  locationId: null as string | null,
  assetGroupId: null,
  templateId: null,
  assetId: null,
  assetTemplateId: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-02T00:00:00.000Z"),
};

function fakeAccessControl(): AccessControlService {
  return {
    assertOperationsWriteRole: async () => undefined,
    canManageDashboard: async () => true,
  } as unknown as AccessControlService;
}

const fakeAudit = (): MasterDataAuditService => ({}) as unknown as MasterDataAuditService;

/** A thenable answering every Drizzle builder call with itself and resolving to `rows`. */
function chain(rows: unknown[]): unknown {
  const self: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "orderBy", "for", "innerJoin", "leftJoin"]) {
    self[method] = () => self;
  }
  self.then = (resolve: (value: unknown[]) => void) => resolve(rows);
  return self;
}

/** `fetchRowForWrite`'s read, answered with `row`. */
function fleetDbWith(row: typeof dashboardRow): BmsDb {
  return { select: () => chain([row]) } as unknown as BmsDb;
}

const SENTINEL = new Error("F3.73: the fake transaction opened — every guard before it passed");

/** Counts `.transaction` calls and then rejects with `SENTINEL`: a guard that must run before the
 * transaction leaves `calls() === 0`; a body the guards accept reaches it, `calls() === 1`. */
function countingTenantDb(): { db: BmsDb; calls: () => number } {
  let count = 0;
  const db = {
    transaction: async () => {
      count += 1;
      throw SENTINEL;
    },
  } as unknown as BmsDb;
  return { db, calls: () => count };
}

/** A transaction whose every read answers `[]`: this dashboard stores no tab, no widget. */
function emptyStoreTenantDb(): BmsDb {
  const tx = { execute: async () => undefined, select: () => chain([]) };
  return {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as BmsDb;
}

const mimic = (tabKey: string): WidgetWriteBody =>
  ({
    tabKey,
    gridX: 0,
    gridY: 0,
    gridW: 12,
    gridH: 6,
    widgetType: "mimic",
    config: { source: "preset", preset: "water_train" },
    points: [],
    sources: [],
  }) as unknown as WidgetWriteBody;

const overviewTab: TabWriteBody = { key: "overview", label: "Overview", sortOrder: 0, assetGroupId: null };
const electricalTab: TabWriteBody = { key: "electrical", label: "Electrical", sortOrder: 1, assetGroupId: GROUP_ID };

async function putWidgetsCatching(
  db: BmsDb,
  row: typeof dashboardRow,
  body: PutDashboardWidgetsBody,
): Promise<unknown> {
  const service = new DashboardsService(db, fleetDbWith(row), fakeAccessControl(), fakeAudit());
  try {
    await service.putWidgets(FAKE_JWT, DASHBOARD_ID, body);
  } catch (err) {
    return err;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The per-tab mimic guard (plan D2): the dashboard's group OR the widget's tab's group.
// ---------------------------------------------------------------------------

export async function mimicOnAGroupTabOfASiteDashboardIsAccepted(): Promise<void> {
  const { db, calls } = countingTenantDb();
  const caught = await putWidgetsCatching(db, { ...dashboardRow, locationId: LOCATION_ID }, {
    tabs: [overviewTab, electricalTab],
    widgets: [mimic("electrical")],
  });
  assert(
    caught === SENTINEL,
    `a mimic on a tab bound to a group must pass every pre-transaction guard, got ${String(caught)}`,
  );
  assert(calls() === 1, "the accepted mimic must reach the transaction");
}

export async function mimicOnTheOverviewTabIsRefused(): Promise<void> {
  const { db, calls } = countingTenantDb();
  const caught = await putWidgetsCatching(db, { ...dashboardRow, locationId: LOCATION_ID }, {
    tabs: [overviewTab, electricalTab],
    widgets: [mimic("overview")],
  });
  assert(caught instanceof BadRequestException, `a mimic on the Overview tab must be a 400, got ${String(caught)}`);
  assert(
    (caught as BadRequestException).message === MIMIC_SCOPE_MESSAGE,
    `the refusal must be MIMIC_SCOPE_MESSAGE, got: ${(caught as BadRequestException).message}`,
  );
  assert(calls() === 0, "the mimic refusal must come before the transaction opens");
}

export async function groupTabOnAnOrgWideDashboardIsRefused(): Promise<void> {
  const { db, calls } = countingTenantDb();
  const caught = await putWidgetsCatching(db, dashboardRow, {
    tabs: [electricalTab],
    widgets: [],
  });
  assert(caught instanceof BadRequestException, `a group tab on an org-wide dashboard must be a 400, got ${String(caught)}`);
  assert(
    (caught as BadRequestException).message === TAB_GROUP_SCOPE_MESSAGE,
    `the refusal must be TAB_GROUP_SCOPE_MESSAGE, got: ${(caught as BadRequestException).message}`,
  );
  assert(calls() === 0, "the group-scope refusal must come before the transaction opens");
}

export async function aTabIdOfAnotherDashboardIsRefusedWithoutEchoingIt(): Promise<void> {
  const caught = await putWidgetsCatching(emptyStoreTenantDb(), { ...dashboardRow, locationId: LOCATION_ID }, {
    tabs: [{ ...overviewTab, id: FOREIGN_TAB }],
    widgets: [],
  });
  assert(caught instanceof BadRequestException, `a foreign tab id must be a 400, got ${String(caught)}`);
  const message = (caught as BadRequestException).message;
  assert(message === TAB_ID_UNKNOWN_MESSAGE, `the refusal must be TAB_ID_UNKNOWN_MESSAGE, got: ${message}`);
  assert(!message.includes(FOREIGN_TAB), "the 400 must never echo the submitted tab id");
}

// ---------------------------------------------------------------------------
// translateWriteError — the location-move FK becomes a 400 whatever the next scope is.
// ---------------------------------------------------------------------------

export async function aLocationMoveToOrgWideIsA400(): Promise<void> {
  const fkError = { code: "23503", constraint: "dashboard_tabs_dashboard_id_location_id_fkey" };
  const service = new DashboardsService(
    { transaction: async () => Promise.reject(fkError) } as unknown as BmsDb,
    fleetDbWith({ ...dashboardRow, locationId: LOCATION_ID }),
    fakeAccessControl(),
    fakeAudit(),
  );
  let caught: unknown;
  try {
    // `locationId: null` leaves every scope axis null — the case `field === null` returns raw.
    await service.update(FAKE_JWT, DASHBOARD_ID, { locationId: null });
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof BadRequestException, `the tab FK on an org-wide move must be a 400, got ${JSON.stringify(caught)}`);
  assert(
    (caught as BadRequestException).message === TAB_LOCATION_MOVE_MESSAGE,
    `the refusal must be TAB_LOCATION_MOVE_MESSAGE, got: ${(caught as BadRequestException).message}`,
  );
}

// ---------------------------------------------------------------------------
// The pure helpers.
// ---------------------------------------------------------------------------

const storedTile = (tabId: string | null): StoredWidgetForDiff => ({
  id: WIDGET_A,
  tabId,
  widgetType: "value_tile",
  title: "kW",
  gridX: 0,
  gridY: 0,
  gridW: 3,
  gridH: 2,
  config: {},
  points: [{ pointId: POINT_A, role: "primary", sortOrder: 0 }],
  sources: [],
});

const submittedTile = (tabKey: string | undefined): WidgetWriteBody =>
  ({
    id: WIDGET_A,
    ...(tabKey === undefined ? {} : { tabKey }),
    widgetType: "value_tile",
    title: "kW",
    gridX: 0,
    gridY: 0,
    gridW: 3,
    gridH: 2,
    config: {},
    points: [{ pointId: POINT_A, role: "primary", sortOrder: 0 }],
    sources: [],
  }) as unknown as WidgetWriteBody;

const keptTabs: TabWriteBody[] = [
  { ...overviewTab, id: TAB_OVERVIEW },
  { ...electricalTab, id: TAB_ELECTRICAL },
];

export function aWidgetMovedBetweenTabsIsAnUpdate(): void {
  const diff = diffWidgets([storedTile(TAB_OVERVIEW)], [submittedTile("electrical")], tabIdsByKey(keptTabs));
  assert(
    diff.updates.length === 1 && diff.unchangedIds.length === 0,
    `a widget whose only change is its tab must be an UPDATE, got updates=${diff.updates.length} ` +
      `unchanged=${JSON.stringify(diff.unchangedIds)}`,
  );
}

export function aWidgetOnItsOwnTabIsUnchanged(): void {
  const diff = diffWidgets([storedTile(TAB_ELECTRICAL)], [submittedTile("electrical")], tabIdsByKey(keptTabs));
  assert(
    diff.unchangedIds.length === 1 && diff.updates.length === 0,
    `a widget left on its own tab must be UNCHANGED, got updates=${diff.updates.length}`,
  );
}

export function aWidgetMovedOntoANewTabIsAnUpdate(): void {
  const diff = diffWidgets(
    [storedTile(TAB_OVERVIEW)],
    [submittedTile("hvac")],
    tabIdsByKey([...keptTabs, { key: "hvac", label: "HVAC", sortOrder: 2, assetGroupId: null }]),
  );
  assert(diff.updates.length === 1, "a widget moved onto a tab with no id yet must be an UPDATE");
}

export function aLegacyWidgetStaysUnchanged(): void {
  const diff = diffWidgets([storedTile(null)], [submittedTile(undefined)], tabIdsByKey([]));
  assert(diff.unchangedIds.length === 1, "a legacy widget with no tab, re-saved, must be UNCHANGED");
}

export function diffTabsSortsKeptNewAndDeleted(): void {
  const stored = [
    { id: TAB_OVERVIEW, tabKey: "overview", label: "Overview", sortOrder: 0, assetGroupId: null },
    { id: TAB_ELECTRICAL, tabKey: "electrical", label: "Electrical", sortOrder: 1, assetGroupId: GROUP_ID },
  ];
  const diff = diffTabs(stored, [
    { ...overviewTab, id: TAB_OVERVIEW },
    { key: "hvac", label: "HVAC", sortOrder: 1, assetGroupId: null },
  ]);
  assert(
    JSON.stringify(diff.unchangedIds) === JSON.stringify([TAB_OVERVIEW]),
    `the untouched tab keeps its id, got ${JSON.stringify(diff.unchangedIds)}`,
  );
  assert(diff.inserts.length === 1 && diff.inserts[0]?.key === "hvac", "the id-less tab is an insert");
  assert(
    JSON.stringify(diff.deleteIds) === JSON.stringify([TAB_ELECTRICAL]),
    `the omitted stored tab is deleted, got ${JSON.stringify(diff.deleteIds)}`,
  );
  const relabelled = diffTabs(stored, [{ ...overviewTab, id: TAB_OVERVIEW, label: "Summary" }]);
  assert(
    relabelled.updates.length === 1 && relabelled.updates[0]?.id === TAB_OVERVIEW,
    "a kept tab whose label changed is an update",
  );
}

export function mapDashboardWidgetCarriesTabId(): void {
  const widget = mapDashboardWidget(
    {
      id: WIDGET_A,
      organizationId: ORG_ID,
      dashboardId: DASHBOARD_ID,
      tabId: TAB_ELECTRICAL,
      widgetType: "value_tile",
      title: null,
      gridX: 0,
      gridY: 0,
      gridW: 3,
      gridH: 2,
      config: {},
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    },
    [],
  );
  assert(widget.tabId === TAB_ELECTRICAL, `mapDashboardWidget must copy tabId, got ${String(widget.tabId)}`);
  const parsed = dashboardWidgetDtoSchema.safeParse(widget);
  assert(parsed.success, `the widget DTO must parse: ${JSON.stringify(parsed.success ? null : parsed.error.issues)}`);
}
