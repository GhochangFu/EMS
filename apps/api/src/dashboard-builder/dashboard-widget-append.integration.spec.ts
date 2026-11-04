import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PreconditionFailedException,
} from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import {
  appendChartWidgetResponseSchema,
  appendTrendStripWidgetsBodySchema,
  appendTrendStripWidgetsResponseSchema,
  DASHBOARD_GRID,
  putDashboardWidgetsBodySchema,
  TAB_KEY_REQUIRED_MESSAGE,
  TAB_KEY_UNKNOWN_MESSAGE,
  TREND_STRIP_TAB_UNKNOWN_MESSAGE,
  TREND_STRIP_WIDGET_ROWS,
  widgetCapMessage,
  type AppendChartWidgetBody,
  type AppendTrendStripWidgetsBody,
  type IfMatch,
  type JwtPayload,
} from "@bms/shared";

import type { DashboardsService } from "./dashboards.service";
import { trendStripTabRepeatMessage } from "./dashboard-widget-append-strips";
import type { DashboardWidgetAppendService } from "./dashboard-widget-append.service";
import { trendStripPointOffListMessage } from "./trend-strip-selection.check";

/**
 * `F4.303` U14 / ADR 0108 Amendment 6 item 5 — `POST /dashboards/:id/widgets/append` against a
 * real database: the 404, 403, 400 and 409 in the amendment's order, the placement at the foot of
 * the tab, the untouched neighbours, the `updated_at` stamp that turns a stale builder save into a
 * 412, the row lock that serialises two appends, and the audit row. Vitest entry point: the
 * sibling `.test.ts` (ADR 0014), which owns the pools, the fixtures and the cleanup.
 *
 * **Committed fixtures, not `withRollback`.** The service opens its own tenant transaction and
 * reads the dashboard row and the caller's scope on two other pools, so a case cannot run inside
 * one test-owned transaction; and the concurrency claim needs two transactions that both commit.
 * Each case makes its own dashboard, and the entry point deletes every one it made (the
 * `dashboards.service.precondition.integration.spec.ts` shape). Every count is for **this case's
 * dashboard id** — never a lifetime counter.
 */
export type AppendCtx = {
  append: DashboardWidgetAppendService;
  dashboards: DashboardsService;
  admin: JwtPayload;
  /** `wc-admin@bms.local` — ESKOM's `location_admin`. */
  locationAdmin: JwtPayload;
  /** Superuser pool: reads the rows behind the service and holds the competing lock. */
  superuserPool: pg.Pool;
  /** An ESKOM asset the location admin can read, with two active registrations. */
  readable: { assetId: string; pointKeys: readonly [string, string]; pointId: string };
  /** An ESKOM asset outside the location admin's scope, with an active registration. */
  unreadable: { assetId: string; pointKey: string };
  /** The readable asset's location — a dashboard there is one the location admin manages. */
  scopedLocationId: string;
  /** A fresh dashboard for one case: organization-wide unless `locationId` is given. */
  newDashboard: (options?: { locationId?: string }) => Promise<string>;
  /** `F4.306` U7 — a segment whose effective trend-point list has a point, and that point's code. */
  segment: string;
  pointCode: string;
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type FillerWidget = { tabKey?: string; gridY: number; gridH: number };

/** Writes `tabs` and `widgets` through the real `PUT :id/widgets`, so the fixture is a state the API can reach. */
async function seedWidgets(ctx: AppendCtx, id: string, tabs: readonly string[], widgets: readonly FillerWidget[]): Promise<void> {
  await ctx.dashboards.putWidgets(
    ctx.admin,
    id,
    putDashboardWidgetsBodySchema.parse({
      tabs: tabs.map((key, sortOrder) => ({ key, label: key, sortOrder })),
      widgets: widgets.map((widget) => ({
        widgetType: "active_alarms_rail",
        title: "F4.303 filler",
        gridX: 0,
        gridY: widget.gridY,
        gridW: 3,
        gridH: widget.gridH,
        config: {},
        points: [],
        ...(widget.tabKey === undefined ? {} : { tabKey: widget.tabKey }),
      })),
    }),
  );
}

function fillers(tabKey: string, count: number): FillerWidget[] {
  return Array.from({ length: count }, (_, index) => ({ tabKey, gridY: index, gridH: 1 }));
}

function body(ctx: AppendCtx, overrides: Partial<AppendChartWidgetBody> = {}): AppendChartWidgetBody {
  return {
    config: { windowMinutes: 1440, aggregate: "avg" },
    points: [{ assetId: ctx.readable.assetId, pointKey: ctx.readable.pointKeys[0] }],
    ...overrides,
  };
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return null;
}

async function storedStamp(ctx: AppendCtx, id: string): Promise<string> {
  const { rows } = await ctx.superuserPool.query<{ at: Date }>("SELECT updated_at AS at FROM bms.dashboards WHERE id = $1", [id]);
  return rows[0]?.at.toISOString() ?? "";
}

async function widgetsOnTab(ctx: AppendCtx, id: string, tabKey: string | null): Promise<number> {
  const { rows } = await ctx.superuserPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bms.dashboard_widgets w
       LEFT JOIN bms.dashboard_tabs t ON t.id = w.tab_id
      WHERE w.dashboard_id = $1 AND t.tab_key IS NOT DISTINCT FROM $2`,
    [id, tabKey],
  );
  return rows[0]?.n ?? -1;
}

/** W1 — a dashboard the caller cannot manage is a 404, and its `updated_at` does not move. */
export async function aDashboardTheCallerCannotManageIs404(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  const before = await storedStamp(ctx, id);
  const err = await caught(() => ctx.append.append(ctx.locationAdmin, id, body(ctx)));
  expect(err).toBeInstanceOf(NotFoundException);
  expect(await storedStamp(ctx, id)).toBe(before);
}

/** W2 — an unreadable asset is a 403 that echoes no id. Mutation: name the asset id in the message. */
export async function anUnreadableAssetIs403WithoutAnId(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard({ locationId: ctx.scopedLocationId });
  const err = await caught(() =>
    ctx.append.append(
      ctx.locationAdmin,
      id,
      body(ctx, {
        points: [
          { assetId: ctx.readable.assetId, pointKey: ctx.readable.pointKeys[0] },
          { assetId: ctx.unreadable.assetId, pointKey: ctx.unreadable.pointKey },
        ],
      }),
    ),
  );
  expect(err).toBeInstanceOf(ForbiddenException);
  expect((err as Error).message).not.toMatch(UUID);
  expect(await widgetsOnTab(ctx, id, null)).toBe(0);
}

/** W2's positive control — the same caller on the same dashboard appends a point it can read. */
export async function theLocationAdminAppendsAReadablePoint(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard({ locationId: ctx.scopedLocationId });
  await ctx.append.append(ctx.locationAdmin, id, body(ctx));
  expect(await widgetsOnTab(ctx, id, null)).toBe(1);
}

/** W3 — a pair with no active registration is a 400 that names its index only. */
export async function anUnregisteredPairIs400NamingItsIndexOnly(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  const err = await caught(() =>
    ctx.append.append(
      ctx.admin,
      id,
      body(ctx, {
        points: [
          { assetId: ctx.readable.assetId, pointKey: ctx.readable.pointKeys[0] },
          { assetId: ctx.readable.assetId, pointKey: "f4303_not_registered" },
        ],
      }),
    ),
  );
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("point 1 has no active registration in this dashboard's organization");
  expect(await widgetsOnTab(ctx, id, null)).toBe(0);
}

/**
 * A repeated pair is a 400 naming its index — `dashboard_widget_points_widget_point_role_key`
 * would otherwise answer the second binding of one point with a 500.
 */
export async function aRepeatedPairIs400NamingItsIndex(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  const pair = { assetId: ctx.readable.assetId, pointKey: ctx.readable.pointKeys[0] };
  const err = await caught(() => ctx.append.append(ctx.admin, id, body(ctx, { points: [pair, pair] })));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("point 1 repeats an earlier point");
  expect(await widgetsOnTab(ctx, id, null)).toBe(0);
}

/** W4 — a tabbed dashboard without `tabKey` is a 400 with the tab-key sentence. */
export async function aTabbedDashboardWithoutTabKeyIs400(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedWidgets(ctx, id, ["ops"], []);
  const err = await caught(() => ctx.append.append(ctx.admin, id, body(ctx)));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(TAB_KEY_REQUIRED_MESSAGE);
}

/** W5 — an unknown `tabKey` is a 400 with the unknown-key sentence. */
export async function anUnknownTabKeyIs400(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedWidgets(ctx, id, ["ops"], []);
  const err = await caught(() => ctx.append.append(ctx.admin, id, body(ctx, { tabKey: "nope" })));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(TAB_KEY_UNKNOWN_MESSAGE);
}

/** W6 — a `tabKey` on a dashboard without tabs is a 400. */
export async function aTabKeyOnAnUntabbedDashboardIs400(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  const err = await caught(() => ctx.append.append(ctx.admin, id, body(ctx, { tabKey: "ops" })));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("This dashboard has no tabs");
}

/** W7 — 40 widgets on the tab is a 409 with the cap sentence, and nothing is written. */
export async function aFullTabIs409(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedWidgets(ctx, id, ["ops"], fillers("ops", 40));
  const err = await caught(() => ctx.append.append(ctx.admin, id, body(ctx, { tabKey: "ops" })));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(widgetCapMessage("ops"));
  expect(await widgetsOnTab(ctx, id, "ops")).toBe(40);
}

/** W8 — 39 on the tab and 40 on another tab succeeds. Mutation: count the whole dashboard. */
export async function theCapCountsOnlyTheChosenTab(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedWidgets(ctx, id, ["ops", "other"], [...fillers("ops", 39), ...fillers("other", 40)]);
  await ctx.append.append(ctx.admin, id, body(ctx, { tabKey: "ops" }));
  expect(await widgetsOnTab(ctx, id, "ops")).toBe(40);
}

/** W9 — the widget lands at `gridX 0` under the lowest widget of its own tab, with the body's window and function. */
export async function theWidgetLandsAtTheFootOfItsTab(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedWidgets(ctx, id, ["ops", "other"], [
    { tabKey: "ops", gridY: 0, gridH: 3 },
    { tabKey: "ops", gridY: 2, gridH: 4 },
    { tabKey: "other", gridY: 10, gridH: 5 },
  ]);
  const answer = await ctx.append.append(
    ctx.admin,
    id,
    body(ctx, { tabKey: "ops", gridW: 4, gridH: 3, config: { windowMinutes: 10_080, aggregate: "max" } }),
  );
  const { rows } = await ctx.superuserPool.query<{
    widget_type: string;
    grid_x: number;
    grid_y: number;
    grid_w: number;
    grid_h: number;
    config: Record<string, unknown>;
  }>("SELECT widget_type, grid_x, grid_y, grid_w, grid_h, config FROM bms.dashboard_widgets WHERE id = $1", [
    answer.widget.id,
  ]);
  expect(rows[0]).toEqual({
    widget_type: "chart",
    grid_x: 0,
    grid_y: 6,
    grid_w: 4,
    grid_h: 3,
    config: { series: "line", windowMinutes: 10_080, aggregate: "max" },
  });
}

/** An empty dashboard without tabs takes the widget at `gridY 0` with the chart's default size, 6 by 4. */
export async function anEmptyCanvasTakesTheWidgetAtTheTopWithTheDefaultSize(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  const answer = await ctx.append.append(ctx.admin, id, body(ctx));
  expect([answer.widget.gridX, answer.widget.gridY, answer.widget.gridW, answer.widget.gridH]).toEqual([0, 0, 6, 4]);
  expect(answer.widget.tabId).toBeNull();
}

type Snapshot = { widgets: unknown[]; points: unknown[]; sources: unknown[] };

async function snapshotExcept(ctx: AppendCtx, id: string, exceptWidgetId: string | null): Promise<Snapshot> {
  const q = async (sql: string): Promise<unknown[]> =>
    (await ctx.superuserPool.query(sql, [id, exceptWidgetId])).rows;
  return {
    widgets: await q(
      `SELECT * FROM bms.dashboard_widgets WHERE dashboard_id = $1 AND id IS DISTINCT FROM $2 ORDER BY id`,
    ),
    points: await q(
      `SELECT p.* FROM bms.dashboard_widget_points p JOIN bms.dashboard_widgets w ON w.id = p.widget_id
        WHERE w.dashboard_id = $1 AND w.id IS DISTINCT FROM $2 ORDER BY p.id`,
    ),
    sources: await q(
      `SELECT s.* FROM bms.dashboard_widget_sources s JOIN bms.dashboard_widgets w ON w.id = s.widget_id
        WHERE w.dashboard_id = $1 AND w.id IS DISTINCT FROM $2 ORDER BY s.id`,
    ),
  };
}

/** W10 — every other widget, its points and its sources are byte-identical after the append. */
export async function theOtherWidgetsAreUntouched(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await ctx.dashboards.putWidgets(
    ctx.admin,
    id,
    putDashboardWidgetsBodySchema.parse({
      tabs: [{ key: "ops", label: "ops", sortOrder: 0 }],
      widgets: [
        {
          widgetType: "chart",
          title: "F4.303 neighbour",
          tabKey: "ops",
          gridX: 0,
          gridY: 0,
          gridW: 6,
          gridH: 4,
          config: { series: "area" },
          points: [{ pointId: ctx.readable.pointId, role: "series", sortOrder: 0 }],
        },
        { widgetType: "active_alarms_rail", title: "F4.303 rail", tabKey: "ops", gridX: 6, gridY: 0, gridW: 3, gridH: 2, config: {}, points: [] },
      ],
    }),
  );
  const before = await snapshotExcept(ctx, id, null);
  expect(before.widgets).toHaveLength(2);
  expect(before.points).toHaveLength(1);
  const answer = await ctx.append.append(ctx.admin, id, body(ctx, { tabKey: "ops" }));
  expect(await snapshotExcept(ctx, id, answer.widget.id)).toEqual(before);
}

/** W11a — the append moves `updated_at`, and answers the stored value. Mutation: drop the stamp. */
export async function theAppendMovesUpdatedAt(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await ctx.superuserPool.query("UPDATE bms.dashboards SET updated_at = '2026-10-20 10:00:00.123+00' WHERE id = $1", [id]);
  const answer = await ctx.append.append(ctx.admin, id, body(ctx));
  const stored = await storedStamp(ctx, id);
  expect(Date.parse(stored)).toBeGreaterThan(Date.parse("2026-10-20T10:00:00.123Z"));
  expect(answer.updatedAt).toBe(stored);
}

/** W11b — a builder save with the pre-append `If-Match` is the F4.247 412. Mutation: drop the stamp. */
export async function aSaveWithThePreAppendIfMatchIs412(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await ctx.superuserPool.query("UPDATE bms.dashboards SET updated_at = '2026-10-20 10:00:00.123+00' WHERE id = $1", [id]);
  await ctx.append.append(ctx.admin, id, body(ctx));
  const err = await caught(() =>
    ctx.dashboards.putWidgets(ctx.admin, id, putDashboardWidgetsBodySchema.parse({ widgets: [] }), "2026-10-20T10:00:00.123Z" as IfMatch),
  );
  expect(err).toBeInstanceOf(PreconditionFailedException);
  expect(await widgetsOnTab(ctx, id, null)).toBe(1);
}

/**
 * W12 — two appends at 39 give one success and one 409. A superuser transaction holds the
 * dashboard's row lock; both appends are released only once each is blocked behind it (polled
 * through `pg_blocking_pids`, never a sleep), so they race for the 40th slot. The stamp's row lock
 * serialises them: the second counts after the first commits. Mutation: drop the stamp — neither
 * blocks, and the poll times out.
 */
export async function twoConcurrentAppendsAt39GiveOneSuccessAndOne409(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedWidgets(ctx, id, ["ops"], fillers("ops", 39));
  const holder = await ctx.superuserPool.connect();
  let results: PromiseSettledResult<unknown>[] = [];
  try {
    await holder.query("BEGIN");
    const { rows } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const holderPid = rows[0]?.pid ?? -1;
    await holder.query("UPDATE bms.dashboards SET updated_at = now() WHERE id = $1", [id]);
    const racing = Promise.allSettled([
      ctx.append.append(ctx.admin, id, body(ctx, { tabKey: "ops" })),
      ctx.append.append(ctx.admin, id, body(ctx, { tabKey: "ops" })),
    ]);
    const deadline = Date.now() + 20_000;
    let blocked = 0;
    while (blocked < 2) {
      if (Date.now() > deadline) {
        throw new Error(`W12: only ${blocked} of the two appends blocked behind the held dashboard row`);
      }
      const probe = await ctx.superuserPool.query<{ n: number }>(
        `WITH direct AS (SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)))
         SELECT ((SELECT count(*) FROM direct)
               + (SELECT count(*) FROM pg_stat_activity a
                   WHERE a.pid NOT IN (SELECT pid FROM direct)
                     AND pg_blocking_pids(a.pid) && ARRAY(SELECT pid FROM direct)))::int AS n`,
        [holderPid],
      );
      blocked = probe.rows[0]?.n ?? 0;
      if (blocked < 2) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await holder.query("COMMIT");
    results = await racing;
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
  }
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]?.reason).toBeInstanceOf(ConflictException);
  expect(await widgetsOnTab(ctx, id, "ops")).toBe(40);
}

/** W13 — the audit row carries ids and counts only: exactly four payload keys. */
export async function theAuditRowCarriesIdsAndCountsOnly(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedWidgets(ctx, id, ["ops"], []);
  const answer = await ctx.append.append(
    ctx.admin,
    id,
    body(ctx, {
      tabKey: "ops",
      points: [
        { assetId: ctx.readable.assetId, pointKey: ctx.readable.pointKeys[0] },
        { assetId: ctx.readable.assetId, pointKey: ctx.readable.pointKeys[1] },
      ],
    }),
  );
  const { rows } = await ctx.superuserPool.query<{ payload: Record<string, unknown> }>(
    "SELECT payload FROM bms.audit_log WHERE entity_id = $1 AND action = 'master.dashboard.widgets.append' ORDER BY created_at",
    [id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.payload).toEqual({ dashboardId: id, widgetId: answer.widget.id, tabKey: "ops", pointCount: 2 });
}

/** W14 — the answer parses with its contract and carries the bound pairs, in order. */
export async function theAnswerParsesAndCarriesThePairs(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  const answer = await ctx.append.append(
    ctx.admin,
    id,
    body(ctx, {
      points: [
        { assetId: ctx.readable.assetId, pointKey: ctx.readable.pointKeys[1] },
        { assetId: ctx.readable.assetId, pointKey: ctx.readable.pointKeys[0] },
      ],
    }),
  );
  const parsed = appendChartWidgetResponseSchema.parse(answer);
  expect(parsed.widget.points.map((point) => [point.assetId, point.pointKey, point.role, point.sortOrder])).toEqual([
    [ctx.readable.assetId, ctx.readable.pointKeys[1], "series", 0],
    [ctx.readable.assetId, ctx.readable.pointKeys[0], "series", 1],
  ]);
}

// ---------------------------------------------------------------------------
// `F4.306` U7 (ADR 0108 Amendment 7) — the trend arm, `appendStrips`: the row and
// `canManageDashboard` (404) → `assertTrendStripSelections` (400) → one tenant transaction (the
// stamp, the tab rules per strip, `placeTrendStrip`, replace or insert, the 409 that rolls back
// every strip, one audit row). The chart cases above run unchanged beside these.
// ---------------------------------------------------------------------------

/** A catalog-pattern code no seeded `point_keys` row carries. */
const OFF_LIST = "f4306zzoff";

const stripBody = (strips: { tabKey?: string; config?: Record<string, unknown> }[]): AppendTrendStripWidgetsBody =>
  appendTrendStripWidgetsBodySchema.parse({
    widgetType: "trend_strip",
    strips: strips.map((strip) => ({ ...strip, config: { defaultRange: "24h", ...strip.config } })),
  });

/** Writes `tabs` and full write widgets through the real `PUT :id/widgets`. */
async function seedRaw(ctx: AppendCtx, id: string, tabs: readonly string[], widgets: readonly unknown[]): Promise<void> {
  await ctx.dashboards.putWidgets(
    ctx.admin,
    id,
    putDashboardWidgetsBodySchema.parse({ tabs: tabs.map((key, sortOrder) => ({ key, label: key, sortOrder })), widgets }),
  );
}

const storedStrip = (tabKey: string, gridY: number) => ({
  widgetType: "trend_strip",
  title: "F4.306 stored strip",
  tabKey,
  gridX: 0,
  gridY,
  gridW: 12,
  gridH: 4,
  config: { defaultRange: "7d" },
  points: [],
});

const rail = (tabKey: string, gridY: number, gridH = 2) => ({
  widgetType: "active_alarms_rail",
  title: "F4.306 rail",
  tabKey,
  gridX: 0,
  gridY,
  gridW: 3,
  gridH,
  config: {},
  points: [],
});

async function widgetRow(ctx: AppendCtx, widgetId: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await ctx.superuserPool.query("SELECT * FROM bms.dashboard_widgets WHERE id = $1", [widgetId]);
  return rows[0] as Record<string, unknown> | undefined;
}

/** T1 — a caller who cannot manage the dashboard is a 404 before the selection's 400, and `updated_at` does not move. */
export async function theTrendArm404PrecedesTheSelection400(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  const before = await storedStamp(ctx, id);
  const offList = stripBody([{ config: { segments: [ctx.segment], points: [`${ctx.segment}:${OFF_LIST}`] } }]);
  const err = await caught(() => ctx.append.appendStrips(ctx.locationAdmin, id, offList));
  expect(err).toBeInstanceOf(NotFoundException);
  expect(await storedStamp(ctx, id)).toBe(before);
}

/** T1 — on a site dashboard, a point off its list is a 400 naming indexes only, with `updated_at` unchanged. */
export async function anOffListSelectionIs400WithTheStampUnchanged(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard({ locationId: ctx.scopedLocationId });
  const before = await storedStamp(ctx, id);
  const err = await caught(() =>
    ctx.append.appendStrips(
      ctx.admin,
      id,
      stripBody([{ config: { segments: [ctx.segment], points: [`${ctx.segment}:${OFF_LIST}`] } }]),
    ),
  );
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(trendStripPointOffListMessage(0, 0));
  expect((err as Error).message).not.toMatch(OFF_LIST);
  expect(await storedStamp(ctx, id)).toBe(before);
  expect(await widgetsOnTab(ctx, id, null)).toBe(0);
}

/** T1's positive neighbour — the same kind of dashboard takes a selection on its list, stored as sent. */
export async function aSelectionOnTheListIsAppended(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard({ locationId: ctx.scopedLocationId });
  const entry = `${ctx.segment}:${ctx.pointCode}`;
  const config = { defaultRange: "24h", segments: [ctx.segment], points: [entry], colors: { [entry]: "series-3" } };
  const answer = await ctx.append.appendStrips(ctx.admin, id, stripBody([{ config }]));
  expect(answer.widgets).toHaveLength(1);
  expect((await widgetRow(ctx, answer.widgets[0]?.id ?? ""))?.config).toStrictEqual(config);
}

/** T2 — two strips for one tab is a 400 naming the later strip's index, and the stamp does not move. */
export async function aRepeatedTabKeyIs400(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedWidgets(ctx, id, ["ops", "other"], []);
  const before = await storedStamp(ctx, id);
  const err = await caught(() =>
    ctx.append.appendStrips(ctx.admin, id, stripBody([{ tabKey: "other" }, { tabKey: "ops" }, { tabKey: "other" }])),
  );
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(trendStripTabRepeatMessage(2));
  expect(await storedStamp(ctx, id)).toBe(before);
  expect(await widgetsOnTab(ctx, id, "ops")).toBe(0);
}

/** T3 — the trend arm keeps the chart arm's tab rules: a missing `tabKey`, an unknown one, one on no tabs. */
export async function theStripArmKeepsTheTabRules(ctx: AppendCtx): Promise<void> {
  const tabbed = await ctx.newDashboard();
  await seedWidgets(ctx, tabbed, ["ops"], []);
  const missing = await caught(() => ctx.append.appendStrips(ctx.admin, tabbed, stripBody([{}])));
  expect((missing as Error).message).toBe(TAB_KEY_REQUIRED_MESSAGE);
  const unknown = await caught(() => ctx.append.appendStrips(ctx.admin, tabbed, stripBody([{ tabKey: "nope" }])));
  expect((unknown as Error).message).toBe(TAB_KEY_UNKNOWN_MESSAGE);
  const untabbed = await ctx.newDashboard();
  const onNone = await caught(() => ctx.append.appendStrips(ctx.admin, untabbed, stripBody([{ tabKey: "ops" }])));
  expect((onNone as Error).message).toBe("This dashboard has no tabs");
}

/** T3 — a strip's `config.tabKey` must name a tab of the dashboard; one that does is appended. */
export async function aConfigTabKeyNamingNoTabIs400(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedWidgets(ctx, id, ["ops"], []);
  const err = await caught(() =>
    ctx.append.appendStrips(ctx.admin, id, stripBody([{ tabKey: "ops", config: { tabKey: "elsewhere" } }])),
  );
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(TREND_STRIP_TAB_UNKNOWN_MESSAGE);
  const ok = await ctx.append.appendStrips(ctx.admin, id, stripBody([{ tabKey: "ops", config: { tabKey: "ops" } }]));
  expect(ok.widgets).toHaveLength(1);
}

/**
 * T4 — a tab's strip is replaced: the row keeps its id, title and geometry, only `config` moves,
 * and every other row of the dashboard is byte-identical.
 */
export async function aTabsStripIsReplacedInPlace(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedRaw(ctx, id, ["ops", "other"], [rail("ops", 0), storedStrip("ops", 2), storedStrip("other", 0)]);
  const { rows } = await ctx.superuserPool.query<{ id: string }>(
    `SELECT w.id FROM bms.dashboard_widgets w JOIN bms.dashboard_tabs t ON t.id = w.tab_id
      WHERE w.dashboard_id = $1 AND t.tab_key = 'ops' AND w.widget_type = 'trend_strip'`,
    [id],
  );
  const stripId = rows[0]?.id ?? "";
  const rowBefore = await widgetRow(ctx, stripId);
  const othersBefore = await snapshotExcept(ctx, id, stripId);
  const answer = await ctx.append.appendStrips(
    ctx.admin,
    id,
    stripBody([{ tabKey: "ops", config: { defaultRange: "30d" } }]),
  );
  expect(answer.widgets.map((widget) => widget.id)).toEqual([stripId]);
  expect(await widgetRow(ctx, stripId)).toEqual({ ...rowBefore, config: { defaultRange: "30d" } });
  expect(await snapshotExcept(ctx, id, stripId)).toEqual(othersBefore);
  expect(await widgetsOnTab(ctx, id, "ops")).toBe(2);
}

/** T5 — a tab without a strip takes one at `gridX 0`, its foot, the grid's full width and the strip's rows. */
export async function aStripIsInsertedAtTheFootOfItsTab(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedRaw(ctx, id, ["ops", "other"], [rail("ops", 0, 3), rail("ops", 1, 5), rail("other", 10, 5)]);
  const answer = await ctx.append.appendStrips(ctx.admin, id, stripBody([{ tabKey: "ops" }]));
  const row = await widgetRow(ctx, answer.widgets[0]?.id ?? "");
  expect([row?.widget_type, row?.grid_x, row?.grid_y, row?.grid_w, row?.grid_h, row?.config]).toEqual([
    "trend_strip",
    0,
    6,
    DASHBOARD_GRID.columns,
    TREND_STRIP_WIDGET_ROWS,
    { defaultRange: "24h" },
  ]);
}

/**
 * T6 — 40 widgets on tab `b` and a valid strip for tab `a` first: the 409 names `b` and rolls back
 * every strip, so tab `a` and the stamp are unchanged.
 */
export async function aFullTabRollsBackEveryStrip(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedWidgets(ctx, id, ["a", "b"], [{ tabKey: "a", gridY: 0, gridH: 2 }, ...fillers("b", 40)]);
  const before = await storedStamp(ctx, id);
  const rowsBefore = await snapshotExcept(ctx, id, null);
  const err = await caught(() =>
    ctx.append.appendStrips(ctx.admin, id, stripBody([{ tabKey: "a" }, { tabKey: "b" }])),
  );
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(widgetCapMessage("b"));
  expect(await widgetsOnTab(ctx, id, "a")).toBe(1);
  expect(await snapshotExcept(ctx, id, null)).toEqual(rowsBefore);
  expect(await storedStamp(ctx, id)).toBe(before);
}

/** T6's positive neighbour — a full tab whose strip is replaced is not a 409: a replace adds no widget. */
export async function aFullTabStillReplacesItsStrip(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedRaw(ctx, id, ["b"], [storedStrip("b", 0), ...Array.from({ length: 39 }, (_, n) => rail("b", 4 + n, 1))]);
  const answer = await ctx.append.appendStrips(ctx.admin, id, stripBody([{ tabKey: "b" }]));
  expect(answer.widgets).toHaveLength(1);
  expect(await widgetsOnTab(ctx, id, "b")).toBe(40);
}

/** T7 — the arm moves `updated_at`, answers the stored value, and a save with the old `If-Match` is the 412. */
export async function theStripArmMovesUpdatedAtAndAStaleSaveIs412(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await ctx.superuserPool.query("UPDATE bms.dashboards SET updated_at = '2026-10-20 10:00:00.123+00' WHERE id = $1", [id]);
  const answer = await ctx.append.appendStrips(ctx.admin, id, stripBody([{}]));
  const stored = await storedStamp(ctx, id);
  expect(Date.parse(stored)).toBeGreaterThan(Date.parse("2026-10-20T10:00:00.123Z"));
  expect(answer.updatedAt).toBe(stored);
  const err = await caught(() =>
    ctx.dashboards.putWidgets(
      ctx.admin,
      id,
      putDashboardWidgetsBodySchema.parse({ widgets: [] }),
      "2026-10-20T10:00:00.123Z" as IfMatch,
    ),
  );
  expect(err).toBeInstanceOf(PreconditionFailedException);
}

/** T8 — one audit row, ids and counts only: no segment or point code of the selection. */
export async function theStripAuditRowCarriesIdsAndCountsOnly(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard({ locationId: ctx.scopedLocationId });
  await seedRaw(ctx, id, ["ops", "other"], [storedStrip("other", 0)]);
  const entry = `${ctx.segment}:${ctx.pointCode}`;
  await ctx.append.appendStrips(
    ctx.admin,
    id,
    stripBody([{ tabKey: "ops", config: { segments: [ctx.segment], points: [entry] } }, { tabKey: "other" }]),
  );
  const { rows } = await ctx.superuserPool.query<{ payload: Record<string, unknown> }>(
    "SELECT payload FROM bms.audit_log WHERE entity_id = $1 AND action = 'master.dashboard.widgets.append' ORDER BY created_at",
    [id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.payload).toEqual({ dashboardId: id, tabKeys: ["ops", "other"], inserted: 1, updated: 1 });
  expect(JSON.stringify(rows[0]?.payload)).not.toMatch(ctx.pointCode);
}

/** T9 — the answer parses with its contract and lists one widget per strip, in body order. */
export async function theStripAnswerParsesInBodyOrder(ctx: AppendCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await seedWidgets(ctx, id, ["a", "b"], []);
  const answer = await ctx.append.appendStrips(ctx.admin, id, stripBody([{ tabKey: "b" }, { tabKey: "a" }]));
  const parsed = appendTrendStripWidgetsResponseSchema.parse(answer);
  const { rows } = await ctx.superuserPool.query<{ id: string; tab_key: string }>(
    "SELECT id, tab_key FROM bms.dashboard_tabs WHERE dashboard_id = $1",
    [id],
  );
  const tabIdOf = (key: string) => rows.find((row) => row.tab_key === key)?.id;
  expect(parsed.widgets.map((widget) => widget.tabId)).toEqual([tabIdOf("b"), tabIdOf("a")]);
  expect(parsed.widgets.map((widget) => widget.widgetType)).toEqual(["trend_strip", "trend_strip"]);
}
