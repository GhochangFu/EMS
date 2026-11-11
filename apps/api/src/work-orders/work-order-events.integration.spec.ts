import { sql } from "drizzle-orm";
import { expect } from "vitest";
import type pg from "pg";

import { workOrderEvents } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { workOrderDetailSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { copilotContext } from "../copilot/copilot-request-context";
import { withTenant } from "../database/tenant-context";
import type { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.1` (ADR 0122 decisions 7 and 8; plan T2.2 and T2.3) — the timeline writer and the
 * detail read, against real `bms_tenant` and `bms_fleet` roles. Assertions live here;
 * `work-order-events.integration.test.ts` owns the database lifecycle (ADR 0014).
 */
type Actor = Pick<JwtPayload, "sub" | "email">;

export type WorkOrderEventsFixtures = {
  svc: WorkOrdersService;
  /** The same service with an audit writer that throws, for the atomicity proof. */
  svcWithFailingAudit: WorkOrdersService;
  tenantDb: BmsDb;
  tenantPool: pg.Pool;
  fleetPool: pg.Pool;
  /** An `organization_admin` of the organization, and that user's row. */
  actor: Actor;
  actorUserId: string;
  actorDisplayName: string;
  /** The global `admin`, whose `bms.users` row a tenant reader cannot see. */
  globalAdmin: Actor;
  globalAdminDisplayName: string;
  organizationId: string;
  foreignOrgId: string;
  assetId: string;
  /** A second asset of the same organization, for the scope check. */
  otherAssetId: string;
  alarmId: string;
  /** A user this run created, so it can be renamed without touching a seeded account. */
  fixtureUser: Actor;
  fixtureUserId: string;
  fixtureUserDisplayName: string;
};

type EventRow = {
  id: string;
  event_type: string;
  actor_id: string | null;
  actor_name: string | null;
  from_status: string | null;
  to_status: string | null;
  detail: Record<string, unknown>;
};

const TITLE = "E3.1 events fixture";

async function eventsOf(pool: pg.Pool, workOrderId: string): Promise<EventRow[]> {
  const { rows } = await pool.query<EventRow>(
    `SELECT id, event_type, actor_id, actor_name, from_status, to_status, detail
       FROM bms.work_order_events WHERE work_order_id = $1 ORDER BY created_at, id`,
    [workOrderId],
  );
  return rows;
}

const shape = (rows: EventRow[]): Array<[string, string | null, string | null]> =>
  rows.map((row) => [row.event_type, row.from_status, row.to_status]);

/** A manual create writes one `created` event; with an alarm its origin is `alarm`; with an assignee an `assigned` follows. */
export async function assertCreateWritesItsFirstEvents(ctx: WorkOrderEventsFixtures): Promise<void> {
  const manual = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "medium" }, ctx.actor, null);
  const manualEvents = await eventsOf(ctx.fleetPool, manual.id);
  expect(shape(manualEvents)).toEqual([["created", null, "open"]]);
  expect(manualEvents[0]?.detail).toEqual({ origin: "manual" });
  expect(manualEvents[0]?.actor_id).toBe(ctx.actorUserId);

  const fromAlarm = await ctx.svc.create(
    { assetId: ctx.assetId, alarmId: ctx.alarmId, title: TITLE, priority: "high", assignedTo: ctx.actorUserId },
    ctx.actor,
    null,
  );
  const alarmEvents = await eventsOf(ctx.fleetPool, fromAlarm.id);
  expect(shape(alarmEvents)).toEqual([
    ["created", null, "open"],
    ["assigned", "open", "assigned"],
  ]);
  expect(alarmEvents[0]?.detail).toEqual({ origin: "alarm" });
  expect(alarmEvents[1]?.detail).toEqual({ assignedTo: ctx.actorUserId });
}

/** A status move writes `status_changed` with both statuses; into `resolved` it is `resolved`; an assignee change writes `assigned`; a position-only write writes nothing. */
export async function assertStatusAndAssigneeChangesWriteEvents(ctx: WorkOrderEventsFixtures): Promise<void> {
  const created = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "medium" }, ctx.actor, null);

  await ctx.svc.updateStatus(created.id, { status: "open", sortOrder: 5 }, ctx.actor, null);
  expect((await eventsOf(ctx.fleetPool, created.id)).length, "a position-only write is not an event").toBe(1);

  await ctx.svc.updateStatus(created.id, { status: "assigned", assignedTo: ctx.actorUserId }, ctx.actor, null);
  await ctx.svc.updateStatus(created.id, { status: "in_progress", reason: "Started on site" }, ctx.actor, null);
  await ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  await ctx.svc.updateStatus(created.id, { status: "resolved", assignedTo: null }, ctx.actor, null);

  const rows = await eventsOf(ctx.fleetPool, created.id);
  expect(shape(rows)).toEqual([
    ["created", null, "open"],
    ["assigned", "open", "assigned"],
    ["status_changed", "open", "assigned"],
    ["status_changed", "assigned", "in_progress"],
    ["resolved", "in_progress", "resolved"],
    ["assigned", "resolved", "resolved"],
  ]);
  expect(rows[1]?.detail).toEqual({ assignedTo: ctx.actorUserId });
  expect(rows[3]?.detail).toEqual({ reason: "Started on site" });
  expect(rows[5]?.detail, "an unassign records a null assignee").toEqual({ assignedTo: null });
}

/** A reorder writes one event per ticket whose status changed, and none for a ticket that only moved. */
export async function assertReorderWritesOneEventPerStatusChange(ctx: WorkOrderEventsFixtures): Promise<void> {
  const moved = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);
  const stayed = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);
  await ctx.svc.reorder(
    {
      items: [
        { id: moved.id, status: "in_progress", sortOrder: 0 },
        { id: stayed.id, status: "open", sortOrder: 1 },
      ],
    },
    ctx.actor,
    null,
  );
  expect(shape(await eventsOf(ctx.fleetPool, moved.id))).toEqual([
    ["created", null, "open"],
    ["status_changed", "open", "in_progress"],
  ]);
  expect(shape(await eventsOf(ctx.fleetPool, stayed.id))).toEqual([["created", null, "open"]]);
}

/** The change, its audit row and its event are one transaction: when the audit write throws, none of them exists. */
export async function assertAFailedAuditLeavesNoChangeAndNoEvent(ctx: WorkOrderEventsFixtures): Promise<void> {
  const before = await ctx.fleetPool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM bms.work_orders WHERE asset_id = $1",
    [ctx.assetId],
  );
  await expect(
    ctx.svcWithFailingAudit.create({ assetId: ctx.assetId, title: TITLE, priority: "medium" }, ctx.actor, null),
  ).rejects.toThrow("audit is down");
  const after = await ctx.fleetPool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM bms.work_orders WHERE asset_id = $1",
    [ctx.assetId],
  );
  expect(after.rows[0]?.n, "no work order was created").toBe(before.rows[0]?.n);

  // A reorder writes its events BEFORE its audit rows, so this is the half that fails
  // if an event is ever written outside the transaction: the event would survive.
  const created = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "medium" }, ctx.actor, null);
  await expect(
    ctx.svcWithFailingAudit.reorder({ items: [{ id: created.id, status: "in_progress", sortOrder: 0 }] }, ctx.actor, null),
  ).rejects.toThrow("audit is down");
  const row = await ctx.fleetPool.query<{ status: string }>("SELECT status FROM bms.work_orders WHERE id = $1", [created.id]);
  expect(row.rows[0]?.status, "the status did not change").toBe("open");
  expect(shape(await eventsOf(ctx.fleetPool, created.id)), "the status event was rolled back").toEqual([["created", null, "open"]]);

  // The status route writes its audit row first; the change must not survive either.
  await expect(
    ctx.svcWithFailingAudit.updateStatus(created.id, { status: "in_progress" }, ctx.actor, null),
  ).rejects.toThrow("audit is down");
  const again = await ctx.fleetPool.query<{ status: string }>("SELECT status FROM bms.work_orders WHERE id = $1", [created.id]);
  expect(again.rows[0]?.status).toBe("open");
  expect((await eventsOf(ctx.fleetPool, created.id)).length).toBe(1);
}

async function refusalCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (err) {
    // drizzle wraps the driver error; the Postgres code sits on it or on its cause.
    const direct = (err as { code?: string }).code;
    return direct ?? (err as { cause?: { code?: string } }).cause?.code;
  }
}

/** The timeline is append-only for both API roles: UPDATE and DELETE are permission denied (42501). */
export async function assertTheTimelineIsAppendOnlyOnBothPools(ctx: WorkOrderEventsFixtures): Promise<void> {
  const created = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "medium" }, ctx.actor, null);
  const [event] = await eventsOf(ctx.fleetPool, created.id);
  expect(event).toBeDefined();
  const id = event?.id as string;

  expect(await refusalCode(() => ctx.fleetPool.query("UPDATE bms.work_order_events SET detail = '{}' WHERE id = $1", [id]))).toBe("42501");
  expect(await refusalCode(() => ctx.fleetPool.query("DELETE FROM bms.work_order_events WHERE id = $1", [id]))).toBe("42501");
  expect(
    await refusalCode(() =>
      withTenant(ctx.tenantDb, ctx.organizationId, (tx) => tx.execute(sql`UPDATE bms.work_order_events SET detail = '{}' WHERE id = ${id}::uuid`)),
    ),
  ).toBe("42501");
  expect(
    await refusalCode(() =>
      withTenant(ctx.tenantDb, ctx.organizationId, (tx) => tx.execute(sql`DELETE FROM bms.work_order_events WHERE id = ${id}::uuid`)),
    ),
  ).toBe("42501");
  expect((await eventsOf(ctx.fleetPool, created.id)).length, "the event is still there").toBe(1);
}

/** Under another organization's setting an event cannot be filed against this organization's work order, under either organization id. */
export async function assertAForeignSettingCannotFileAnEvent(ctx: WorkOrderEventsFixtures): Promise<void> {
  const created = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "medium" }, ctx.actor, null);
  for (const claimedOrg of [ctx.foreignOrgId, ctx.organizationId]) {
    // Row security refuses it (42501) when the claimed organization is the ticket's;
    // under the caller's own id the composite foreign key refuses it first (23503).
    const code = await refusalCode(() =>
      withTenant(ctx.tenantDb, ctx.foreignOrgId, (tx) =>
        tx.insert(workOrderEvents).values({ organizationId: claimedOrg, workOrderId: created.id, eventType: "status_changed" }),
      ),
    );
    expect(["42501", "23503"], `organization_id ${claimedOrg === ctx.foreignOrgId ? "of the caller" : "of the ticket"}: ${code}`).toContain(code);
  }
  // The key binds a role the policy does not: the fleet pool bypasses row security.
  expect(
    await refusalCode(() =>
      ctx.fleetPool.query(
        "INSERT INTO bms.work_order_events (organization_id, work_order_id, event_type) VALUES ($1, $2, 'status_changed')",
        [ctx.foreignOrgId, created.id],
      ),
    ),
    "the fleet pool cannot file an event under another organization",
  ).toBe("23503");
  expect((await eventsOf(ctx.fleetPool, created.id)).length).toBe(1);
  const seen = await withTenant(ctx.tenantDb, ctx.foreignOrgId, (tx) =>
    tx.execute(sql`SELECT 1 FROM bms.work_order_events WHERE work_order_id = ${created.id}::uuid`),
  );
  expect(seen.rows.length, "the other organization reads none of the timeline").toBe(0);
}

/** The saved name is the actor's display name — for an organization user, a global admin and a confirmed copilot change — and never an email or a subject. */
export async function assertTheSavedNameIsTheDisplayName(ctx: WorkOrderEventsFixtures): Promise<void> {
  const byUser = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "medium" }, ctx.actor, null);
  const byAdmin = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "medium" }, ctx.globalAdmin, null);
  const byCopilot = await copilotContext.run({ change: { via: "copilot", changeId: "00000000-0000-4000-8000-0000000e3102" } }, () =>
    ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "medium" }, ctx.actor, null),
  );

  expect((await eventsOf(ctx.fleetPool, byUser.id))[0]?.actor_name).toBe(ctx.actorDisplayName);
  expect((await eventsOf(ctx.fleetPool, byAdmin.id))[0]?.actor_name).toBe(ctx.globalAdminDisplayName);
  expect((await eventsOf(ctx.fleetPool, byCopilot.id))[0]?.actor_name, "a confirmed copilot change saves the same name").toBe(
    ctx.actorDisplayName,
  );
  expect(ctx.actorDisplayName).not.toBe(ctx.actor.email);

  for (const id of [byUser.id, byAdmin.id, byCopilot.id]) {
    for (const row of await eventsOf(ctx.fleetPool, id)) {
      const text = JSON.stringify([row.actor_name, row.detail]);
      for (const secret of [ctx.actor.email, ctx.actor.sub, ctx.globalAdmin.email, ctx.globalAdmin.sub]) {
        expect(text.includes(secret), `an event must not carry ${secret}`).toBe(false);
      }
    }
  }
}

/** The name is saved, not joined: renaming the user afterwards leaves the old event as it was, and a new event takes the new name. */
export async function assertARenameDoesNotRewriteHistory(ctx: WorkOrderEventsFixtures): Promise<void> {
  const created = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "medium" }, ctx.fixtureUser, null);
  expect((await eventsOf(ctx.fleetPool, created.id))[0]?.actor_name).toBe(ctx.fixtureUserDisplayName);

  // The suite's own user: no other suite acts as it, and its row goes with the suite.
  await ctx.fleetPool.query("UPDATE bms.users SET display_name = $2 WHERE id = $1", [ctx.fixtureUserId, "E3.1 Renamed User"]);
  expect((await eventsOf(ctx.fleetPool, created.id))[0]?.actor_name, "the stored event keeps the old name").toBe(
    ctx.fixtureUserDisplayName,
  );
  const detail = await ctx.svc.getDetail(created.id, [ctx.assetId]);
  expect(detail.events[0]?.actorName, "and so does the read").toBe(ctx.fixtureUserDisplayName);

  // A fresh principal object: the identity resolver memoizes per object.
  await ctx.svc.updateStatus(created.id, { status: "in_progress" }, { ...ctx.fixtureUser }, null);
  expect((await eventsOf(ctx.fleetPool, created.id))[1]?.actor_name, "a later event takes the new name").toBe("E3.1 Renamed User");
}

/** Closing through the close route writes a status event with the reason; an upper-case id of the current assignee is not a change. */
export async function assertCloseAndASameAssigneeWriteWhatTheyShould(ctx: WorkOrderEventsFixtures): Promise<void> {
  const created = await ctx.svc.create(
    { assetId: ctx.assetId, title: TITLE, priority: "medium", assignedTo: ctx.actorUserId },
    ctx.actor,
    null,
  );
  await ctx.svc.updateStatus(created.id, { status: "assigned", assignedTo: ctx.actorUserId.toUpperCase() }, ctx.actor, null);
  expect((await eventsOf(ctx.fleetPool, created.id)).length, "re-sending the current assignee is not an event").toBe(2);

  await ctx.svc.close(created.id, ctx.actor, { reason: "Duplicate of another ticket" }, null);
  const rows = await eventsOf(ctx.fleetPool, created.id);
  expect(shape(rows).at(-1)).toEqual(["status_changed", "assigned", "closed"]);
  expect(rows.at(-1)?.detail).toEqual({ reason: "Duplicate of another ticket" });
  await expect(ctx.svc.updateStatus(created.id, { status: "in_progress" }, ctx.actor, null), "a closed ticket stays closed").rejects.toMatchObject({
    status: 400,
  });
  expect((await eventsOf(ctx.fleetPool, created.id)).length, "and writes no further event").toBe(rows.length);
}

/** The status audit row carries the reference and both statuses. */
export async function assertTheAuditPayloadNamesTheTicket(ctx: WorkOrderEventsFixtures): Promise<void> {
  const created = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "medium" }, ctx.actor, null);
  await ctx.svc.updateStatus(created.id, { status: "in_progress" }, ctx.actor, null);
  await ctx.svc.reorder({ items: [{ id: created.id, status: "assigned", sortOrder: 2 }] }, ctx.actor, null);
  const { rows } = await ctx.fleetPool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM bms.audit_log
      WHERE entity_id = $1 AND action = 'work_order_status_update' ORDER BY created_at, id`,
    [created.id],
  );
  expect(rows.map((row) => [row.payload.reference, row.payload.fromStatus, row.payload.toStatus])).toEqual([
    [created.reference, "open", "in_progress"],
    [created.reference, "in_progress", "assigned"],
  ]);
}

/** `GET :id`: the item with its events in order and its alarm; a tenant-pool reader sees a global admin's name; outside the scope it is 404. */
export async function assertTheDetailReadIsScopedAndOrdered(ctx: WorkOrderEventsFixtures): Promise<void> {
  const created = await ctx.svc.create(
    { assetId: ctx.assetId, alarmId: ctx.alarmId, title: TITLE, priority: "high" },
    ctx.globalAdmin,
    null,
  );
  await ctx.svc.updateStatus(created.id, { status: "in_progress" }, ctx.actor, null);
  // A ticket raised from an alarm owes its findings to resolve (decision 5.2, PR 4); they
  // are saved with the move and write their own event first.
  await ctx.svc.updateStatus(
    created.id,
    { status: "resolved", rootCause: "Breaker contacts worn", correctiveAction: "Contacts replaced", causeCode: "wear_and_tear" },
    ctx.actor,
    null,
  );

  // A scoped, single-organization reader: served on the tenant pool under the setting.
  const detail = await ctx.svc.getDetail(created.id, [ctx.assetId]);
  expect(workOrderDetailSchema.safeParse(detail).success, "the detail matches its contract").toBe(true);
  expect(detail.reference).toBe(created.reference);
  expect(detail.events.map((event) => [event.eventType, event.fromStatus, event.toStatus])).toEqual([
    ["created", null, "open"],
    ["status_changed", "open", "in_progress"],
    ["root_cause_set", null, null],
    ["resolved", "in_progress", "resolved"],
  ]);
  expect(detail.events[2]?.detail, "the coded cause, never the typed text").toEqual({ causeCode: "wear_and_tear" });
  expect(detail.events[0]?.actorName, "a tenant reader sees the global admin's name").toBe(ctx.globalAdminDisplayName);
  expect(detail.events[0]?.detail).toEqual({ origin: "alarm" });
  expect(detail.events[1]?.actorName).toBe(ctx.actorDisplayName);
  expect(detail.alarm?.id).toBe(ctx.alarmId);
  const stamps = detail.events.map((event) => event.createdAt);
  expect([...stamps].sort()).toEqual(stamps);

  // An unscoped reader (a global admin) reads the same ticket.
  expect((await ctx.svc.getDetail(created.id, null)).events.length).toBe(4);

  await expect(ctx.svc.getDetail(created.id, [ctx.otherAssetId]), "another asset's scope").rejects.toMatchObject({ status: 404 });
  await expect(ctx.svc.getDetail(created.id, []), "no readable asset").rejects.toMatchObject({ status: 404 });
  await expect(
    ctx.svc.getDetail("00000000-0000-4000-8000-0000000e3103", null),
    "a ticket that does not exist",
  ).rejects.toMatchObject({ status: 404 });
}
