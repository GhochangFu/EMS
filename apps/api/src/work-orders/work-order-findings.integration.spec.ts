import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import { workOrderDetailSchema, workOrderListItemSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { CAUSE_CODE_REFUSAL } from "./work-order-findings";
import type { WorkOrderFindingsService } from "./work-order-findings.service";
import {
  WORK_ORDER_FINDINGS_FROZEN_REFUSAL,
  WORK_ORDER_FINDINGS_KEPT_REFUSAL,
  WORK_ORDER_LEAVE_RESOLVED_REFUSAL,
  WORK_ORDER_ROOT_CAUSE_REQUIRED_REFUSAL,
} from "./work-order-transitions";
import type { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.1` (ADR 0122 decisions 5 and 6.5; plan T4.3) — a ticket's findings and the resolve
 * gate, against real `bms_tenant` and `bms_fleet` roles. Assertions live here;
 * `work-order-findings.integration.test.ts` owns the database lifecycle (ADR 0014).
 */
type Actor = Pick<JwtPayload, "sub" | "email">;

export type FindingsFixtures = {
  svc: WorkOrdersService;
  findings: WorkOrderFindingsService;
  /** The same findings service with an audit writer that throws, for the atomicity proof. */
  findingsWithFailingAudit: WorkOrderFindingsService;
  tenantPool: pg.Pool;
  fleetPool: pg.Pool;
  /** An `organization_admin` of the organization, and that user's row id. */
  actor: Actor;
  actorUserId: string;
  organizationId: string;
  assetId: string;
  /** A second asset of the same organization, for the scope checks. */
  otherAssetId: string;
  /** An alarm on `assetId`, with no enrichment. */
  alarmId: string;
  /** A cause code this run made and retired (`active = false`). */
  retiredCauseCode: string;
  /** A cause code this run made, active: a test may retire it. */
  ownCauseCode: string;
};

const TITLE = "E3.1 findings fixture";
const FULL = { rootCause: "Breaker contacts worn", correctiveAction: "Contacts replaced", causeCode: "wear_and_tear" };
const SEEDED_CODES = [
  "equipment_failure",
  "wear_and_tear",
  "power_quality",
  "sensor_fault",
  "configuration_error",
  "operator_error",
  "external_event",
  "no_fault_found",
  "other",
];

type Row = {
  status: string;
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  cause_code: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
};

async function rowOf(pool: pg.Pool, id: string): Promise<Row> {
  const { rows } = await pool.query<Row>(
    `SELECT status, root_cause, corrective_action, preventive_action, cause_code, resolved_at, resolved_by
       FROM bms.work_orders WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new Error("E3.1: the ticket is gone");
  return rows[0];
}

async function eventsOf(pool: pg.Pool, id: string): Promise<Array<[string, Record<string, unknown>]>> {
  const { rows } = await pool.query<{ event_type: string; detail: Record<string, unknown> }>(
    "SELECT event_type, detail FROM bms.work_order_events WHERE work_order_id = $1 ORDER BY created_at, id",
    [id],
  );
  return rows.map((row) => [row.event_type, row.detail]);
}

const fromAlarm = (ctx: FindingsFixtures) =>
  ctx.svc.create({ assetId: ctx.assetId, alarmId: ctx.alarmId, title: TITLE, priority: "high" }, ctx.actor, null);
const planned = (ctx: FindingsFixtures) => ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);

/** A ticket raised from an alarm is refused `resolved` with 409 until it has all three findings; a refused write saves nothing. */
export async function assertAnAlarmTicketNeedsItsFindingsToResolve(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);

  const bare = ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  await expect(bare).rejects.toBeInstanceOf(ConflictException);
  await expect(bare).rejects.toThrow(WORK_ORDER_ROOT_CAUSE_REQUIRED_REFUSAL);

  // Two of the three: still refused, and the two it sent are not kept.
  await expect(
    ctx.svc.updateStatus(created.id, { status: "resolved", rootCause: FULL.rootCause, correctiveAction: FULL.correctiveAction }, ctx.actor, null),
  ).rejects.toBeInstanceOf(ConflictException);
  const refused = await rowOf(ctx.fleetPool, created.id);
  expect([refused.status, refused.root_cause, refused.corrective_action, refused.resolved_at]).toEqual(["open", null, null, null]);
  expect((await eventsOf(ctx.fleetPool, created.id)).map(([type]) => type), "a refused resolve writes no event").toEqual(["created"]);

  const resolved = await ctx.svc.updateStatus(created.id, { status: "resolved", ...FULL }, ctx.actor, null);
  expect([resolved.status, resolved.causeCode]).toEqual(["resolved", "wear_and_tear"]);
}

/** Resolve stamps when and who, saves the findings, and writes `root_cause_set` then `resolved`, with the coded cause and no typed text. */
export async function assertResolveStampsAndWritesItsEvents(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);
  await ctx.svc.updateStatus(created.id, { status: "resolved", ...FULL, preventiveAction: "Inspect quarterly" }, ctx.actor, null);

  const row = await rowOf(ctx.fleetPool, created.id);
  expect([row.root_cause, row.corrective_action, row.preventive_action, row.cause_code]).toEqual([
    FULL.rootCause,
    FULL.correctiveAction,
    "Inspect quarterly",
    FULL.causeCode,
  ]);
  expect(row.resolved_by).toBe(ctx.actorUserId);
  expect(row.resolved_at).not.toBeNull();

  expect(await eventsOf(ctx.fleetPool, created.id)).toEqual([
    ["created", { origin: "alarm" }],
    ["root_cause_set", { causeCode: "wear_and_tear" }],
    ["resolved", {}],
  ]);
  const text = await ctx.fleetPool.query<{ text: string }>(
    `SELECT string_agg(detail::text, ' ') AS text FROM bms.work_order_events WHERE work_order_id = $1`,
    [created.id],
  );
  for (const typed of [FULL.rootCause, FULL.correctiveAction, "Inspect quarterly"]) {
    expect(text.rows[0]?.text.includes(typed), `"${typed}" is not on the timeline`).toBe(false);
  }
}

/** The status audit row names the coded cause and says the findings changed, and holds none of the typed text. */
export async function assertTheStatusAuditRowHoldsNoFindingText(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);
  await ctx.svc.updateStatus(created.id, { status: "resolved", ...FULL }, ctx.actor, null);
  const { rows } = await ctx.fleetPool.query<{ payload: Record<string, unknown>; text: string }>(
    "SELECT payload, payload::text AS text FROM bms.audit_log WHERE action = 'work_order_status_update' AND entity_id = $1",
    [created.id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.payload).toMatchObject({ toStatus: "resolved", findingsChanged: true, causeCode: "wear_and_tear" });
  expect(rows[0]?.text.includes(FULL.rootCause)).toBe(false);
  expect(rows[0]?.text.includes(FULL.correctiveAction)).toBe(false);
}

/** Findings saved earlier through the root-cause route satisfy the gate: the resolve needs to send none. */
export async function assertFindingsSavedEarlierSatisfyTheGate(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);
  await ctx.findings.putRootCause(created.id, FULL, ctx.actor, null);
  const resolved = await ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  expect(resolved.status).toBe("resolved");
  expect((await eventsOf(ctx.fleetPool, created.id)).map(([type]) => type)).toEqual(["created", "root_cause_set", "resolved"]);
}

/** A planned ticket — no alarm — resolves with no findings, and is stamped the same way. */
export async function assertAPlannedTicketResolvesWithoutFindings(ctx: FindingsFixtures): Promise<void> {
  const created = await planned(ctx);
  const resolved = await ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  expect([resolved.status, resolved.causeCode]).toEqual(["resolved", null]);
  expect((await rowOf(ctx.fleetPool, created.id)).resolved_by).toBe(ctx.actorUserId);
}

/** `resolved` back to `in_progress` clears both resolve stamps and restarts the SLA clock; the findings stay (ruling P3). */
export async function assertGoingBackToWorkClearsTheResolveStamps(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);
  const resolved = await ctx.svc.updateStatus(created.id, { status: "resolved", ...FULL }, ctx.actor, null);
  expect(resolved.slaState).toBe("met");

  const back = await ctx.svc.updateStatus(created.id, { status: "in_progress", reason: "Fault came back" }, ctx.actor, null);
  expect([back.status, back.resolvedAt, back.slaState]).toEqual(["in_progress", null, "on_track"]);
  const row = await rowOf(ctx.fleetPool, created.id);
  expect([row.resolved_at, row.resolved_by, row.root_cause, row.cause_code]).toEqual([null, null, FULL.rootCause, FULL.causeCode]);
  expect((await ctx.svc.getDetail(created.id, null)).resolvedBy).toBeNull();
}

/** `resolved` to `open` or `assigned` answers 409 on the status route and on a reorder, and changes nothing. */
export async function assertAResolvedTicketGoesBackToInProgressOnly(ctx: FindingsFixtures): Promise<void> {
  const created = await planned(ctx);
  await ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  const before = await rowOf(ctx.fleetPool, created.id);

  for (const status of ["open", "assigned"] as const) {
    const byStatus = ctx.svc.updateStatus(created.id, { status }, ctx.actor, null);
    await expect(byStatus, `status -> ${status}`).rejects.toBeInstanceOf(ConflictException);
    await expect(byStatus).rejects.toThrow(WORK_ORDER_LEAVE_RESOLVED_REFUSAL);
    await expect(
      ctx.svc.reorder({ items: [{ id: created.id, status, sortOrder: 0 }] }, ctx.actor, null),
      `reorder -> ${status}`,
    ).rejects.toBeInstanceOf(ConflictException);
  }
  const after = await rowOf(ctx.fleetPool, created.id);
  expect([after.status, after.resolved_by, after.resolved_at?.toISOString()]).toEqual(["resolved", before.resolved_by, before.resolved_at?.toISOString()]);
}

/** A drag from `resolved` back to In progress clears the resolve stamps, as the status route does. */
export async function assertAReorderBackToWorkClearsTheResolveStamps(ctx: FindingsFixtures): Promise<void> {
  const created = await planned(ctx);
  await ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  await ctx.svc.reorder({ items: [{ id: created.id, status: "in_progress", sortOrder: 2 }] }, ctx.actor, null);
  const row = await rowOf(ctx.fleetPool, created.id);
  expect([row.status, row.resolved_at, row.resolved_by]).toEqual(["in_progress", null, null]);
}

/** The root-cause route replaces the findings, answers the detail, and writes one event with the coded cause and one audit row with no typed text. */
export async function assertTheRootCauseRouteReplacesTheFindings(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);
  const detail = await ctx.findings.putRootCause(created.id, { ...FULL, preventiveAction: "Inspect quarterly" }, ctx.actor, [ctx.assetId]);
  expect(workOrderDetailSchema.safeParse(detail).success, "the answer matches the detail contract").toBe(true);
  expect([detail.rootCause, detail.correctiveAction, detail.preventiveAction, detail.causeCode]).toEqual([
    FULL.rootCause,
    FULL.correctiveAction,
    "Inspect quarterly",
    FULL.causeCode,
  ]);

  // Replaced whole: `preventiveAction` left out is cleared.
  const replaced = await ctx.findings.putRootCause(created.id, { ...FULL, causeCode: "equipment_failure" }, ctx.actor, null);
  expect([replaced.preventiveAction, replaced.causeCode]).toEqual([null, "equipment_failure"]);

  expect(await eventsOf(ctx.fleetPool, created.id)).toEqual([
    ["created", { origin: "alarm" }],
    ["root_cause_set", { causeCode: "wear_and_tear" }],
    ["root_cause_set", { causeCode: "equipment_failure" }],
  ]);
  const { rows } = await ctx.fleetPool.query<{ payload: Record<string, unknown>; text: string }>(
    "SELECT payload, payload::text AS text FROM bms.audit_log WHERE action = 'work_order_root_cause_set' AND entity_id = $1 ORDER BY created_at, id",
    [created.id],
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]?.payload).toMatchObject({
    reference: created.reference,
    causeCode: "wear_and_tear",
    hasRootCause: true,
    hasCorrectiveAction: true,
    hasPreventiveAction: true,
  });
  expect(rows[1]?.payload).toMatchObject({ causeCode: "equipment_failure", hasPreventiveAction: false });
  expect(rows.some((row) => row.text.includes(FULL.rootCause) || row.text.includes("Inspect quarterly"))).toBe(false);
}

/** A root-cause write that changes nothing writes no audit row and no event. */
export async function assertAnUnchangedRootCauseWritesNothing(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);
  await ctx.findings.putRootCause(created.id, FULL, ctx.actor, null);
  await ctx.findings.putRootCause(created.id, { ...FULL, preventiveAction: null }, ctx.actor, null);
  expect((await eventsOf(ctx.fleetPool, created.id)).map(([type]) => type)).toEqual(["created", "root_cause_set"]);
  const audits = await ctx.fleetPool.query("SELECT 1 FROM bms.audit_log WHERE action = 'work_order_root_cause_set' AND entity_id = $1", [created.id]);
  expect(audits.rows).toHaveLength(1);
}

/** Findings may be cleared before `resolved`; a resolved alarm ticket must keep them (409); a closed ticket is frozen (409). */
export async function assertFindingsAreKeptWhileResolvedAndFrozenAtClosed(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);
  await ctx.findings.putRootCause(created.id, FULL, ctx.actor, null);
  const cleared = await ctx.findings.putRootCause(created.id, { rootCause: null, correctiveAction: null, causeCode: null }, ctx.actor, null);
  expect([cleared.rootCause, cleared.causeCode], "cleared while the ticket is still open").toEqual([null, null]);

  await ctx.svc.updateStatus(created.id, { status: "resolved", ...FULL }, ctx.actor, null);
  const blank = ctx.findings.putRootCause(created.id, { ...FULL, causeCode: null }, ctx.actor, null);
  await expect(blank).rejects.toBeInstanceOf(ConflictException);
  await expect(blank).rejects.toThrow(WORK_ORDER_FINDINGS_KEPT_REFUSAL);
  // Still editable while resolved (decision 5.3).
  const edited = await ctx.findings.putRootCause(created.id, { ...FULL, rootCause: "Contacts pitted by arcing" }, ctx.actor, null);
  expect(edited.rootCause).toBe("Contacts pitted by arcing");

  // Set straight in the table: `closed` and `cancelled` are reached only through the approval
  // service (`work-orders.approval.integration.spec.ts`), and this suite is about the freeze.
  for (const terminal of ["closed", "cancelled"]) {
    await ctx.fleetPool.query("UPDATE bms.work_orders SET status = $2 WHERE id = $1", [created.id, terminal]);
    const frozen = ctx.findings.putRootCause(created.id, FULL, ctx.actor, null);
    await expect(frozen, terminal).rejects.toBeInstanceOf(ConflictException);
    await expect(frozen, terminal).rejects.toThrow(WORK_ORDER_FINDINGS_FROZEN_REFUSAL);
  }
  expect((await rowOf(ctx.fleetPool, created.id)).root_cause).toBe("Contacts pitted by arcing");
}

/** An unknown or retired cause code answers 400 on both routes; a code the ticket already carries may stay after it is retired. */
export async function assertAnUnknownOrRetiredCauseCodeIsRefused(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);
  for (const causeCode of ["no_such_code", ctx.retiredCauseCode]) {
    const byStatus = ctx.svc.updateStatus(created.id, { status: "resolved", ...FULL, causeCode }, ctx.actor, null);
    await expect(byStatus, `status with ${causeCode}`).rejects.toBeInstanceOf(BadRequestException);
    await expect(byStatus).rejects.toThrow(CAUSE_CODE_REFUSAL);
    await expect(ctx.findings.putRootCause(created.id, { ...FULL, causeCode }, ctx.actor, null), `PUT with ${causeCode}`).rejects.toThrow(
      CAUSE_CODE_REFUSAL,
    );
  }
  expect((await rowOf(ctx.fleetPool, created.id)).cause_code).toBeNull();

  await ctx.findings.putRootCause(created.id, { ...FULL, causeCode: ctx.ownCauseCode }, ctx.actor, null);
  await ctx.fleetPool.query("UPDATE bms.work_order_cause_codes SET active = false WHERE code = $1", [ctx.ownCauseCode]);
  const kept = await ctx.findings.putRootCause(created.id, { ...FULL, rootCause: "Edited after the code retired", causeCode: ctx.ownCauseCode }, ctx.actor, null);
  expect(kept.causeCode, "the ticket keeps a code it already had").toBe(ctx.ownCauseCode);
  // The status route holds the same rule: the ticket's own retired code may ride a status write.
  const resolved = await ctx.svc.updateStatus(created.id, { status: "resolved", causeCode: ctx.ownCauseCode }, ctx.actor, null);
  expect([resolved.status, resolved.causeCode]).toEqual(["resolved", ctx.ownCauseCode]);
  const other = await fromAlarm(ctx);
  await expect(ctx.findings.putRootCause(other.id, { ...FULL, causeCode: ctx.ownCauseCode }, ctx.actor, null)).rejects.toThrow(CAUSE_CODE_REFUSAL);
  await expect(ctx.svc.updateStatus(other.id, { status: "resolved", ...FULL, causeCode: ctx.ownCauseCode }, ctx.actor, null)).rejects.toThrow(
    CAUSE_CODE_REFUSAL,
  );
}

/** A ticket outside the caller's asset scope answers 404 for a root-cause write. */
export async function assertARootCauseWriteOutsideTheScopeIsNotFound(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);
  for (const scope of [[ctx.otherAssetId], []]) {
    await expect(ctx.findings.putRootCause(created.id, FULL, ctx.actor, scope)).rejects.toBeInstanceOf(NotFoundException);
  }
  expect((await rowOf(ctx.fleetPool, created.id)).root_cause).toBeNull();
}

/** When the audit write throws, the findings and their event do not exist. */
export async function assertAFailedAuditLeavesNoFindings(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);
  await expect(ctx.findingsWithFailingAudit.putRootCause(created.id, FULL, ctx.actor, null)).rejects.toThrow("audit is down");
  const row = await rowOf(ctx.fleetPool, created.id);
  expect([row.root_cause, row.corrective_action, row.cause_code]).toEqual([null, null, null]);
  expect((await eventsOf(ctx.fleetPool, created.id)).map(([type]) => type)).toEqual(["created"]);
}

/** The cause-code list holds the nine seeded codes in order and no retired code. */
export async function assertTheCauseCodeListIsTheActiveVocabulary(ctx: FindingsFixtures): Promise<void> {
  const { items } = await ctx.findings.listCauseCodes();
  const codes = items.map((item) => item.code);
  // Other suites may add their own codes; the nine keep their order among them.
  expect(codes.filter((code) => SEEDED_CODES.includes(code))).toEqual(SEEDED_CODES);
  expect(codes, "a retired code is not offered").not.toContain(ctx.retiredCauseCode);
  expect(items.find((item) => item.code === "wear_and_tear")).toEqual({ code: "wear_and_tear", label: "Wear and tear", sortOrder: 20 });
}

/** The tenant role may read the vocabulary and may not write it: `42501` for each of the three verbs. */
export async function assertTheTenantRoleCannotWriteCauseCodes(ctx: FindingsFixtures): Promise<void> {
  const read = await ctx.tenantPool.query("SELECT code FROM bms.work_order_cause_codes WHERE code = 'other'");
  expect(read.rows).toHaveLength(1);
  // Every attempt names a row of this run's own, never a seeded code: if the REVOKE were
  // ever missing, a write that got through must not damage the shared vocabulary, and
  // the suite's own cleanup must be able to remove what it left.
  const attempts: Array<[string, string, unknown[]]> = [
    ["INSERT", "INSERT INTO bms.work_order_cause_codes (code, label) VALUES ($1, 'Planted')", [`${ctx.retiredCauseCode}x`]],
    ["UPDATE", "UPDATE bms.work_order_cause_codes SET label = 'Changed' WHERE code = $1", [ctx.retiredCauseCode]],
    ["DELETE", "DELETE FROM bms.work_order_cause_codes WHERE code = $1", [`${ctx.retiredCauseCode}x`]],
  ];
  for (const [verb, statement, params] of attempts) {
    const code = await ctx.tenantPool.query(statement, params).then(
      () => undefined,
      (err: { code?: string }) => err.code,
    );
    expect(code, verb).toBe("42501");
  }
}

/** The status column is a closed vocabulary in the database: an unknown value is a check violation, `cancelled` is not. */
export async function assertTheStatusCheckIsTheSixValues(ctx: FindingsFixtures): Promise<void> {
  const created = await planned(ctx);
  const attempt = (status: string): Promise<string | undefined> =>
    ctx.fleetPool.query("UPDATE bms.work_orders SET status = $2 WHERE id = $1", [created.id, status]).then(
      () => undefined,
      (err: { code?: string }) => err.code,
    );
  expect(await attempt("done")).toBe("23514");
  expect(await attempt("cancelled"), "the sixth value is in the CHECK, ready for its writer").toBeUndefined();
  await ctx.fleetPool.query("UPDATE bms.work_orders SET status = 'open' WHERE id = $1", [created.id]);
}

/** The list item carries `causeCode` and a null `approvedAt`, and matches its contract. */
export async function assertTheListItemCarriesTheCauseCode(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);
  await ctx.findings.putRootCause(created.id, FULL, ctx.actor, null);
  const { items } = await ctx.svc.list({ limit: 100, assetIds: [ctx.assetId] });
  const item = items.find((candidate) => candidate.id === created.id);
  expect([item?.causeCode, item?.approvedAt]).toEqual(["wear_and_tear", null]);
  expect(workOrderListItemSchema.safeParse(item).success).toBe(true);
}

/**
 * The status route holds the same rule as the root-cause route: a blank finding sent
 * with a status write cannot overwrite what a resolved alarm ticket resolved with, by a
 * no-op move. (The body schema refuses a blank first; this is
 * the service's own line.)
 */
export async function assertAStatusWriteCannotBlankAResolvedTicketsFindings(ctx: FindingsFixtures): Promise<void> {
  const created = await fromAlarm(ctx);
  await ctx.svc.updateStatus(created.id, { status: "resolved", ...FULL }, ctx.actor, null);

  const attempt = ctx.svc.updateStatus(created.id, { status: "resolved", rootCause: "   ", correctiveAction: "   " }, ctx.actor, null);
  await expect(attempt).rejects.toBeInstanceOf(ConflictException);
  await expect(attempt).rejects.toThrow(WORK_ORDER_FINDINGS_KEPT_REFUSAL);
  const row = await rowOf(ctx.fleetPool, created.id);
  expect([row.status, row.root_cause, row.corrective_action]).toEqual(["resolved", FULL.rootCause, FULL.correctiveAction]);

  // A real edit through the status route is still allowed while resolved (decision 5.3).
  await ctx.svc.updateStatus(created.id, { status: "resolved", rootCause: "Contacts pitted by arcing" }, ctx.actor, null);
  expect((await rowOf(ctx.fleetPool, created.id)).root_cause).toBe("Contacts pitted by arcing");
}
