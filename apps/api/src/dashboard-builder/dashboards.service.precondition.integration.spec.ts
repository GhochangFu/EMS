import { PreconditionFailedException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { type IfMatch, type JwtPayload, PRECONDITION_STALE_MESSAGE, putDashboardWidgetsBodySchema } from "@bms/shared";

import type { DashboardsService } from "./dashboards.service";

/**
 * `F4.247` / ADR 0099 Amendment 5 C3 — `PUT /dashboards/:id/widgets` with `If-Match`, against a
 * real database: the conditional stamp applies on the live value, refuses a stale one with 412
 * writing nothing (no widget row, no audit row, `updated_at` unmoved), matches a microsecond
 * stamp by its milliseconds, never answers 500 for a schema-valid value Postgres cannot cast, and
 * applies with no header. Its own file: the rls spec is at 981 of the 1000 lines. Vitest entry
 * point: the sibling `.test.ts` (ADR 0014), which owns the pools, the fixtures and the cleanup.
 *
 * Every count is for **this case's dashboard id**, before and after — never a lifetime counter.
 */
export type PreconditionCtx = {
  service: DashboardsService;
  actor: JwtPayload;
  /** Superuser pool: stamps `updated_at` and reads the rows behind the service. */
  superuserPool: pg.Pool;
  /** A fresh, empty dashboard for one case. */
  newDashboard: () => Promise<string>;
};

/** The stamp every case starts from — milliseconds only, so only claim 3 depends on the truncation. */
const STAMP = { stored: "2026-10-20 10:00:00.123+00", iso: "2026-10-20T10:00:00.123Z" as IfMatch };

const body = () =>
  putDashboardWidgetsBodySchema.parse({
    widgets: [{ widgetType: "active_alarms_rail", title: "F4.247", gridX: 0, gridY: 0, gridW: 3, gridH: 2, config: {}, points: [] }],
  });

async function stampTo(ctx: PreconditionCtx, id: string, stored: string): Promise<void> {
  await ctx.superuserPool.query("UPDATE bms.dashboards SET updated_at = $2 WHERE id = $1", [id, stored]);
}

async function widgetCount(ctx: PreconditionCtx, id: string): Promise<number> {
  const { rows } = await ctx.superuserPool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.dashboard_widgets WHERE dashboard_id = $1",
    [id],
  );
  return rows[0]?.n ?? -1;
}

async function replaceAudits(ctx: PreconditionCtx, id: string): Promise<number> {
  const { rows } = await ctx.superuserPool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.audit_log WHERE entity_id = $1 AND action = 'master.dashboard.widgets.replace'",
    [id],
  );
  return rows[0]?.n ?? -1;
}

async function storedStamp(ctx: PreconditionCtx, id: string): Promise<string> {
  const { rows } = await ctx.superuserPool.query<{ at: Date }>("SELECT updated_at AS at FROM bms.dashboards WHERE id = $1", [id]);
  return rows[0]?.at.toISOString() ?? "";
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return null;
}

/** Claim 1 — the live value applies and moves `updated_at`. Mutation: a predicate that is always false. */
export async function theLiveIfMatchApplies(ctx: PreconditionCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await stampTo(ctx, id, STAMP.stored);
  const dto = await ctx.service.putWidgets(ctx.actor, id, body(), STAMP.iso);
  expect(Date.parse(dto.updatedAt)).toBeGreaterThan(Date.parse(STAMP.iso));
  expect(await widgetCount(ctx, id)).toBe(1);
}

/** Claim 2 — a stale value is a 412 that writes nothing. Mutation: make the stamp unconditional. */
export async function aStaleIfMatchIs412AndWritesNothing(ctx: PreconditionCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await stampTo(ctx, id, STAMP.stored);
  const [widgetsBefore, auditsBefore] = [await widgetCount(ctx, id), await replaceAudits(ctx, id)];
  const err = await caught(() => ctx.service.putWidgets(ctx.actor, id, body(), "2026-10-20T09:00:00.000Z" as IfMatch));
  expect(err).toBeInstanceOf(PreconditionFailedException);
  expect((err as Error).message).toBe(PRECONDITION_STALE_MESSAGE);
  expect(await widgetCount(ctx, id)).toBe(widgetsBefore);
  expect(await replaceAudits(ctx, id)).toBe(auditsBefore);
  expect(await storedStamp(ctx, id)).toBe(STAMP.iso);
}

/**
 * Claim 3 — a microsecond stamp matches the millisecond `updatedAt` it was served as.
 * Mutation: compare `updated_at = ${ifMatch}::timestamptz` — only this case (and claim 5) reddens.
 */
export async function aMicrosecondStampMatchesItsMilliseconds(ctx: PreconditionCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await stampTo(ctx, id, "2026-10-20 10:00:00.123456+00");
  await ctx.service.putWidgets(ctx.actor, id, body(), STAMP.iso);
  expect(await widgetCount(ctx, id)).toBe(1);
}

/** Claim 4 — no header, no compare: a save after a foreign stamp applies. Mutation: treat undefined as stale. */
export async function noIfMatchAppliesWithoutACompare(ctx: PreconditionCtx): Promise<void> {
  const id = await ctx.newDashboard();
  await stampTo(ctx, id, STAMP.stored);
  await ctx.service.putWidgets(ctx.actor, id, body());
  expect(await widgetCount(ctx, id)).toBe(1);
}

/** Claim 5 (critique C1) — the year 0000 passes the schema; Postgres cannot cast it. A 412, never a 500. */
export async function anUncastableIfMatchIs412NotA500(ctx: PreconditionCtx): Promise<void> {
  const id = await ctx.newDashboard();
  const err = await caught(() => ctx.service.putWidgets(ctx.actor, id, body(), "0000-01-01T00:00:00.000Z" as IfMatch));
  expect(err).toBeInstanceOf(PreconditionFailedException);
}
