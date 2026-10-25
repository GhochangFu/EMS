import { BadRequestException } from "@nestjs/common";
import pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { ASSIGNEE_REFUSAL } from "./assignee";
import type { WorkOrdersService } from "./work-orders.service";

/**
 * `F4.285` (ADR 0106 decision 6) — `POST /work-orders` and `PATCH /work-orders/:id/status`
 * accept an `assignedTo` only when it is an **active** user (`disabled_at IS NULL`) **of the
 * work order's organization**. A user of another organization, a disabled user, a global admin
 * (no organization, drafter choice DC-A) and an id that is no user are each refused with the
 * one 400 sentence (DC-B), so the refusal does not disclose whether a foreign id exists.
 *
 * The service runs on a real `bms_tenant`/`bms_fleet` pair. Each refusal asserts the class
 * **and** the sentence (one error class, many guards), then reads the row on the fleet pool
 * beside it. Vitest entry point: the sibling `.test.ts`, which owns the database lifecycle.
 */
export type AssigneeFixtures = {
  svc: WorkOrdersService;
  actor: Pick<JwtPayload, "sub" | "email">;
  /** The BYPASSRLS fleet pool: every read-back sees the row whatever the GUC. */
  fleetPool: pg.Pool;
  assetId: string;
  /** A work order of org A, `open`, no assignee, for the update claims. */
  workOrderId: string;
  /** An active user of org A. */
  activeA: string;
  /** A user of org A with `disabled_at` set. */
  disabledA: string;
  /** An active user of org B. */
  activeB: string;
  /** The seeded `admin@bms.local`: `organization_id IS NULL`. */
  globalAdminId: string;
  /** A random id that is no user. */
  unknownId: string;
  /** A per-run title prefix, so a count reads only this run's rows. */
  titlePrefix: string;
};

type Row = { status: string; assigned_to: string | null };

async function readWorkOrder(ctx: AssigneeFixtures, id: string): Promise<Row> {
  const { rows } = await ctx.fleetPool.query<Row>(
    "SELECT status, assigned_to FROM bms.work_orders WHERE id = $1",
    [id],
  );
  if (!rows[0]) throw new Error(`F4.285: work order ${id} is gone`);
  return rows[0];
}

async function countByTitle(ctx: AssigneeFixtures, title: string): Promise<number> {
  const { rows } = await ctx.fleetPool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.work_orders WHERE asset_id = $1 AND title = $2",
    [ctx.assetId, title],
  );
  return rows[0]?.n ?? -1;
}

/** The refusal, by class and by sentence. */
async function expectRefused(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  expect((error as Error).message).toBe(ASSIGNEE_REFUSAL);
}

function createWith(ctx: AssigneeFixtures, title: string, assignedTo?: string) {
  return ctx.svc.create(
    { assetId: ctx.assetId, title, priority: "medium", ...(assignedTo ? { assignedTo } : {}) },
    ctx.actor,
    [ctx.assetId],
  );
}

/** Refuses a create with `assignedTo`, then proves no row of that title was written. */
async function createIsRefused(ctx: AssigneeFixtures, suffix: string, assignedTo: string): Promise<void> {
  const title = `${ctx.titlePrefix}${suffix}`;
  await expectRefused(createWith(ctx, title, assignedTo));
  expect(await countByTitle(ctx, title)).toBe(0);
}

export async function createAcceptsAnActiveUserOfTheOrganization(ctx: AssigneeFixtures): Promise<void> {
  const created = await createWith(ctx, `${ctx.titlePrefix}accepted`, ctx.activeA);
  expect(await readWorkOrder(ctx, created.id)).toEqual({ status: "assigned", assigned_to: ctx.activeA });
}

export async function createRefusesAUserOfAnotherOrganization(ctx: AssigneeFixtures): Promise<void> {
  await createIsRefused(ctx, "other-org", ctx.activeB);
}

export async function createRefusesADisabledUserOfTheOrganization(ctx: AssigneeFixtures): Promise<void> {
  await createIsRefused(ctx, "disabled", ctx.disabledA);
}

export async function createRefusesAGlobalAdmin(ctx: AssigneeFixtures): Promise<void> {
  await createIsRefused(ctx, "global-admin", ctx.globalAdminId);
}

export async function createRefusesAnUnknownIdWithTheSameSentence(ctx: AssigneeFixtures): Promise<void> {
  await createIsRefused(ctx, "unknown", ctx.unknownId);
}

export async function createWithoutAnAssigneeStaysOpen(ctx: AssigneeFixtures): Promise<void> {
  const created = await createWith(ctx, `${ctx.titlePrefix}no-assignee`);
  expect(await readWorkOrder(ctx, created.id)).toEqual({ status: "open", assigned_to: null });
}

export async function updateAcceptsAnActiveUserOfTheOrganization(ctx: AssigneeFixtures): Promise<void> {
  await ctx.svc.updateStatus(ctx.workOrderId, { status: "assigned", assignedTo: ctx.activeA }, ctx.actor, [ctx.assetId]);
  expect(await readWorkOrder(ctx, ctx.workOrderId)).toEqual({ status: "assigned", assigned_to: ctx.activeA });
}

/** Refuses an update to `in_progress` with `assignedTo`, and the row reads the same before and after. */
async function updateIsRefused(ctx: AssigneeFixtures, assignedTo: string): Promise<void> {
  await ctx.svc.updateStatus(ctx.workOrderId, { status: "assigned", assignedTo: ctx.activeA }, ctx.actor, [ctx.assetId]);
  const before = await readWorkOrder(ctx, ctx.workOrderId);
  expect(before).toEqual({ status: "assigned", assigned_to: ctx.activeA });
  await expectRefused(
    ctx.svc.updateStatus(ctx.workOrderId, { status: "in_progress", assignedTo }, ctx.actor, [ctx.assetId]),
  );
  expect(await readWorkOrder(ctx, ctx.workOrderId)).toEqual(before);
}

export async function updateRefusesAUserOfAnotherOrganizationAndLeavesTheRow(ctx: AssigneeFixtures): Promise<void> {
  await updateIsRefused(ctx, ctx.activeB);
}

export async function updateRefusesADisabledUser(ctx: AssigneeFixtures): Promise<void> {
  await updateIsRefused(ctx, ctx.disabledA);
}

export async function updateClearsTheAssigneeWithNull(ctx: AssigneeFixtures): Promise<void> {
  await ctx.svc.updateStatus(ctx.workOrderId, { status: "assigned", assignedTo: ctx.activeA }, ctx.actor, [ctx.assetId]);
  await ctx.svc.updateStatus(ctx.workOrderId, { status: "open", assignedTo: null }, ctx.actor, [ctx.assetId]);
  expect(await readWorkOrder(ctx, ctx.workOrderId)).toEqual({ status: "open", assigned_to: null });
}

export async function updateWithoutAssignedToLeavesTheAssigneeUnchanged(ctx: AssigneeFixtures): Promise<void> {
  await ctx.svc.updateStatus(ctx.workOrderId, { status: "assigned", assignedTo: ctx.activeA }, ctx.actor, [ctx.assetId]);
  await ctx.svc.updateStatus(ctx.workOrderId, { status: "in_progress" }, ctx.actor, [ctx.assetId]);
  expect(await readWorkOrder(ctx, ctx.workOrderId)).toEqual({ status: "in_progress", assigned_to: ctx.activeA });
}
