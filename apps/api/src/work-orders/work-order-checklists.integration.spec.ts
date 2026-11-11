import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import { workOrderDetailSchema, workOrderListItemSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { WORK_ORDER_SLA_OVERRIDE_DENIAL } from "../auth/operations-write";
import type { MaintenanceService } from "../maintenance/maintenance.service";
import { CHECKLIST_TEMPLATE_REFUSAL } from "./work-order-checklist";
import type { WorkOrderTaskAddService } from "./work-order-task-add.service";
import type { WorkOrderTasksService } from "./work-order-tasks.service";
import {
  WORK_ORDER_MANDATORY_PENDING_REFUSAL,
  WORK_ORDER_RESOLVE_BY_DRAG_REFUSAL,
  WORK_ORDER_MAX_TASKS,
  WORK_ORDER_TASKS_FROZEN_REFUSAL,
  WORK_ORDER_TASKS_FULL_REFUSAL,
} from "./work-order-transitions";
import type { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.1` (ADR 0122 decision 4; plan T3.2 and the operator half of T3.3) — checklists
 * against real `bms_tenant` and `bms_fleet` roles: the copy at create and at convert,
 * the task writes, the resolve gate, the reorder refusal, the re-created
 * `work_order_tasks` policy (ruling P9) and the template list an operator may read
 * (ruling P6). Assertions live here; `work-order-checklists.integration.test.ts` owns
 * the database lifecycle (ADR 0014).
 */
type Actor = Pick<JwtPayload, "sub" | "email">;

export type ChecklistFixtures = {
  svc: WorkOrdersService;
  tasks: WorkOrderTasksService;
  taskAdd: WorkOrderTaskAddService;
  /** The same two checklist services with an audit writer that throws, for the atomicity proof. */
  tasksWithFailingAudit: WorkOrderTasksService;
  taskAddWithFailingAudit: WorkOrderTaskAddService;
  maintenance: MaintenanceService;
  access: AccessControlService;
  /** A user this run created whose `bms.users` role is `operator`. */
  operatorUserId: string;
  operatorEmail: string;
  tenantPool: pg.Pool;
  fleetPool: pg.Pool;
  /** An `organization_admin` of the organization, and that user's row id. */
  actor: Actor;
  actorUserId: string;
  organizationId: string;
  foreignOrgId: string;
  /** An `electrical` asset of the organization. */
  assetId: string;
  /** A second asset of the same organization, for the scope checks. */
  otherAssetId: string;
  /** The run's name prefix: every template this suite makes carries it, so the cleanup finds it. */
  prefix: string;
  /** For every domain, active: "Isolate" (mandatory), "Photograph" (optional), "Test" (mandatory). */
  templateId: string;
  /** For `electrical` only, active, one optional item. */
  electricalTemplateId: string;
  /** For `hvac` only, active: not for an electrical asset. */
  hvacTemplateId: string;
  /** For every domain, retired (`active = false`). */
  retiredTemplateId: string;
  /** For every domain, active, in ANOTHER organization. */
  foreignTemplateId: string;
};

type TaskRow = {
  id: string;
  title: string;
  mandatory: boolean;
  result: string;
  note: string | null;
  sort_order: number;
  completed_at: Date | null;
  completed_by: string | null;
  template_item_id: string | null;
};

const TITLE = "E3.1 checklist fixture";

async function tasksOf(pool: pg.Pool, workOrderId: string): Promise<TaskRow[]> {
  const { rows } = await pool.query<TaskRow>(
    `SELECT id, title, mandatory, result, note, sort_order, completed_at, completed_by, template_item_id
       FROM bms.work_order_tasks WHERE work_order_id = $1 ORDER BY sort_order, created_at, id`,
    [workOrderId],
  );
  return rows;
}

async function taskEventsOf(pool: pg.Pool, workOrderId: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pool.query<{ detail: Record<string, unknown> }>(
    `SELECT detail FROM bms.work_order_events
      WHERE work_order_id = $1 AND event_type = 'task_updated' ORDER BY created_at, id`,
    [workOrderId],
  );
  return rows.map((row) => row.detail);
}

async function statusOf(pool: pg.Pool, workOrderId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ status: string }>("SELECT status FROM bms.work_orders WHERE id = $1", [workOrderId]);
  return rows[0]?.status;
}

/** One template with its items, written on the fleet connection. The name carries the run's prefix. */
export async function makeTemplate(
  pool: pg.Pool,
  input: { organizationId: string; name: string; domain: string | null; active?: boolean; items: Array<[title: string, mandatory: boolean]> },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.work_order_checklist_templates (organization_id, name, domain, active)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.organizationId, input.name, input.domain, input.active ?? true],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("E3.1: the fixture template was not created");
  for (const [index, [title, mandatory]] of input.items.entries()) {
    await pool.query(
      `INSERT INTO bms.work_order_checklist_template_items (organization_id, template_id, title, mandatory, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.organizationId, id, title, mandatory, (index + 1) * 10],
    );
  }
  return id;
}

const withChecklist = (ctx: ChecklistFixtures) =>
  ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "medium", checklistTemplateId: ctx.templateId }, ctx.actor, null);

/** Create with a template copies its items in order, with `mandatory` and where each came from. */
export async function assertCreateCopiesTheTemplateInOrder(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const rows = await tasksOf(ctx.fleetPool, created.id);
  expect(rows.map((row) => [row.title, row.mandatory, row.result, row.sort_order])).toEqual([
    ["Isolate", true, "pending", 1],
    ["Photograph", false, "pending", 2],
    ["Test", true, "pending", 3],
  ]);
  const items = await ctx.fleetPool.query<{ id: string }>(
    "SELECT id FROM bms.work_order_checklist_template_items WHERE template_id = $1 ORDER BY sort_order",
    [ctx.templateId],
  );
  expect(rows.map((row) => row.template_item_id)).toEqual(items.rows.map((row) => row.id));
  expect([created.checklistDone, created.checklistTotal]).toEqual([0, 3]);
  expect(await taskEventsOf(ctx.fleetPool, created.id), "the copy is the ticket's starting state, not a change").toEqual([]);
}

/** The create audit row names the template and how many items were copied. */
export async function assertTheCreateAuditRowNamesTheTemplate(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const { rows } = await ctx.fleetPool.query<{ payload: Record<string, unknown> }>(
    "SELECT payload FROM bms.audit_log WHERE action = 'work_order_create' AND entity_id = $1",
    [created.id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.payload.checklistTemplateId).toBe(ctx.templateId);
  expect(rows[0]?.payload.checklistItems).toBe(3);
}

/** A ticket created with no template has no checklist. */
export async function assertCreateWithoutATemplateHasNoChecklist(ctx: ChecklistFixtures): Promise<void> {
  const created = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);
  expect(await tasksOf(ctx.fleetPool, created.id)).toEqual([]);
  expect([created.checklistDone, created.checklistTotal]).toEqual([0, 0]);
}

/** Editing the template afterwards — its items replaced, as the admin route does — leaves the ticket's tasks as they were. */
export async function assertATemplateEditLeavesTheTicketUnchanged(ctx: ChecklistFixtures): Promise<void> {
  const templateId = await makeTemplate(ctx.fleetPool, {
    organizationId: ctx.organizationId,
    name: `${ctx.prefix}frozen snapshot`,
    domain: null,
    items: [
      ["Before one", true],
      ["Before two", false],
    ],
  });
  const created = await ctx.svc.create(
    { assetId: ctx.assetId, title: TITLE, priority: "medium", checklistTemplateId: templateId },
    ctx.actor,
    null,
  );
  const before = await tasksOf(ctx.fleetPool, created.id);
  expect(before.every((row) => row.template_item_id !== null)).toBe(true);

  // As the tenant role, under the organization's own setting: the delete must pass the
  // policy and the foreign key must still be able to clear the tasks' pointer.
  const client = await ctx.tenantPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organization', $1, true)", [ctx.organizationId]);
    await client.query("DELETE FROM bms.work_order_checklist_template_items WHERE template_id = $1", [templateId]);
    await client.query(
      `INSERT INTO bms.work_order_checklist_template_items (organization_id, template_id, title, mandatory, sort_order)
       VALUES ($1, $2, 'After only', true, 1)`,
      [ctx.organizationId, templateId],
    );
    await client.query("UPDATE bms.work_order_checklist_templates SET name = $2 WHERE id = $1", [
      templateId,
      `${ctx.prefix}frozen snapshot, renamed`,
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const after = await tasksOf(ctx.fleetPool, created.id);
  expect(after.map((row) => [row.id, row.title, row.mandatory])).toEqual(before.map((row) => [row.id, row.title, row.mandatory]));
  expect(after.map((row) => row.template_item_id), "the pointer to a replaced item is cleared, the task stays").toEqual([null, null]);
}

/** A template of another organization, a retired one, one for another domain and an unknown id are each refused with the same sentence, and no ticket is created. */
export async function assertAnUnusableTemplateIsRefusedWithOneSentence(ctx: ChecklistFixtures): Promise<void> {
  const count = async (): Promise<string | undefined> =>
    (await ctx.fleetPool.query<{ n: string }>("SELECT count(*)::text AS n FROM bms.work_orders WHERE asset_id = $1", [ctx.assetId]))
      .rows[0]?.n;
  const before = await count();
  const cases: Array<[label: string, templateId: string]> = [
    ["another organization's", ctx.foreignTemplateId],
    ["a retired", ctx.retiredTemplateId],
    ["another domain's", ctx.hvacTemplateId],
    ["an unknown", "99999999-9999-4999-8999-999999999999"],
  ];
  for (const [label, checklistTemplateId] of cases) {
    const attempt = ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "medium", checklistTemplateId }, ctx.actor, null);
    await expect(attempt, `${label} template`).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt, `${label} template`).rejects.toThrow(CHECKLIST_TEMPLATE_REFUSAL);
  }
  expect(await count(), "a refused create leaves no ticket").toBe(before);

  const fits = await ctx.svc.create(
    { assetId: ctx.assetId, title: TITLE, priority: "medium", checklistTemplateId: ctx.electricalTemplateId },
    ctx.actor,
    null,
  );
  expect(fits.checklistTotal, "a template for the asset's own domain is accepted").toBe(1);
}

/** Marking an item done stamps when and who; back to pending clears both. */
export async function assertATaskResultStampsAndClears(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const [first] = await tasksOf(ctx.fleetPool, created.id);
  if (!first) throw new Error("no task");

  const done = await ctx.tasks.updateTask(created.id, first.id, { result: "done" }, ctx.actor, null);
  expect(done.result).toBe("done");
  expect(done.completedBy).toBe(ctx.actorUserId);
  expect(done.completedAt).not.toBeNull();

  const reopened = await ctx.tasks.updateTask(created.id, first.id, { result: "pending" }, ctx.actor, null);
  expect([reopened.result, reopened.completedAt, reopened.completedBy]).toEqual(["pending", null, null]);
  const [row] = await tasksOf(ctx.fleetPool, created.id);
  expect([row?.result, row?.completed_at, row?.completed_by]).toEqual(["pending", null, null]);
}

/** `not_applicable` is a decision too: it stamps like `done`, and a note-only write moves no stamp. */
export async function assertNotApplicableStampsAndANoteAloneDoesNot(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const [first, second] = await tasksOf(ctx.fleetPool, created.id);
  if (!first || !second) throw new Error("no task");

  const skipped = await ctx.tasks.updateTask(created.id, first.id, { result: "not_applicable", note: "No isolator here" }, ctx.actor, null);
  expect([skipped.result, skipped.note, skipped.completedBy]).toEqual(["not_applicable", "No isolator here", ctx.actorUserId]);

  const noted = await ctx.tasks.updateTask(created.id, second.id, { note: "Camera left on site" }, ctx.actor, null);
  expect([noted.result, noted.note, noted.completedAt, noted.completedBy]).toEqual(["pending", "Camera left on site", null, null]);

  const cleared = await ctx.tasks.updateTask(created.id, second.id, { note: null }, ctx.actor, null);
  expect(cleared.note).toBeNull();

  // A note-only write is audited and is not a timeline event: only the result change is.
  expect(await taskEventsOf(ctx.fleetPool, created.id)).toEqual([{ taskId: first.id, result: "not_applicable" }]);
  const audits = await ctx.fleetPool.query<{ payload: { noteChanged: boolean; toResult: string } }>(
    "SELECT payload FROM bms.audit_log WHERE action = 'work_order_task_update' AND entity_id = $1 ORDER BY created_at, id",
    [created.id],
  );
  expect(audits.rows.map((row) => [row.payload.toResult, row.payload.noteChanged])).toEqual([
    ["not_applicable", true],
    ["pending", true],
    ["pending", true],
  ]);
}

/** An id typed in upper case is the same item and the same asset: the event stores the database's spelling. */
export async function assertUpperCaseIdsAreTheSameRows(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const [first] = await tasksOf(ctx.fleetPool, created.id);
  if (!first) throw new Error("no task");
  await ctx.tasks.updateTask(created.id.toUpperCase(), first.id.toUpperCase(), { result: "done" }, ctx.actor, [ctx.assetId]);
  expect(await taskEventsOf(ctx.fleetPool, created.id)).toEqual([{ taskId: first.id, result: "done" }]);

  const { items } = await ctx.tasks.listTemplatesForAsset(ctx.assetId.toUpperCase(), [ctx.assetId]);
  expect(items.map((item) => item.id)).toContain(ctx.templateId);
}

/** Each task change writes one `task_updated` event that names the item and its result and holds no note text. */
export async function assertATaskChangeWritesAnEventWithNoNoteText(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const [first] = await tasksOf(ctx.fleetPool, created.id);
  if (!first) throw new Error("no task");
  const note = "E31-secret-note-text";

  await ctx.tasks.updateTask(created.id, first.id, { result: "done", note }, ctx.actor, null);
  await ctx.tasks.updateTask(created.id, first.id, { result: "pending" }, ctx.actor, null);
  expect(await taskEventsOf(ctx.fleetPool, created.id)).toEqual([
    { taskId: first.id, result: "done" },
    { taskId: first.id, result: "pending" },
  ]);

  const events = await ctx.fleetPool.query<{ text: string }>(
    "SELECT detail::text || coalesce(actor_name, '') AS text FROM bms.work_order_events WHERE work_order_id = $1",
    [created.id],
  );
  expect(events.rows.some((row) => row.text.includes(note)), "the note is not on the timeline").toBe(false);
}

/** The task audit rows name the ticket and the item and say only that the note changed, never what it says. */
export async function assertTheTaskAuditRowHoldsNoNoteText(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const [first] = await tasksOf(ctx.fleetPool, created.id);
  if (!first) throw new Error("no task");
  const note = "E31-secret-audit-note";
  await ctx.tasks.updateTask(created.id, first.id, { result: "done", note }, ctx.actor, null);

  const { rows } = await ctx.fleetPool.query<{ payload: Record<string, unknown>; text: string }>(
    "SELECT payload, payload::text || coalesce(reason, '') AS text FROM bms.audit_log WHERE action = 'work_order_task_update' AND entity_id = $1",
    [created.id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.payload).toMatchObject({
    reference: created.reference,
    taskId: first.id,
    fromResult: "pending",
    toResult: "done",
    noteChanged: true,
  });
  expect(rows[0]?.text.includes(note), "the note text is not in the audit row").toBe(false);
}

/** A write that changes nothing writes no event and no audit row. */
export async function assertAnUnchangedTaskWritesNothing(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const [first] = await tasksOf(ctx.fleetPool, created.id);
  if (!first) throw new Error("no task");
  const same = await ctx.tasks.updateTask(created.id, first.id, { result: "pending", note: null }, ctx.actor, null);
  expect(same.result).toBe("pending");
  expect(await taskEventsOf(ctx.fleetPool, created.id)).toEqual([]);
  const audits = await ctx.fleetPool.query("SELECT 1 FROM bms.audit_log WHERE action = 'work_order_task_update' AND entity_id = $1", [created.id]);
  expect(audits.rows).toHaveLength(0);
}

/** An item added by hand goes last, keeps its `mandatory` flag and writes an event. */
export async function assertAnItemAddedByHandGoesLast(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const added = await ctx.taskAdd.addTask(created.id, { title: "Tighten the lugs", mandatory: true }, ctx.actor, null);
  expect([added.title, added.mandatory, added.result, added.sortOrder, added.templateItemId]).toEqual(["Tighten the lugs", true, "pending", 4, null]);
  expect((await tasksOf(ctx.fleetPool, created.id)).map((row) => row.title)).toEqual(["Isolate", "Photograph", "Test", "Tighten the lugs"]);
  expect(await taskEventsOf(ctx.fleetPool, created.id)).toEqual([{ taskId: added.id, result: "pending" }]);

  const bare = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);
  const firstEver = await ctx.taskAdd.addTask(bare.id, { title: "Walk the route", mandatory: false }, ctx.actor, null);
  expect(firstEver.sortOrder, "the first item of an empty checklist is number 1").toBe(1);
}

/** A task id of another work order answers 404 and changes neither ticket. */
export async function assertATaskOfAnotherWorkOrderIsNotFound(ctx: ChecklistFixtures): Promise<void> {
  const mine = await withChecklist(ctx);
  const other = await withChecklist(ctx);
  const [othersTask] = await tasksOf(ctx.fleetPool, other.id);
  if (!othersTask) throw new Error("no task");

  await expect(ctx.tasks.updateTask(mine.id, othersTask.id, { result: "done" }, ctx.actor, null)).rejects.toBeInstanceOf(NotFoundException);
  const [unchanged] = await tasksOf(ctx.fleetPool, other.id);
  expect(unchanged?.result, "the other ticket's item was not written").toBe("pending");
}

/** A ticket outside the caller's asset scope answers 404 for a task write, like one that does not exist. */
export async function assertATaskWriteOutsideTheScopeIsNotFound(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const [first] = await tasksOf(ctx.fleetPool, created.id);
  if (!first) throw new Error("no task");
  for (const scope of [[ctx.otherAssetId], []]) {
    await expect(ctx.tasks.updateTask(created.id, first.id, { result: "done" }, ctx.actor, scope)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.taskAdd.addTask(created.id, { title: "Out of scope", mandatory: false }, ctx.actor, scope)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  }
  expect((await tasksOf(ctx.fleetPool, created.id)).map((row) => row.result)).toEqual(["pending", "pending", "pending"]);
}

/** When the audit write throws, the task change and its event do not exist. */
export async function assertAFailedAuditLeavesNoTaskChange(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const [first] = await tasksOf(ctx.fleetPool, created.id);
  if (!first) throw new Error("no task");

  await expect(ctx.tasksWithFailingAudit.updateTask(created.id, first.id, { result: "done" }, ctx.actor, null)).rejects.toThrow("audit is down");
  await expect(ctx.taskAddWithFailingAudit.addTask(created.id, { title: "Never stored", mandatory: false }, ctx.actor, null)).rejects.toThrow(
    "audit is down",
  );
  const rows = await tasksOf(ctx.fleetPool, created.id);
  expect(rows.map((row) => [row.title, row.result])).toEqual([
    ["Isolate", "pending"],
    ["Photograph", "pending"],
    ["Test", "pending"],
  ]);
  expect(await taskEventsOf(ctx.fleetPool, created.id)).toEqual([]);
}

/** Under organization B's setting the tenant role cannot see A's tasks and cannot file a task against A's work order (ruling P9). */
export async function assertAForeignSettingCannotReadOrFileATask(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);

  const attempt = async (organizationColumn: string): Promise<string | undefined> => {
    const client = await ctx.tenantPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_organization', $1, true)", [ctx.foreignOrgId]);
      await client.query("INSERT INTO bms.work_order_tasks (organization_id, work_order_id, title) VALUES ($1, $2, 'Planted')", [
        organizationColumn,
        created.id,
      ]);
      return undefined;
    } catch (err) {
      return (err as { code?: string }).code;
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  };
  // The row names B, the setting is B, the work order is A's: only the policy's parent
  // check refuses this one. 0047's policy, which read the row's own column, let it in.
  expect(await attempt(ctx.foreignOrgId), "B's row against A's work order").toBe("42501");
  expect(await attempt(ctx.organizationId), "A's row under B's setting").toBe("42501");

  const client = await ctx.tenantPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organization', $1, true)", [ctx.foreignOrgId]);
    const seen = await client.query("SELECT 1 FROM bms.work_order_tasks WHERE work_order_id = $1", [created.id]);
    expect(seen.rows, "B reads none of A's tasks").toHaveLength(0);
    const written = await client.query("UPDATE bms.work_order_tasks SET result = 'done' WHERE work_order_id = $1", [created.id]);
    expect(written.rowCount, "B updates none of A's tasks").toBe(0);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  expect((await tasksOf(ctx.fleetPool, created.id)).map((row) => row.title)).toEqual(["Isolate", "Photograph", "Test"]);
}

/** The policy does not bind `bms_fleet`; the composite foreign key refuses the same cross-organization task there. */
export async function assertTheFleetRoleCannotFileACrossOrganizationTask(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const code = await ctx.fleetPool
    .query("INSERT INTO bms.work_order_tasks (organization_id, work_order_id, title) VALUES ($1, $2, 'Planted')", [
      ctx.foreignOrgId,
      created.id,
    ])
    .then(
      () => undefined,
      (err: { code?: string }) => err.code,
    );
  expect(code, "a foreign-key violation").toBe("23503");
}

/** The result column is a closed vocabulary in the database too. */
export async function assertTheResultCheckRefusesAnUnknownValue(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const code = await ctx.fleetPool
    .query("UPDATE bms.work_order_tasks SET result = 'skipped' WHERE work_order_id = $1", [created.id])
    .then(
      () => undefined,
      (err: { code?: string }) => err.code,
    );
  expect(code, "a check violation").toBe("23514");
}

/** A mandatory item still pending blocks `resolved` with 409 and leaves the ticket where it was; `not_applicable` and `done` let it pass. */
export async function assertAMandatoryItemBlocksResolveThenPasses(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  await ctx.svc.updateStatus(created.id, { status: "in_progress" }, ctx.actor, null);
  const [isolate, , test] = await tasksOf(ctx.fleetPool, created.id);
  if (!isolate || !test) throw new Error("no task");

  const blocked = ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  await expect(blocked).rejects.toBeInstanceOf(ConflictException);
  await expect(blocked).rejects.toThrow(WORK_ORDER_MANDATORY_PENDING_REFUSAL);
  expect(await statusOf(ctx.fleetPool, created.id)).toBe("in_progress");

  // One of the two mandatory items is still pending: still blocked.
  await ctx.tasks.updateTask(created.id, isolate.id, { result: "done" }, ctx.actor, null);
  await expect(ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null)).rejects.toBeInstanceOf(ConflictException);

  // `not_applicable` settles the other; the optional item stays pending and does not block.
  await ctx.tasks.updateTask(created.id, test.id, { result: "not_applicable" }, ctx.actor, null);
  const resolved = await ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  expect(resolved.status).toBe("resolved");
  expect([resolved.checklistDone, resolved.checklistTotal]).toEqual([2, 3]);
}

/** A blocked resolve writes no audit row and no status event. */
export async function assertABlockedResolveWritesNothing(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  await expect(ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null)).rejects.toBeInstanceOf(ConflictException);
  const audits = await ctx.fleetPool.query(
    "SELECT 1 FROM bms.audit_log WHERE action = 'work_order_status_update' AND entity_id = $1",
    [created.id],
  );
  expect(audits.rows).toHaveLength(0);
  const events = await ctx.fleetPool.query("SELECT event_type FROM bms.work_order_events WHERE work_order_id = $1", [created.id]);
  expect(events.rows.map((row: { event_type: string }) => row.event_type)).toEqual(["created"]);
}

/** A ticket with no checklist, or with optional items only, resolves as before. */
export async function assertATicketWithNoMandatoryItemResolves(ctx: ChecklistFixtures): Promise<void> {
  const bare = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);
  expect((await ctx.svc.updateStatus(bare.id, { status: "resolved" }, ctx.actor, null)).status).toBe("resolved");

  const optionalOnly = await ctx.svc.create(
    { assetId: ctx.assetId, title: TITLE, priority: "low", checklistTemplateId: ctx.electricalTemplateId },
    ctx.actor,
    null,
  );
  expect((await ctx.svc.updateStatus(optionalOnly.id, { status: "resolved" }, ctx.actor, null)).status).toBe("resolved");
}

/** Once a ticket is `resolved`, `closed` or `cancelled`, a checklist write answers 409 and changes nothing; back in progress it works again. */
export async function assertAResolvedOrClosedTicketFreezesItsChecklist(ctx: ChecklistFixtures): Promise<void> {
  const created = await ctx.svc.create(
    { assetId: ctx.assetId, title: TITLE, priority: "low", checklistTemplateId: ctx.electricalTemplateId },
    ctx.actor,
    null,
  );
  const [only] = await tasksOf(ctx.fleetPool, created.id);
  if (!only) throw new Error("no task");

  await ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  const frozenUpdate = ctx.tasks.updateTask(created.id, only.id, { result: "done" }, ctx.actor, null);
  await expect(frozenUpdate).rejects.toBeInstanceOf(ConflictException);
  await expect(frozenUpdate).rejects.toThrow(WORK_ORDER_TASKS_FROZEN_REFUSAL);
  await expect(ctx.taskAdd.addTask(created.id, { title: "Too late", mandatory: true }, ctx.actor, null)).rejects.toBeInstanceOf(ConflictException);

  await ctx.svc.updateStatus(created.id, { status: "in_progress" }, ctx.actor, null);
  expect((await ctx.tasks.updateTask(created.id, only.id, { result: "done" }, ctx.actor, null)).result).toBe("done");

  // Set straight in the table: `closed` and `cancelled` are reached only through the approval
  // service (`work-orders.approval.integration.spec.ts`), and this suite is about the freeze.
  for (const terminal of ["closed", "cancelled"]) {
    await ctx.fleetPool.query("UPDATE bms.work_orders SET status = $2 WHERE id = $1", [created.id, terminal]);
    const frozen = ctx.tasks.updateTask(created.id, only.id, { result: "pending" }, ctx.actor, null);
    await expect(frozen, terminal).rejects.toBeInstanceOf(ConflictException);
    await expect(frozen, terminal).rejects.toThrow(WORK_ORDER_TASKS_FROZEN_REFUSAL);
    await expect(ctx.taskAdd.addTask(created.id, { title: "Too late", mandatory: false }, ctx.actor, null), terminal).rejects.toBeInstanceOf(
      ConflictException,
    );
  }
  expect((await tasksOf(ctx.fleetPool, created.id)).map((row) => [row.title, row.result])).toEqual([[only.title, "done"]]);
}

/** A reorder that moves a card into `resolved` answers 400 with the route's sentence and writes nothing (ruling P1). */
export async function assertAReorderIntoResolvedIsRefusedAndWritesNothing(ctx: ChecklistFixtures): Promise<void> {
  const moved = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);
  const beside = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);

  const attempt = ctx.svc.reorder(
    {
      items: [
        { id: beside.id, status: "in_progress", sortOrder: 7 },
        { id: moved.id, status: "resolved", sortOrder: 9 },
      ],
    },
    ctx.actor,
    null,
  );
  await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
  await expect(attempt).rejects.toThrow(WORK_ORDER_RESOLVE_BY_DRAG_REFUSAL);

  const { rows } = await ctx.fleetPool.query<{ id: string; status: string; sort_order: number; resolved_at: Date | null }>(
    "SELECT id, status, sort_order, resolved_at FROM bms.work_orders WHERE id = ANY($1)",
    [[moved.id, beside.id]],
  );
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect([row.status, row.resolved_at], `ticket ${row.id === moved.id ? "moved" : "beside"} is untouched`).toEqual(["open", null]);
    expect(row.sort_order).toBe(row.id === moved.id ? moved.sortOrder : beside.sortOrder);
  }
  const events = await ctx.fleetPool.query<{ event_type: string }>(
    "SELECT event_type FROM bms.work_order_events WHERE work_order_id = ANY($1)",
    [[moved.id, beside.id]],
  );
  expect(events.rows.map((row) => row.event_type)).toEqual(["created", "created"]);
}

/** A card already in `resolved` may be re-ordered there and dragged back to work. */
export async function assertAResolvedCardMayStillBeReordered(ctx: ChecklistFixtures): Promise<void> {
  const created = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);
  await ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  const within = await ctx.svc.reorder({ items: [{ id: created.id, status: "resolved", sortOrder: 4 }] }, ctx.actor, null);
  expect([within.items[0]?.status, within.items[0]?.sortOrder]).toEqual(["resolved", 4]);
  const back = await ctx.svc.reorder({ items: [{ id: created.id, status: "in_progress", sortOrder: 1 }] }, ctx.actor, null);
  expect(back.items[0]?.status).toBe("in_progress");
}

/** The two counters are right for two tickets on one page, and the list item matches its contract. */
export async function assertTheCountersAreRightForTwoTicketsAtOnce(ctx: ChecklistFixtures): Promise<void> {
  const busy = await withChecklist(ctx);
  const bare = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);
  const [isolate, photograph] = await tasksOf(ctx.fleetPool, busy.id);
  if (!isolate || !photograph) throw new Error("no task");
  await ctx.tasks.updateTask(busy.id, isolate.id, { result: "done" }, ctx.actor, null);
  await ctx.tasks.updateTask(busy.id, photograph.id, { result: "not_applicable" }, ctx.actor, null);

  const { items } = await ctx.svc.list({ limit: 100, assetIds: [ctx.assetId] });
  const found = (id: string) => items.find((item) => item.id === id);
  expect([found(busy.id)?.checklistDone, found(busy.id)?.checklistTotal]).toEqual([2, 3]);
  expect([found(bare.id)?.checklistDone, found(bare.id)?.checklistTotal]).toEqual([0, 0]);
  expect(workOrderListItemSchema.safeParse(found(busy.id)).success).toBe(true);
}

/** The detail read carries the checklist in order and matches its contract; out of scope it is 404. */
export async function assertTheDetailCarriesTheChecklist(ctx: ChecklistFixtures): Promise<void> {
  const created = await withChecklist(ctx);
  const added = await ctx.taskAdd.addTask(created.id, { title: "Added by hand", mandatory: false }, ctx.actor, null);
  const detail = await ctx.svc.getDetail(created.id, [ctx.assetId]);
  expect(detail.tasks.map((task) => [task.title, task.mandatory, task.sortOrder])).toEqual([
    ["Isolate", true, 1],
    ["Photograph", false, 2],
    ["Test", true, 3],
    ["Added by hand", false, 4],
  ]);
  expect(detail.tasks[3]?.id).toBe(added.id);
  expect(workOrderDetailSchema.safeParse(detail).success).toBe(true);
  await expect(ctx.svc.getDetail(created.id, [ctx.otherAssetId])).rejects.toBeInstanceOf(NotFoundException);
}

const scheduleBody = (ctx: ChecklistFixtures, title: string) => ({
  assetId: ctx.assetId,
  title,
  category: "preventive" as const,
  generationMode: "calendar" as const,
  safetyCritical: false,
  priority: "medium" as const,
  estimatedMinutes: 60,
  intervalDays: 30,
  firstDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
});

/** Converting a schedule whose template names a checklist copies it onto the work order. */
export async function assertConvertCopiesTheSchedulesChecklist(ctx: ChecklistFixtures): Promise<void> {
  const schedule = await ctx.maintenance.createSchedule(
    { ...scheduleBody(ctx, "E3.1 schedule with a checklist"), checklistTemplateId: ctx.templateId },
    ctx.actor,
    null,
  );
  const { workOrder } = await ctx.maintenance.convertToWorkOrder(schedule.id, {}, ctx.actor, null);
  expect((await tasksOf(ctx.fleetPool, workOrder.id)).map((row) => [row.title, row.mandatory])).toEqual([
    ["Isolate", true],
    ["Photograph", false],
    ["Test", true],
  ]);
  expect([workOrder.checklistDone, workOrder.checklistTotal]).toEqual([0, 3]);
}

/** A schedule refuses a template its asset cannot use; a template retired later is skipped at convert, not refused. */
export async function assertAScheduleRefusesAnUnusableTemplateAndConvertSkipsARetiredOne(ctx: ChecklistFixtures): Promise<void> {
  for (const checklistTemplateId of [ctx.foreignTemplateId, ctx.retiredTemplateId, ctx.hvacTemplateId]) {
    const attempt = ctx.maintenance.createSchedule({ ...scheduleBody(ctx, "E3.1 refused schedule"), checklistTemplateId }, ctx.actor, null);
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(CHECKLIST_TEMPLATE_REFUSAL);
  }

  const templateId = await makeTemplate(ctx.fleetPool, {
    organizationId: ctx.organizationId,
    name: `${ctx.prefix}retired after the schedule`,
    domain: null,
    items: [["Lubricate", true]],
  });
  const schedule = await ctx.maintenance.createSchedule(
    { ...scheduleBody(ctx, "E3.1 schedule whose template retires"), checklistTemplateId: templateId },
    ctx.actor,
    null,
  );
  await ctx.fleetPool.query("UPDATE bms.work_order_checklist_templates SET active = false WHERE id = $1", [templateId]);
  const { workOrder } = await ctx.maintenance.convertToWorkOrder(schedule.id, {}, ctx.actor, null);
  expect(await tasksOf(ctx.fleetPool, workOrder.id), "the ticket is created with no checklist").toEqual([]);
}

/** A schedule's checklist template can be set, kept and cleared through the update. */
export async function assertAScheduleUpdateSetsKeepsAndClearsItsTemplate(ctx: ChecklistFixtures): Promise<void> {
  const schedule = await ctx.maintenance.createSchedule(scheduleBody(ctx, "E3.1 schedule, template set later"), ctx.actor, null);
  const stored = async (): Promise<string | null | undefined> =>
    (
      await ctx.fleetPool.query<{ checklist_template_id: string | null }>(
        "SELECT checklist_template_id FROM bms.maintenance_task_templates WHERE id = $1",
        [schedule.templateId],
      )
    ).rows[0]?.checklist_template_id;
  expect(await stored()).toBeNull();

  await ctx.maintenance.updateSchedule(schedule.id, { active: true, checklistTemplateId: ctx.templateId }, ctx.actor, null);
  expect(await stored()).toBe(ctx.templateId);
  await ctx.maintenance.updateSchedule(schedule.id, { active: true }, ctx.actor, null);
  expect(await stored(), "left out keeps it").toBe(ctx.templateId);
  await expect(
    ctx.maintenance.updateSchedule(schedule.id, { active: true, checklistTemplateId: ctx.hvacTemplateId }, ctx.actor, null),
  ).rejects.toThrow(CHECKLIST_TEMPLATE_REFUSAL);
  expect(await stored(), "a refused template changes nothing").toBe(ctx.templateId);
  await ctx.maintenance.updateSchedule(schedule.id, { active: true, checklistTemplateId: null }, ctx.actor, null);
  expect(await stored()).toBeNull();
}

/** The template list for an asset holds the active templates of its organization that fit its domain, with their items in order. */
export async function assertTheTemplateListFitsTheAsset(ctx: ChecklistFixtures): Promise<void> {
  const { items } = await ctx.tasks.listTemplatesForAsset(ctx.assetId, [ctx.assetId]);
  const ids = items.map((item) => item.id);
  expect(ids).toContain(ctx.templateId);
  expect(ids).toContain(ctx.electricalTemplateId);
  expect(ids, "a template for another domain").not.toContain(ctx.hvacTemplateId);
  expect(ids, "a retired template").not.toContain(ctx.retiredTemplateId);
  expect(ids, "another organization's template").not.toContain(ctx.foreignTemplateId);
  expect(items.every((item) => item.organizationId === ctx.organizationId && item.active)).toBe(true);
  expect(items.find((item) => item.id === ctx.templateId)?.items.map((item) => [item.title, item.mandatory])).toEqual([
    ["Isolate", true],
    ["Photograph", false],
    ["Test", true],
  ]);
}

/** The list answers nothing for an asset outside the caller's read scope, and nothing for an unknown asset. */
export async function assertTheTemplateListIsEmptyOutsideTheScope(ctx: ChecklistFixtures): Promise<void> {
  expect(await ctx.tasks.listTemplatesForAsset(ctx.assetId, [ctx.otherAssetId])).toEqual({ items: [] });
  expect(await ctx.tasks.listTemplatesForAsset(ctx.assetId, [])).toEqual({ items: [] });
  expect(await ctx.tasks.listTemplatesForAsset("99999999-9999-4999-8999-999999999999", null)).toEqual({ items: [] });
}

/**
 * Owner ruling, 2026-11-11: only the four admin roles may override a ticket's SLA. The
 * role is the `bms.users` row's: an operator is refused even with a token that claims
 * `admin`, and an organization admin passes even with a token that claims `operator`.
 */
export async function assertTheSlaOverrideGateReadsTheDatabaseRole(ctx: ChecklistFixtures): Promise<void> {
  const operator = { sub: ctx.operatorUserId, email: ctx.operatorEmail, name: "E3.1 operator" };
  for (const claimed of ["operator", "admin"] as const) {
    const attempt = ctx.access.assertWorkOrderSlaOverrideRole({ ...operator, role: claimed });
    await expect(attempt, `an operator whose token claims ${claimed}`).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toThrow(WORK_ORDER_SLA_OVERRIDE_DENIAL);
  }
  // The same operator may still create a ticket: the operational gate passes.
  await expect(ctx.access.assertOperationsWriteRole({ ...operator, role: "operator" }, "operational")).resolves.toBeUndefined();

  const admin = { sub: ctx.actor.sub, email: ctx.actor.email, name: "E3.1 organization admin" };
  await expect(ctx.access.assertWorkOrderSlaOverrideRole({ ...admin, role: "operator" })).resolves.toBeUndefined();
}

/** A ticket whose checklist is full refuses one more item with 409, and the add audit row holds no title. */
export async function assertAFullChecklistRefusesOneMoreAndTheAddAuditHoldsNoTitle(ctx: ChecklistFixtures): Promise<void> {
  const created = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);
  const title = "E31-typed-item-title";
  await ctx.taskAdd.addTask(created.id, { title, mandatory: false }, ctx.actor, null);
  const audit = await ctx.fleetPool.query<{ text: string }>(
    "SELECT payload::text || coalesce(reason, '') AS text FROM bms.audit_log WHERE action = 'work_order_task_create' AND entity_id = $1",
    [created.id],
  );
  expect(audit.rows).toHaveLength(1);
  expect(audit.rows[0]?.text.includes(title), "the typed title is not in the audit row").toBe(false);

  // Fill the checklist to the cap directly, then ask the route's service for one more.
  await ctx.fleetPool.query(
    `INSERT INTO bms.work_order_tasks (organization_id, work_order_id, title, sort_order)
     SELECT $1, $2, 'Filler ' || n, n + 1 FROM generate_series(1, $3::integer) AS n`,
    [ctx.organizationId, created.id, WORK_ORDER_MAX_TASKS - 1],
  );
  const attempt = ctx.taskAdd.addTask(created.id, { title: "One too many", mandatory: false }, ctx.actor, null);
  await expect(attempt).rejects.toBeInstanceOf(ConflictException);
  await expect(attempt).rejects.toThrow(WORK_ORDER_TASKS_FULL_REFUSAL);
  expect(await tasksOf(ctx.fleetPool, created.id)).toHaveLength(WORK_ORDER_MAX_TASKS);
}

/** The composite key ties a task's template item to the task's organization, for the fleet role too. */
export async function assertATaskCannotPointAtAnotherOrganizationsTemplateItem(ctx: ChecklistFixtures): Promise<void> {
  const created = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low" }, ctx.actor, null);
  const foreignItem = await ctx.fleetPool.query<{ id: string }>(
    "SELECT id FROM bms.work_order_checklist_template_items WHERE template_id = $1 LIMIT 1",
    [ctx.foreignTemplateId],
  );
  const code = await ctx.fleetPool
    .query("INSERT INTO bms.work_order_tasks (organization_id, work_order_id, title, template_item_id) VALUES ($1, $2, 'Planted', $3)", [
      ctx.organizationId,
      created.id,
      foreignItem.rows[0]?.id,
    ])
    .then(
      () => undefined,
      (err: { code?: string }) => err.code,
    );
  expect(code, "a foreign-key violation").toBe("23503");
}
