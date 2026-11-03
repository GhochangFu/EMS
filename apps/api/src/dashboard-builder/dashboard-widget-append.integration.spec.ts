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
  putDashboardWidgetsBodySchema,
  TAB_KEY_REQUIRED_MESSAGE,
  TAB_KEY_UNKNOWN_MESSAGE,
  widgetCapMessage,
  type AppendChartWidgetBody,
  type IfMatch,
  type JwtPayload,
} from "@bms/shared";

import type { DashboardsService } from "./dashboards.service";
import type { DashboardWidgetAppendService } from "./dashboard-widget-append.service";

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
