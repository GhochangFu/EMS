import { ConflictException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import type { BmsDb } from "@bms/db";
import { workOrderDetailSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { withTenant } from "../database/tenant-context";
import { readAlarmEnrichmentForSnapshot } from "./work-order-findings";
import type { WorkOrderFindingsService } from "./work-order-findings.service";
import { WORK_ORDER_ROOT_CAUSE_REQUIRED_REFUSAL } from "./work-order-transitions";
import type { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.4`, folded into `E3.1` (ADR 0122 decision 5a; plan T4.2 and D17) — the alarm's
 * enrichment copied onto the ticket once, at create, as a frozen snapshot. Against real
 * `bms_tenant` and `bms_fleet` roles. Assertions live here;
 * `work-order-alarm-snapshot.integration.test.ts` owns the database lifecycle (ADR 0014).
 */
type Actor = Pick<JwtPayload, "sub" | "email">;

export type SnapshotFixtures = {
  svc: WorkOrdersService;
  findings: WorkOrderFindingsService;
  tenantDb: BmsDb;
  fleetPool: pg.Pool;
  actor: Actor;
  organizationId: string;
  assetId: string;
  /** An alarm on `assetId` with a full enrichment. */
  enrichedAlarmId: string;
  /** An alarm on `assetId` with no enrichment row. */
  bareAlarmId: string;
  /** An alarm on `assetId` whose enrichment names a skill that has since been retired. */
  retiredSkillAlarmId: string;
  retiredSkillCode: string;
  /** An enriched alarm of ANOTHER organization. */
  foreignAlarmId: string;
};

export const ENRICHMENT = {
  rootCause: "E31 snapshot root cause",
  correctiveActions: "E31 snapshot corrective actions",
  skillCode: "electrical",
  etrAt: "2026-12-01T10:00:00.000Z",
};

const TITLE = "E3.1 snapshot fixture";

type SnapshotRow = {
  alarm_root_cause: string | null;
  alarm_corrective_actions: string | null;
  alarm_skill_code: string | null;
  alarm_etr_at: Date | null;
};

async function snapshotOf(pool: pg.Pool, id: string): Promise<Array<string | null>> {
  const { rows } = await pool.query<SnapshotRow>(
    "SELECT alarm_root_cause, alarm_corrective_actions, alarm_skill_code, alarm_etr_at FROM bms.work_orders WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error("E3.1: the ticket is gone");
  return [row.alarm_root_cause, row.alarm_corrective_actions, row.alarm_skill_code, row.alarm_etr_at?.toISOString() ?? null];
}

const FOUR = [ENRICHMENT.rootCause, ENRICHMENT.correctiveActions, ENRICHMENT.skillCode, ENRICHMENT.etrAt];

const from = (ctx: SnapshotFixtures, alarmId: string) =>
  ctx.svc.create({ assetId: ctx.assetId, alarmId, title: TITLE, priority: "high" }, ctx.actor, null);

/** A ticket created from an enriched alarm carries the four values, on the row and on the detail. */
export async function assertATicketFromAnEnrichedAlarmCarriesTheFourValues(ctx: SnapshotFixtures): Promise<void> {
  const created = await from(ctx, ctx.enrichedAlarmId);
  expect(await snapshotOf(ctx.fleetPool, created.id)).toEqual(FOUR);
  const detail = await ctx.svc.getDetail(created.id, [ctx.assetId]);
  expect(detail.alarmSnapshot).toEqual(ENRICHMENT);
  expect(workOrderDetailSchema.safeParse(detail).success).toBe(true);
  // The snapshot is the alarm's analysis, not the technician's findings.
  expect([detail.rootCause, detail.correctiveAction, detail.causeCode]).toEqual([null, null, null]);
}

/** A ticket from an alarm with no enrichment, and a ticket with no alarm, have four NULLs and a null snapshot. */
export async function assertNoEnrichmentAndNoAlarmGiveANullSnapshot(ctx: SnapshotFixtures): Promise<void> {
  const bare = await from(ctx, ctx.bareAlarmId);
  expect(await snapshotOf(ctx.fleetPool, bare.id)).toEqual([null, null, null, null]);
  expect((await ctx.svc.getDetail(bare.id, null)).alarmSnapshot).toBeNull();

  const manual = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);
  expect(await snapshotOf(ctx.fleetPool, manual.id)).toEqual([null, null, null, null]);
  expect((await ctx.svc.getDetail(manual.id, null)).alarmSnapshot).toBeNull();
}

/** Editing the alarm's enrichment afterwards leaves the ticket's snapshot unchanged; a ticket created after the edit takes the new values. */
export async function assertALaterEnrichmentEditDoesNotReachTheTicket(ctx: SnapshotFixtures): Promise<void> {
  const before = await from(ctx, ctx.enrichedAlarmId);
  await ctx.fleetPool.query(
    "UPDATE bms.alarm_enrichments SET root_cause = 'E31 edited later', corrective_actions = NULL, etr_at = NULL WHERE alarm_id = $1",
    [ctx.enrichedAlarmId],
  );
  try {
    expect(await snapshotOf(ctx.fleetPool, before.id), "the ticket keeps what it copied").toEqual(FOUR);
    const after = await from(ctx, ctx.enrichedAlarmId);
    expect(await snapshotOf(ctx.fleetPool, after.id)).toEqual(["E31 edited later", null, ENRICHMENT.skillCode, null]);
  } finally {
    await ctx.fleetPool.query(
      "UPDATE bms.alarm_enrichments SET root_cause = $2, corrective_actions = $3, etr_at = $4 WHERE alarm_id = $1",
      [ctx.enrichedAlarmId, ENRICHMENT.rootCause, ENRICHMENT.correctiveActions, ENRICHMENT.etrAt],
    );
  }
}

/** A retired skill code already on the enrichment is still copied. */
export async function assertARetiredSkillCodeIsStillCopied(ctx: SnapshotFixtures): Promise<void> {
  const created = await from(ctx, ctx.retiredSkillAlarmId);
  expect((await snapshotOf(ctx.fleetPool, created.id))[2]).toBe(ctx.retiredSkillCode);
}

/**
 * Another organization's enrichment cannot be copied. This asserts the OUTCOME, not which
 * layer gives it: the reader filters on the organization itself and row security hides
 * the row too, so either alone keeps the first half green; and `create` refuses a foreign
 * alarm before the reader runs.
 */
export async function assertAForeignAlarmsEnrichmentIsNeverCopied(ctx: SnapshotFixtures): Promise<void> {
  const seen = await withTenant(ctx.tenantDb, ctx.organizationId, (tx) =>
    readAlarmEnrichmentForSnapshot(tx, { organizationId: ctx.organizationId, alarmId: ctx.foreignAlarmId }),
  );
  expect(seen, "the foreign enrichment is invisible").toBeNull();

  const count = async (): Promise<string | undefined> =>
    (await ctx.fleetPool.query<{ n: string }>("SELECT count(*)::text AS n FROM bms.work_orders WHERE asset_id = $1", [ctx.assetId])).rows[0]?.n;
  const before = await count();
  await expect(from(ctx, ctx.foreignAlarmId)).rejects.toBeInstanceOf(NotFoundException);
  expect(await count(), "no ticket was created").toBe(before);
}

/** A full snapshot does not satisfy the resolve gate: the technician's own findings are still owed (decision 5a.3). */
export async function assertTheSnapshotDoesNotSatisfyTheResolveGate(ctx: SnapshotFixtures): Promise<void> {
  const created = await from(ctx, ctx.enrichedAlarmId);
  const attempt = ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  await expect(attempt).rejects.toBeInstanceOf(ConflictException);
  await expect(attempt).rejects.toThrow(WORK_ORDER_ROOT_CAUSE_REQUIRED_REFUSAL);
}

/** No route updates the snapshot: a status write with findings, a root-cause write and a reorder all leave it as it was. */
export async function assertNoWriteChangesTheSnapshot(ctx: SnapshotFixtures): Promise<void> {
  const created = await from(ctx, ctx.enrichedAlarmId);
  const findings = { rootCause: "Technician's own cause", correctiveAction: "Technician's own action", causeCode: "wear_and_tear" };
  await ctx.findings.putRootCause(created.id, findings, ctx.actor, null);
  await ctx.svc.reorder({ items: [{ id: created.id, status: "in_progress", sortOrder: 3 }] }, ctx.actor, null);
  await ctx.svc.updateStatus(created.id, { status: "resolved", ...findings, preventiveAction: "Inspect yearly" }, ctx.actor, null);
  await ctx.svc.updateStatus(created.id, { status: "in_progress" }, ctx.actor, null);
  expect(await snapshotOf(ctx.fleetPool, created.id)).toEqual(FOUR);
  const detail = await ctx.svc.getDetail(created.id, null);
  expect(detail.alarmSnapshot).toEqual(ENRICHMENT);
  expect(detail.rootCause, "the findings are kept apart from the snapshot").toBe(findings.rootCause);
}
