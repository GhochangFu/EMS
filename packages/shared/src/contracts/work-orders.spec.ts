import { ZodIntersection } from "zod";

import { COPILOT_CATALOG } from "../copilot/catalog";
import { workOrderListItemSchema } from "./operations";
import { createWorkOrderBodySchema, putWorkOrderSlaPoliciesBodySchema } from "./operations-writes";
import {
  WORK_ORDER_EVENT_TYPES,
  workOrderDetailSchema,
  workOrderEventDetailSchema,
  workOrderEventDtoSchema,
  workOrderPrefixSchema,
  workOrderSlaPoliciesResponseSchema,
} from "./work-orders";

/**
 * `E3.1` (ADR 0122) — the work-order depth contracts of PR 1: the item's reference and
 * SLA fields, the create body's `slaMinutes`, the SLA policy body and the prefix rule.
 * Assertions live here; `work-orders.test.ts` is the vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ASSET_ID = "30000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";

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
  checklistDone: 0,
  checklistTotal: 0,
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
  assetCode: "CR-Q1",
  assetRtuName: null,
  assetLocationName: null,
  assetName: "Chiller Q1",
  siteName: "Site A",
};

function without(key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ITEM).filter(([name]) => name !== key));
}

/** The item parses whole, and is refused without its reference or its SLA state. */
export function itemRequiresReferenceAndSlaState(): void {
  assert(workOrderListItemSchema.safeParse(ITEM).success, "the full item parses");
  assert(!workOrderListItemSchema.safeParse(without("reference")).success, "an item without reference is refused");
  assert(!workOrderListItemSchema.safeParse(without("slaState")).success, "an item without slaState is refused");
  assert(!workOrderListItemSchema.safeParse({ ...ITEM, slaState: "late" }).success, "an unknown slaState is refused");
  assert(workOrderListItemSchema.safeParse({ ...ITEM, slaMinutes: null, slaDueAt: null, slaState: "none" }).success, "a ticket with no SLA parses");
}

const CREATE = { assetId: ASSET_ID, title: "Replace bearing" };

/** `slaMinutes` is optional on create, one minute to one year, and the body stays strict. */
export function createBodyBoundsSlaMinutes(): void {
  assert(createWorkOrderBodySchema.safeParse(CREATE).success, "create parses without slaMinutes");
  assert(createWorkOrderBodySchema.safeParse({ ...CREATE, slaMinutes: 45 }).success, "45 minutes parses");
  assert(!createWorkOrderBodySchema.safeParse({ ...CREATE, slaMinutes: 0 }).success, "0 minutes is refused");
  assert(!createWorkOrderBodySchema.safeParse({ ...CREATE, slaMinutes: 1.5 }).success, "a fraction is refused");
  assert(!createWorkOrderBodySchema.safeParse({ ...CREATE, slaMinutes: 525_601 }).success, "over a year is refused");
  assert(!createWorkOrderBodySchema.safeParse({ ...CREATE, reference: "ELEC-000001" }).success, "an unknown key is refused");
}

/** The policy body is strict, holds at most four rows and at most one per priority. */
export function policyBodyIsStrictAndUniquePerPriority(): void {
  const body = { organizationId: ORGANIZATION_ID, policies: [{ priority: "high", resolutionMinutes: 45 }] };
  assert(putWorkOrderSlaPoliciesBodySchema.safeParse(body).success, "one row parses");
  assert(putWorkOrderSlaPoliciesBodySchema.safeParse({ ...body, policies: [] }).success, "an empty set parses (all defaults)");
  assert(
    !putWorkOrderSlaPoliciesBodySchema.safeParse({
      ...body,
      policies: [
        { priority: "high", resolutionMinutes: 45 },
        { priority: "high", resolutionMinutes: 60 },
      ],
    }).success,
    "a duplicate priority is refused",
  );
  assert(!putWorkOrderSlaPoliciesBodySchema.safeParse({ ...body, extra: true }).success, "an unknown top-level key is refused");
  assert(
    !putWorkOrderSlaPoliciesBodySchema.safeParse({ ...body, policies: [{ priority: "high", resolutionMinutes: 45, note: "x" }] }).success,
    "an unknown row key is refused",
  );
  assert(
    !putWorkOrderSlaPoliciesBodySchema.safeParse({ ...body, policies: [{ priority: "urgent", resolutionMinutes: 45 }] }).success,
    "an unknown priority is refused",
  );
  assert(
    !putWorkOrderSlaPoliciesBodySchema.safeParse({ ...body, policies: [{ priority: "high", resolutionMinutes: 0 }] }).success,
    "0 minutes is refused",
  );
}

/** The read answers rows that say where their minutes came from. */
export function policyResponseCarriesSource(): void {
  const row = { priority: "high", resolutionMinutes: 60, source: "default" };
  assert(workOrderSlaPoliciesResponseSchema.safeParse({ organizationId: ORGANIZATION_ID, items: [row] }).success, "a default row parses");
  assert(
    !workOrderSlaPoliciesResponseSchema.safeParse({ organizationId: ORGANIZATION_ID, items: [{ ...row, source: "seed" }] }).success,
    "an unknown source is refused",
  );
}

/** Two to eight upper-case letters or digits — the migration's `CHECK`. */
export function prefixIsUpperCaseTwoToEight(): void {
  for (const good of ["STP", "ELEC", "UPS", "A1", "ABCDEFGH"]) {
    assert(workOrderPrefixSchema.safeParse(good).success, `${good} parses`);
  }
  for (const bad of ["stp", "S", "ABCDEFGHI", "ST-P", "ST P", ""]) {
    assert(!workOrderPrefixSchema.safeParse(bad).success, `${JSON.stringify(bad)} is refused`);
  }
}

/** Ruling P4: the copilot never sends `slaMinutes` — it is `clientOnly` on `workOrder.create`. */
export function copilotNeverSendsSlaMinutes(): void {
  const entry = COPILOT_CATALOG.find((candidate) => candidate.id === "workOrder.create");
  assert(entry !== undefined, "workOrder.create is catalogued");
  assert(entry?.clientOnly.includes("slaMinutes") === true, "slaMinutes is clientOnly on workOrder.create");
}

const EVENT = {
  id: "e1",
  eventType: "created",
  actorName: "Asha Rao",
  fromStatus: null,
  toStatus: "open",
  detail: { origin: "alarm" },
  createdAt: "2026-11-05T00:00:00.000Z",
};

/** The ten event types of ADR 0122 decision 7.1, `cancelled` among them. */
export function eventTypesAreTheTenRuled(): void {
  assert(
    JSON.stringify(WORK_ORDER_EVENT_TYPES) ===
      JSON.stringify(["created", "assigned", "status_changed", "task_updated", "root_cause_set", "resolved", "approved", "rejected", "cancelled", "sla_changed"]),
    `event types are ${JSON.stringify(WORK_ORDER_EVENT_TYPES)}`,
  );
}

/** An event's detail is a closed shape: an unknown key — an email, a subject — is refused. */
export function eventDetailIsAClosedShape(): void {
  assert(workOrderEventDetailSchema.safeParse({}).success, "an empty detail parses");
  assert(workOrderEventDetailSchema.safeParse({ reason: "Bearing replaced", assignedTo: null, selfApproved: true }).success, "known keys parse");
  for (const smuggled of [{ actorEmail: "a@example.test" }, { oidcSubject: "sub-1" }, { email: "a@example.test" }, { note: "x" }]) {
    assert(!workOrderEventDetailSchema.safeParse(smuggled).success, `${JSON.stringify(smuggled)} is refused`);
  }
  assert(!workOrderEventDetailSchema.safeParse({ origin: "copilot" }).success, "an unknown origin is refused");
  assert(!workOrderEventDtoSchema.safeParse({ ...EVENT, detail: { actorEmail: "a@example.test" } }).success, "the event row refuses it too");
}

/** An event row parses, takes a null actor name, and refuses an unknown type. */
export function eventRowRoundTrips(): void {
  assert(workOrderEventDtoSchema.safeParse(EVENT).success, "an event parses");
  assert(workOrderEventDtoSchema.safeParse({ ...EVENT, actorName: null }).success, "a null actor name parses");
  assert(!workOrderEventDtoSchema.safeParse({ ...EVENT, eventType: "deleted" }).success, "an unknown event type is refused");
  assert(!workOrderEventDtoSchema.safeParse({ ...EVENT, toStatus: "done" }).success, "an unknown status is refused");
}

/** The detail is an intersection with the list item, so it follows the item; it is not a flattened copy. */
export function detailIsAnIntersectionWithTheListItem(): void {
  assert(workOrderDetailSchema instanceof ZodIntersection, "workOrderDetailSchema is a z.intersection");
  const detail = { ...ITEM, tasks: [], events: [EVENT], alarm: { id: "a1", severity: "critical", message: "Breaker tripped", raisedAt: "2026-11-05T00:00:00.000Z" } };
  const parsed = workOrderDetailSchema.safeParse(detail);
  assert(parsed.success, "the detail parses");
  assert(parsed.success && parsed.data.reference === ITEM.reference && parsed.data.events.length === 1, "it carries the item and the events");
  assert(workOrderDetailSchema.safeParse({ ...detail, alarm: null, events: [] }).success, "no alarm and no events parses");
  assert(!workOrderDetailSchema.safeParse({ ...ITEM, alarm: null }).success, "a detail without events is refused");
  assert(!workOrderDetailSchema.safeParse({ ...without("reference"), events: [], alarm: null, tasks: [] }).success, "the item's own rule still holds");
}
