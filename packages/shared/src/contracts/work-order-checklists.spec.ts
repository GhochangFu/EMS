import { ZodIntersection } from "zod";

import { COPILOT_CATALOG } from "../copilot/catalog";
import { createMaintenanceScheduleBodySchema, updateMaintenanceScheduleBodySchema } from "./maintenance-writes";
import { workOrderListItemSchema } from "./operations";
import {
  createWorkOrderBodySchema,
  createWorkOrderChecklistTemplateBodySchema,
  createWorkOrderTaskBodySchema,
  updateWorkOrderChecklistTemplateBodySchema,
  updateWorkOrderTaskBodySchema,
} from "./operations-writes";
import {
  WORK_ORDER_TASK_RESULTS,
  workOrderChecklistTemplatesResponseSchema,
  workOrderDetailSchema,
  workOrderTaskDtoSchema,
} from "./work-orders";

/**
 * `E3.1` (ADR 0122 decision 4, plan T3.2 and T3.3) — the checklist contracts of PR 3:
 * the item's two counters, the task row, the detail's `tasks`, the task and template
 * bodies, and the copilot's `clientOnly` rule for `checklistTemplateId`. Assertions
 * live here; `work-order-checklists.test.ts` is the vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ASSET_ID = "30000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const TEMPLATE_ID = "40000000-0000-4000-8000-000000000001";

const ITEM = {
  id: "w1",
  reference: "ELEC-000042",
  assetId: ASSET_ID,
  alarmId: null,
  title: "Replace bearing",
  description: null,
  status: "open",
  priority: "high",
  sortOrder: 0,
  assignedTo: null,
  createdBy: null,
  dueAt: null,
  resolvedAt: null,
  closedAt: null,
  slaMinutes: 60,
  slaDueAt: "2026-11-05T01:00:00.000Z",
  slaState: "on_track",
  checklistDone: 1,
  checklistTotal: 3,
  causeCode: null,
  approvedAt: null,
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
  assetCode: "CR-Q1",
  assetRtuName: null,
  assetLocationName: null,
  assetName: "Chiller Q1",
  siteName: "Site A",
};

const TASK = {
  id: "t1",
  title: "Isolate the breaker",
  mandatory: true,
  result: "pending",
  note: null,
  sortOrder: 1,
  completedAt: null,
  completedBy: null,
  templateItemId: null,
};

function without(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

/** The list item is refused without either checklist counter. */
export function itemRequiresBothChecklistCounters(): void {
  assert(workOrderListItemSchema.safeParse(ITEM).success, "the full item parses");
  assert(!workOrderListItemSchema.safeParse(without(ITEM, "checklistDone")).success, "an item without checklistDone is refused");
  assert(!workOrderListItemSchema.safeParse(without(ITEM, "checklistTotal")).success, "an item without checklistTotal is refused");
  assert(!workOrderListItemSchema.safeParse({ ...ITEM, checklistDone: 0.5 }).success, "a fractional count is refused");
}

/** The three results of ADR 0122 decision 4.1, in order. */
export function taskResultsAreTheThreeRuled(): void {
  assert(
    JSON.stringify(WORK_ORDER_TASK_RESULTS) === JSON.stringify(["pending", "done", "not_applicable"]),
    `task results are ${JSON.stringify(WORK_ORDER_TASK_RESULTS)}`,
  );
}

/** A task row parses and refuses a result outside the vocabulary. */
export function taskRowRoundTrips(): void {
  assert(workOrderTaskDtoSchema.safeParse(TASK).success, "a task parses");
  assert(
    workOrderTaskDtoSchema.safeParse({ ...TASK, result: "not_applicable", note: "No breaker on this model" }).success,
    "a not-applicable task with a note parses",
  );
  assert(!workOrderTaskDtoSchema.safeParse({ ...TASK, result: "skipped" }).success, "an unknown result is refused");
  assert(!workOrderTaskDtoSchema.safeParse(without(TASK, "mandatory")).success, "a task without mandatory is refused");
}

/** The detail carries `tasks`, and is still an intersection with the list item. */
export function detailCarriesTheChecklist(): void {
  assert(workOrderDetailSchema instanceof ZodIntersection, "workOrderDetailSchema is still a z.intersection");
  const detail = { ...ITEM, events: [], alarm: null, tasks: [TASK], rootCause: null, correctiveAction: null, preventiveAction: null, resolvedBy: null, approvedBy: null, cancelledBy: null, cancelledAt: null, alarmSnapshot: null };
  const parsed = workOrderDetailSchema.safeParse(detail);
  assert(parsed.success, "the detail parses");
  assert(parsed.success && parsed.data.tasks.length === 1 && parsed.data.checklistTotal === 3, "it carries the tasks and the item's counters");
  assert(!workOrderDetailSchema.safeParse(without(detail, "tasks")).success, "a detail without tasks is refused");
}

const CREATE = { assetId: ASSET_ID, title: "Replace bearing" };

/** `checklistTemplateId` is an optional uuid on the create body, which stays strict. */
export function createBodyTakesAChecklistTemplate(): void {
  assert(createWorkOrderBodySchema.safeParse({ ...CREATE, checklistTemplateId: TEMPLATE_ID }).success, "a template id parses");
  assert(createWorkOrderBodySchema.safeParse(CREATE).success, "create parses without one");
  assert(!createWorkOrderBodySchema.safeParse({ ...CREATE, checklistTemplateId: "nope" }).success, "a non-uuid is refused");
  assert(!createWorkOrderBodySchema.safeParse({ ...CREATE, tasks: [] }).success, "an unknown key is still refused");
}

/** The task bodies are strict; an update needs a result or a note. */
export function taskBodiesAreStrictAndAnUpdateNeedsAField(): void {
  const created = createWorkOrderTaskBodySchema.safeParse({ title: "Check the oil level" });
  assert(created.success && created.data.mandatory === false, "an item added by hand is optional unless it says otherwise");
  assert(!createWorkOrderTaskBodySchema.safeParse({ title: "x" }).success, "a one-character title is refused");
  assert(!createWorkOrderTaskBodySchema.safeParse({ title: "Check", result: "done" }).success, "an unknown key is refused");

  assert(updateWorkOrderTaskBodySchema.safeParse({ result: "done" }).success, "a result alone parses");
  assert(updateWorkOrderTaskBodySchema.safeParse({ note: null }).success, "a cleared note alone parses");
  assert(!updateWorkOrderTaskBodySchema.safeParse({}).success, "an empty update is refused");
  assert(!updateWorkOrderTaskBodySchema.safeParse({ result: "skipped" }).success, "an unknown result is refused");
  assert(!updateWorkOrderTaskBodySchema.safeParse({ result: "done", title: "x" }).success, "an unknown key is refused");
  assert(!updateWorkOrderTaskBodySchema.safeParse({ result: "done", mandatory: false }).success, "mandatory cannot be changed here");
}

/** The template bodies are strict, need at least one item on create, and an update needs a field. */
export function templateBodiesAreStrict(): void {
  const body = { organizationId: ORGANIZATION_ID, name: "Breaker inspection", items: [{ title: "Isolate the breaker", mandatory: true }] };
  assert(createWorkOrderChecklistTemplateBodySchema.safeParse(body).success, "a template with one item parses");
  assert(createWorkOrderChecklistTemplateBodySchema.safeParse({ ...body, domain: "electrical" }).success, "a domain parses");
  assert(createWorkOrderChecklistTemplateBodySchema.safeParse({ ...body, domain: null }).success, "a null domain parses");
  assert(!createWorkOrderChecklistTemplateBodySchema.safeParse({ ...body, items: [] }).success, "a template with no item is refused");
  assert(!createWorkOrderChecklistTemplateBodySchema.safeParse({ ...body, active: true }).success, "an unknown top-level key is refused");
  assert(
    !createWorkOrderChecklistTemplateBodySchema.safeParse({ ...body, items: [{ title: "Isolate", sortOrder: 3 }] }).success,
    "an unknown item key is refused",
  );
  assert(!createWorkOrderChecklistTemplateBodySchema.safeParse(without(body, "organizationId")).success, "the organization is required");

  assert(updateWorkOrderChecklistTemplateBodySchema.safeParse({ active: false }).success, "a retire parses");
  assert(updateWorkOrderChecklistTemplateBodySchema.safeParse({ domain: null }).success, "clearing the domain parses");
  assert(!updateWorkOrderChecklistTemplateBodySchema.safeParse({}).success, "an empty update is refused");
  assert(!updateWorkOrderChecklistTemplateBodySchema.safeParse({ organizationId: ORGANIZATION_ID }).success, "a template cannot move organization");
  assert(!updateWorkOrderChecklistTemplateBodySchema.safeParse({ items: [] }).success, "an update cannot empty the list");
}

/** The template list answers templates with their items. */
export function templateListRoundTrips(): void {
  const template = {
    id: TEMPLATE_ID,
    organizationId: ORGANIZATION_ID,
    name: "Breaker inspection",
    domain: null,
    active: true,
    items: [{ id: "i1", title: "Isolate the breaker", mandatory: true, sortOrder: 1 }],
    createdAt: "2026-11-05T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
  };
  assert(workOrderChecklistTemplatesResponseSchema.safeParse({ items: [template] }).success, "a template parses");
  assert(!workOrderChecklistTemplatesResponseSchema.safeParse({ items: [without(template, "items")] }).success, "a template without items is refused");
}

/** A schedule may name a checklist template on create, and set or clear it on update. */
export function scheduleBodiesTakeAChecklistTemplate(): void {
  const create = { assetId: ASSET_ID, title: "Quarterly service", intervalDays: 90, firstDueAt: "2026-12-01T00:00:00.000Z" };
  assert(createMaintenanceScheduleBodySchema.safeParse({ ...create, checklistTemplateId: TEMPLATE_ID }).success, "create takes a template id");
  assert(!createMaintenanceScheduleBodySchema.safeParse({ ...create, checklistTemplateId: null }).success, "create takes no null");
  assert(updateMaintenanceScheduleBodySchema.safeParse({ active: true, checklistTemplateId: TEMPLATE_ID }).success, "update sets it");
  assert(updateMaintenanceScheduleBodySchema.safeParse({ active: true, checklistTemplateId: null }).success, "update clears it");
  assert(updateMaintenanceScheduleBodySchema.safeParse({ active: false }).success, "update still parses without it");
}

/** Ruling P4: the copilot never sends `checklistTemplateId` — it is `clientOnly` on each entry whose body has it. */
export function copilotNeverSendsAChecklistTemplate(): void {
  for (const id of ["workOrder.create", "maintenanceSchedule.create", "maintenanceSchedule.activate", "maintenanceSchedule.deactivate"]) {
    const entry = COPILOT_CATALOG.find((candidate) => candidate.id === id);
    assert(entry !== undefined, `${id} is catalogued`);
    assert(entry?.clientOnly.includes("checklistTemplateId") === true, `checklistTemplateId is clientOnly on ${id}`);
  }
  const create = COPILOT_CATALOG.find((candidate) => candidate.id === "workOrder.create");
  assert(create?.clientOnly.includes("slaMinutes") === true, "slaMinutes stays clientOnly on workOrder.create");
}
