import { ConflictException } from "@nestjs/common";

import { dashboardSummaryDtoSchema, dashboardWidgetDtoSchema } from "@bms/shared";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import type { MasterDataAuditService } from "../admin/master-data-audit.service";
import {
  diffWidgets,
  mapDashboardSummary,
  mapDashboardWidget,
  DashboardsService,
  type StoredWidgetForDiff,
} from "./dashboards.service";
import type { CreateDashboardBody, UpdateDashboardBody, WidgetWriteBody } from "./dashboards.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const DASHBOARD_ID = "22222222-2222-4222-8222-222222222222";
const WIDGET_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WIDGET_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WIDGET_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const POINT_A = "44444444-4444-4444-8444-444444444444";
const ASSET_A = "55555555-5555-4555-8555-555555555555";

const dashboardRow = {
  id: DASHBOARD_ID,
  organizationId: ORG_ID,
  slug: "overview",
  name: "Overview",
  description: null,
  locationId: null,
  assetGroupId: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-02T00:00:00.000Z"),
};

const widgetRow = {
  id: WIDGET_A,
  organizationId: ORG_ID,
  dashboardId: DASHBOARD_ID,
  widgetType: "chart",
  title: "Load",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 4,
  config: { series: "line" },
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const resolvedPoint = {
  id: "66666666-6666-4666-8666-666666666666",
  widgetId: WIDGET_A,
  pointId: POINT_A,
  role: "primary",
  sortOrder: 0,
  assetId: ASSET_A,
  pointKey: "kw",
  unit: "kW",
};

/**
 * `F3.1b` Task 4 — pure-logic unit tests for `DashboardsService` (§4.6: no database).
 * Assertions live here; `dashboards.service.test.ts` is the Vitest entry point (ADR 0014).
 */
export function runDashboardsServiceUnitTests(): void {
  // -------------------------------------------------------------------------
  // The row -> DTO mappers' output parses against the shared contract — the
  // one thing catching API drift from the contract without a database.
  // -------------------------------------------------------------------------
  const summary = mapDashboardSummary(dashboardRow, 3);
  const summaryParsed = dashboardSummaryDtoSchema.safeParse(summary);
  assert(
    summaryParsed.success === true,
    `mapDashboardSummary's output must parse against dashboardSummaryDtoSchema: ${JSON.stringify(
      summaryParsed.success ? null : summaryParsed.error.issues,
    )}`,
  );
  assert(summary.widgetCount === 3, "mapDashboardSummary must carry the passed widget count");

  const widget = mapDashboardWidget(widgetRow, [resolvedPoint]);
  const widgetParsed = dashboardWidgetDtoSchema.safeParse(widget);
  assert(
    widgetParsed.success === true,
    `mapDashboardWidget's output must parse against dashboardWidgetDtoSchema: ${JSON.stringify(
      widgetParsed.success ? null : widgetParsed.error.issues,
    )}`,
  );
  if (widgetParsed.success && widgetParsed.data.widgetType === "chart") {
    assert(
      widgetParsed.data.config.series === "line",
      "the parsed widget DTO must narrow on widgetType through to its config",
    );
  }
  assert(
    widget.points[0]?.assetId === ASSET_A && widget.points[0]?.pointKey === "kw",
    "mapDashboardWidget must carry the resolved assetId/pointKey through onto each point",
  );

  // -------------------------------------------------------------------------
  // The widget sync diff (D2): three stored widgets, a body with one
  // unchanged id, one changed id and one with no id.
  // -------------------------------------------------------------------------
  const stored: StoredWidgetForDiff[] = [
    {
      id: WIDGET_A,
      widgetType: "chart",
      title: "Load",
      gridX: 0,
      gridY: 0,
      gridW: 6,
      gridH: 4,
      config: { series: "line" },
      points: [{ pointId: POINT_A, role: "primary", sortOrder: 0 }],
      // `F3.35` Stage C. Required, not optional — an omission here is a TypeError at run time
      // rather than a type error, exactly as Unit 1's six fixtures were.
      sources: [],
    },
    {
      id: WIDGET_B,
      widgetType: "value_tile",
      title: "Total kW",
      gridX: 6,
      gridY: 0,
      gridW: 3,
      gridH: 2,
      config: {},
      points: [{ pointId: POINT_A, role: "primary", sortOrder: 0 }],
      sources: [],
    },
    {
      id: WIDGET_C,
      widgetType: "value_tile",
      title: "Retiring",
      gridX: 9,
      gridY: 0,
      gridW: 3,
      gridH: 2,
      config: {},
      points: [],
      sources: [],
    },
  ];

  const unchangedSubmission: WidgetWriteBody = {
    id: WIDGET_A,
    widgetType: "chart",
    title: "Load",
    gridX: 0,
    gridY: 0,
    gridW: 6,
    gridH: 4,
    config: { series: "line" },
    points: [{ pointId: POINT_A, role: "primary", sortOrder: 0 }],
  } as WidgetWriteBody;

  const changedSubmission: WidgetWriteBody = {
    id: WIDGET_B,
    widgetType: "value_tile",
    title: "Total kW (renamed)",
    gridX: 6,
    gridY: 0,
    gridW: 3,
    gridH: 2,
    config: {},
    points: [{ pointId: POINT_A, role: "primary", sortOrder: 0 }],
  } as WidgetWriteBody;

  const newSubmission: WidgetWriteBody = {
    widgetType: "value_tile",
    title: "New tile",
    gridX: 0,
    gridY: 4,
    gridW: 3,
    gridH: 2,
    config: {},
    points: [{ pointId: POINT_A, role: "primary", sortOrder: 0 }],
  } as WidgetWriteBody;

  const diff = diffWidgets(stored, [unchangedSubmission, changedSubmission, newSubmission]);

  assert(
    diff.updates.length === 1 && diff.updates[0]?.id === WIDGET_B,
    `expected exactly one update (widget B), got ${JSON.stringify(diff.updates.map((w) => w.id))}`,
  );
  assert(
    diff.inserts.length === 1,
    `expected exactly one insert (the id-less widget), got ${diff.inserts.length}`,
  );
  assert(
    diff.deleteIds.length === 1 && diff.deleteIds[0] === WIDGET_C,
    `expected exactly one delete (widget C, absent from the submitted set), got ${JSON.stringify(diff.deleteIds)}`,
  );
  assert(
    diff.unchangedIds.length === 1 && diff.unchangedIds[0] === WIDGET_A,
    `the untouched widget (A) must keep its id and generate no update — got ${JSON.stringify(diff.unchangedIds)}`,
  );

  // -------------------------------------------------------------------------
  // `F3.35` Stage C — the diff must see a CATALOG binding change.
  //
  // This is the correctness risk of Unit 3, and it fails silently in the one
  // direction that matters. A widget whose only change is its catalog entry has
  // an identical type, title, grid and config; if `sources` is absent from
  // `widgetContentEqual`, that widget lands in `unchangedIds`, `putWidgets`
  // writes nothing, and the `PUT` answers 200 carrying the OLD binding. The
  // author sees their change accepted and the tile keeps resolving the previous
  // metric.
  // -------------------------------------------------------------------------
  const sourceStored: StoredWidgetForDiff[] = [
    {
      id: WIDGET_B,
      widgetType: "value_tile",
      title: "Alarms",
      gridX: 6,
      gridY: 0,
      gridW: 3,
      gridH: 2,
      config: {},
      points: [],
      sources: [{ catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }],
    },
  ];

  const rebound: WidgetWriteBody = {
    id: WIDGET_B,
    widgetType: "value_tile",
    title: "Alarms",
    gridX: 6,
    gridY: 0,
    gridW: 3,
    gridH: 2,
    config: {},
    points: [],
    sources: [{ catalogKey: "workorders.open.count", params: {}, sortOrder: 0 }],
  } as unknown as WidgetWriteBody;

  const reboundDiff = diffWidgets(sourceStored, [rebound]);
  assert(
    reboundDiff.updates.length === 1 && reboundDiff.updates[0]?.id === WIDGET_B,
    "a widget whose only change is its catalog binding must be an UPDATE, not unchanged — " +
      `got updates=${JSON.stringify(reboundDiff.updates.map((w) => w.id))} unchanged=${JSON.stringify(reboundDiff.unchangedIds)}`,
  );

  // The mirror, and it is not symmetry: without a sort before the comparison, two identical
  // binding sets in a different array order would diff as a change, and every re-save of an
  // untouched dashboard would rewrite every widget. `pointSortKey` exists for this on the point
  // side.
  const reorderedStored: StoredWidgetForDiff[] = [
    {
      ...(sourceStored[0] as StoredWidgetForDiff),
      sources: [
        { catalogKey: "workorders.open.count", params: {}, sortOrder: 1 },
        { catalogKey: "alarms.active.count", params: {}, sortOrder: 0 },
      ],
    },
  ];
  const reorderedSubmission: WidgetWriteBody = {
    ...(rebound as unknown as Record<string, unknown>),
    sources: [
      { catalogKey: "alarms.active.count", params: {}, sortOrder: 0 },
      { catalogKey: "workorders.open.count", params: {}, sortOrder: 1 },
    ],
  } as unknown as WidgetWriteBody;

  const reorderedDiff = diffWidgets(reorderedStored, [reorderedSubmission]);
  assert(
    reorderedDiff.unchangedIds.length === 1 && reorderedDiff.updates.length === 0,
    "the same catalog bindings in a different array order must be UNCHANGED — " +
      `got updates=${JSON.stringify(reorderedDiff.updates.map((w) => w.id))} unchanged=${JSON.stringify(reorderedDiff.unchangedIds)}`,
  );

  // And `params` participates: same key, different parameters is a real change. Empty today
  // (METRIC_CATALOG_PARAMS_WRITE declares no fields yet), so this guards the comparison rather
  // than a shipping behaviour — and it is what makes Unit 5's first parameter safe to add.
  const paramsChanged = diffWidgets(sourceStored, [
    {
      ...(rebound as unknown as Record<string, unknown>),
      sources: [{ catalogKey: "alarms.active.count", params: { severity: "critical" }, sortOrder: 0 }],
    } as unknown as WidgetWriteBody,
  ]);
  assert(
    paramsChanged.updates.length === 1,
    "a change to a binding's params must be an UPDATE — " +
      `got updates=${JSON.stringify(paramsChanged.updates.map((w) => w.id))}`,
  );

  // -------------------------------------------------------------------------
  // `stableParams`' KEY SORT, which a correctness review mutation-proved was
  // enforced by nothing: removing the `.sort()` left every case above green.
  // It could not have caught it — the three fixtures carry `{}`, `{}` and a
  // ONE-key object, and with fewer than two keys the order is unobservable.
  //
  // The sort exists because `jsonb` normalises key order and a request body
  // does not, so a plain `JSON.stringify` would mark every parameter-carrying
  // widget changed on EVERY save: an endless UPDATE that deletes and reinserts
  // bindings nobody edited, regenerating their row ids each time.
  // -------------------------------------------------------------------------
  const twoKeyStored = sourceStored.map((widget) => ({
    ...widget,
    sources: [
      { catalogKey: "alarms.active.count", params: { alpha: 1, beta: 2 }, sortOrder: 0 },
    ],
  }));
  const keysReordered = diffWidgets(twoKeyStored, [
    {
      ...(rebound as unknown as Record<string, unknown>),
      // The SAME parameters, in the order a request body happens to serialise them — which is
      // not the order Postgres returned them in.
      sources: [
        { catalogKey: "alarms.active.count", params: { beta: 2, alpha: 1 }, sortOrder: 0 },
      ],
    } as unknown as WidgetWriteBody,
  ]);
  assert(
    keysReordered.updates.length === 0 && keysReordered.unchangedIds.length === 1,
    "the same params with their KEYS in a different order must be UNCHANGED — jsonb does not " +
      "preserve key order, so without the sort every save of a parameter-carrying widget is a " +
      `pointless delete-and-reinsert. got updates=${JSON.stringify(keysReordered.updates.map((w) => w.id))}`,
  );

  // The other half: a genuinely different VALUE under the same two keys is still a change, so
  // the sort cannot have been implemented by discarding the values.
  const valueChanged = diffWidgets(twoKeyStored, [
    {
      ...(rebound as unknown as Record<string, unknown>),
      sources: [
        { catalogKey: "alarms.active.count", params: { alpha: 1, beta: 99 }, sortOrder: 0 },
      ],
    } as unknown as WidgetWriteBody,
  ]);
  assert(
    valueChanged.updates.length === 1,
    "a different VALUE under the same keys must still be an UPDATE",
  );
}

// ---------------------------------------------------------------------------
// Unit 8 — a `23505` on `dashboards_organization_slug_key` becomes a 409;
// any other error passes through unchanged. `DashboardsService` is
// constructed with `new` (its own docblock, §4.6: no Nest module, no
// database) with fakes standing in for every collaborator, so `create`'s and
// `update`'s catch clauses are exercised for real rather than the private
// translator being called directly.
// ---------------------------------------------------------------------------

const FAKE_JWT = {} as unknown as JwtPayload;

function fakeAccessControl(): AccessControlService {
  return {
    assertOperationsWriteRole: async () => undefined,
    canManageDashboard: async () => true,
  } as unknown as AccessControlService;
}

function fakeAudit(): MasterDataAuditService {
  // Never reached: the fake `tenantDb.transaction` below rejects before the
  // callback that would call `audit.write` is ever invoked.
  return {} as unknown as MasterDataAuditService;
}

/** `db.transaction(...)` rejects with `err` before its callback ever runs — enough for
 * `withTenant`'s promise to reach the service's `.catch` untouched. */
function rejectingTenantDb(err: unknown): BmsDb {
  return {
    transaction: async () => {
      throw err;
    },
  } as unknown as BmsDb;
}

type SelectChain = {
  from: () => SelectChain;
  where: () => SelectChain;
  limit: () => SelectChain;
  then: (resolve: (rows: unknown[]) => void) => void;
};

/** A thenable answering every Drizzle builder call with itself, resolving to `rows` — the
 * `rules.service.spec.ts:58-67` idiom, reused here for `fetchRowForWrite`'s single read. */
function selectChain(rows: unknown[]): SelectChain {
  const chain: SelectChain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    then: (resolve) => resolve(rows),
  };
  return chain;
}

function fleetDbWithExistingRow(): BmsDb {
  return { select: () => selectChain([dashboardRow]) } as unknown as BmsDb;
}

const DUPLICATE_SLUG_ERROR = { code: "23505", constraint: "dashboards_organization_slug_key" };
/** Non-null, and NOT the dashboards slug key — this is what a `constraint != null` widening
 * would wrongly swallow, and exactly why the fixture must carry a constraint at all rather
 * than an `undefined` one (which `!= null` would also let through, proving nothing). */
const UNRELATED_CONSTRAINT_ERROR = { code: "23505", constraint: "dashboards_pkey" };

export async function runDashboardsServiceConflictTranslationTests(): Promise<void> {
  const createBody: CreateDashboardBody = {
    organizationId: ORG_ID,
    slug: "overview",
    name: "Overview",
  };

  // -- create(): the matching constraint becomes a 409 naming the slug -----
  {
    const service = new DashboardsService(
      rejectingTenantDb(DUPLICATE_SLUG_ERROR),
      fleetDbWithExistingRow(),
      fakeAccessControl(),
      fakeAudit(),
    );
    let caught: unknown;
    try {
      await service.create(FAKE_JWT, createBody);
    } catch (err) {
      caught = err;
    }
    assert(caught instanceof ConflictException, `create() must throw ConflictException on a duplicate slug, got ${String(caught)}`);
    assert(
      (caught as ConflictException).getStatus() === 409,
      "the duplicate-slug translation must be a 409, not any other status",
    );
    assert(
      typeof (caught as ConflictException).message === "string" &&
        (caught as ConflictException).message.includes("overview"),
      `the 409 message must name the slug ("overview"), got: ${(caught as ConflictException).message}`,
    );
  }

  // -- create(): any OTHER error (including a non-null, non-matching constraint) passes
  // through unchanged — the assertion that actually gates: a translator that swallows every
  // error would pass the ConflictException checks above while failing this one.
  {
    const service = new DashboardsService(
      rejectingTenantDb(UNRELATED_CONSTRAINT_ERROR),
      fleetDbWithExistingRow(),
      fakeAccessControl(),
      fakeAudit(),
    );
    let caught: unknown;
    try {
      await service.create(FAKE_JWT, createBody);
    } catch (err) {
      caught = err;
    }
    assert(
      caught === UNRELATED_CONSTRAINT_ERROR,
      `create() must pass through an error whose constraint is not dashboards_organization_slug_key unchanged, got ${JSON.stringify(caught)}`,
    );
  }

  // -- update(): the same pair, through the merge-then-write path ----------
  const updateBody: UpdateDashboardBody = { slug: "renamed" };

  {
    const service = new DashboardsService(
      rejectingTenantDb(DUPLICATE_SLUG_ERROR),
      fleetDbWithExistingRow(),
      fakeAccessControl(),
      fakeAudit(),
    );
    let caught: unknown;
    try {
      await service.update(FAKE_JWT, DASHBOARD_ID, updateBody);
    } catch (err) {
      caught = err;
    }
    assert(caught instanceof ConflictException, `update() must throw ConflictException on a duplicate slug, got ${String(caught)}`);
    assert(
      typeof (caught as ConflictException).message === "string" &&
        (caught as ConflictException).message.includes("renamed"),
      `update()'s 409 message must name the PATCH's own slug ("renamed"), got: ${(caught as ConflictException).message}`,
    );
  }

  {
    const service = new DashboardsService(
      rejectingTenantDb(UNRELATED_CONSTRAINT_ERROR),
      fleetDbWithExistingRow(),
      fakeAccessControl(),
      fakeAudit(),
    );
    let caught: unknown;
    try {
      await service.update(FAKE_JWT, DASHBOARD_ID, updateBody);
    } catch (err) {
      caught = err;
    }
    assert(
      caught === UNRELATED_CONSTRAINT_ERROR,
      `update() must pass through an error whose constraint is not dashboards_organization_slug_key unchanged, got ${JSON.stringify(caught)}`,
    );
  }
}
