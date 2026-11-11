import { ZodIntersection } from "zod";

import { COPILOT_CATALOG } from "../copilot/catalog";
import { workOrderListItemSchema } from "./operations";
import {
  copilotWorkOrderSetStatusModelBodySchema,
  createWorkOrderBodySchema,
  putWorkOrderRootCauseBodySchema,
  updateWorkOrderStatusBodySchema,
} from "./operations-writes";
import { workOrderAlarmSnapshotSchema, workOrderCauseCodesResponseSchema, workOrderDetailSchema } from "./work-orders";

/**
 * `E3.1` (ADR 0122 decisions 5 and 5a, plan T4.2 and T4.3) — the contracts of PR 4: the
 * item's `causeCode` and `approvedAt`, the detail's findings and alarm snapshot, the
 * status body's four findings fields, the root-cause body, and the rule that no request
 * body can carry the snapshot. Assertions live here; `work-order-findings.test.ts` is
 * the vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ASSET_ID = "30000000-0000-4000-8000-000000000001";

const ITEM = {
  id: "w1",
  reference: "ELEC-000042",
  assetId: ASSET_ID,
  alarmId: null,
  title: "Replace bearing",
  description: null,
  status: "resolved",
  priority: "high",
  sortOrder: 0,
  assignedTo: null,
  createdBy: null,
  dueAt: null,
  resolvedAt: "2026-11-05T00:30:00.000Z",
  closedAt: null,
  slaMinutes: 60,
  slaDueAt: "2026-11-05T01:00:00.000Z",
  slaState: "met",
  checklistDone: 0,
  checklistTotal: 0,
  causeCode: "wear_and_tear",
  approvedAt: null,
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:30:00.000Z",
  assetCode: "CR-Q1",
  assetRtuName: null,
  assetLocationName: null,
  assetName: "Chiller Q1",
  siteName: "Site A",
};

const SNAPSHOT = {
  rootCause: "Bearing overheated",
  correctiveActions: "Replace the bearing",
  skillCode: "mechanical",
  etrAt: "2026-11-05T04:00:00.000Z",
};

const DETAIL = {
  ...ITEM,
  events: [],
  alarm: null,
  tasks: [],
  rootCause: "Bearing worn out",
  correctiveAction: "Bearing replaced",
  preventiveAction: null,
  resolvedBy: "u1",
  alarmSnapshot: SNAPSHOT,
};

function without(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

/** The list item is refused without `causeCode` or `approvedAt`; both may be null. */
export function itemRequiresCauseCodeAndApprovedAt(): void {
  assert(workOrderListItemSchema.safeParse(ITEM).success, "the full item parses");
  assert(workOrderListItemSchema.safeParse({ ...ITEM, causeCode: null }).success, "a null cause code parses");
  assert(!workOrderListItemSchema.safeParse(without(ITEM, "causeCode")).success, "an item without causeCode is refused");
  assert(!workOrderListItemSchema.safeParse(without(ITEM, "approvedAt")).success, "an item without approvedAt is refused");
}

/** The detail carries the findings and the alarm snapshot, and is still an intersection with the list item. */
export function detailCarriesFindingsAndTheSnapshot(): void {
  assert(workOrderDetailSchema instanceof ZodIntersection, "workOrderDetailSchema is still a z.intersection");
  const parsed = workOrderDetailSchema.safeParse(DETAIL);
  assert(parsed.success, "the detail parses");
  assert(parsed.success && parsed.data.alarmSnapshot?.rootCause === SNAPSHOT.rootCause, "it carries the snapshot");
  assert(parsed.success && parsed.data.rootCause === DETAIL.rootCause && parsed.data.causeCode === ITEM.causeCode, "and the findings");
  assert(workOrderDetailSchema.safeParse({ ...DETAIL, alarmSnapshot: null }).success, "a ticket with no snapshot parses");
  for (const key of ["alarmSnapshot", "rootCause", "correctiveAction", "preventiveAction", "resolvedBy"]) {
    assert(!workOrderDetailSchema.safeParse(without(DETAIL, key)).success, `a detail without ${key} is refused`);
  }
}

/** The snapshot's four values are each nullable and each required. */
export function snapshotHoldsFourNullableValues(): void {
  assert(workOrderAlarmSnapshotSchema.safeParse(SNAPSHOT).success, "a full snapshot parses");
  assert(
    workOrderAlarmSnapshotSchema.safeParse({ rootCause: "x", correctiveActions: null, skillCode: null, etrAt: null }).success,
    "a snapshot with one value parses",
  );
  assert(!workOrderAlarmSnapshotSchema.safeParse(without(SNAPSHOT, "etrAt")).success, "a snapshot without etrAt is refused");
}

/** The cause-code list answers code, label and order. */
export function causeCodeListRoundTrips(): void {
  const row = { code: "wear_and_tear", label: "Wear and tear", sortOrder: 20 };
  assert(workOrderCauseCodesResponseSchema.safeParse({ items: [row] }).success, "a row parses");
  assert(!workOrderCauseCodesResponseSchema.safeParse({ items: [without(row, "label")] }).success, "a row without a label is refused");
}

/** The status body takes the four findings, bounds them, and stays strict. */
export function statusBodyTakesTheFindings(): void {
  const findings = { rootCause: "Bearing worn out", correctiveAction: "Bearing replaced", preventiveAction: "Grease monthly", causeCode: "wear_and_tear" };
  assert(updateWorkOrderStatusBodySchema.safeParse({ status: "resolved", ...findings }).success, "resolved with findings parses");
  assert(updateWorkOrderStatusBodySchema.safeParse({ status: "resolved" }).success, "resolved without findings still parses");
  assert(!updateWorkOrderStatusBodySchema.safeParse({ status: "resolved", rootCause: "x" }).success, "a two-character finding is refused");
  assert(!updateWorkOrderStatusBodySchema.safeParse({ status: "resolved", rootCause: null }).success, "the status body does not clear a finding");
  assert(!updateWorkOrderStatusBodySchema.safeParse({ status: "resolved", rootCause: "y".repeat(4001) }).success, "an over-long finding is refused");
  assert(!updateWorkOrderStatusBodySchema.safeParse({ status: "resolved", causeCode: "" }).success, "an empty cause code is refused");
  for (const blank of ["   ", " \n\t ", "  x  "]) {
    assert(!updateWorkOrderStatusBodySchema.safeParse({ status: "resolved", rootCause: blank }).success, `${JSON.stringify(blank)} is not a finding`);
    assert(
      !putWorkOrderRootCauseBodySchema.safeParse({ rootCause: blank, correctiveAction: "Bearing replaced", causeCode: "other" }).success,
      `${JSON.stringify(blank)} is not a finding on the root-cause body either`,
    );
  }
  const trimmed = updateWorkOrderStatusBodySchema.safeParse({ status: "resolved", rootCause: "  Bearing worn out  " });
  assert(trimmed.success && trimmed.data.rootCause === "Bearing worn out", "a finding is stored without its outer spaces");
  assert(!updateWorkOrderStatusBodySchema.safeParse({ status: "resolved", resolvedBy: "u1" }).success, "an unknown key is refused");
}

/** The root-cause body replaces the set: three keys are required (null clears), and it is strict. */
export function rootCauseBodyReplacesTheSet(): void {
  const body = { rootCause: "Bearing worn out", correctiveAction: "Bearing replaced", causeCode: "wear_and_tear" };
  assert(putWorkOrderRootCauseBodySchema.safeParse(body).success, "the three required findings parse");
  assert(putWorkOrderRootCauseBodySchema.safeParse({ ...body, preventiveAction: null }).success, "a null preventive action parses");
  assert(putWorkOrderRootCauseBodySchema.safeParse({ rootCause: null, correctiveAction: null, causeCode: null }).success, "clearing all three parses");
  assert(!putWorkOrderRootCauseBodySchema.safeParse(without(body, "causeCode")).success, "a body without causeCode is refused");
  assert(!putWorkOrderRootCauseBodySchema.safeParse({ ...body, status: "resolved" }).success, "an unknown key is refused");
}

/** `E3.4` (plan D17): no request body takes the alarm snapshot — a value sent by a browser could be forged. */
export function noRequestBodyTakesTheSnapshot(): void {
  const smuggled = { alarmRootCause: "x", alarmCorrectiveActions: "y", alarmSkillCode: "mechanical", alarmEtrAt: "2026-11-05T04:00:00.000Z", alarmSnapshot: SNAPSHOT };
  for (const [key, value] of Object.entries(smuggled)) {
    assert(!createWorkOrderBodySchema.safeParse({ assetId: ASSET_ID, title: "Replace bearing", [key]: value }).success, `create refuses ${key}`);
    assert(!updateWorkOrderStatusBodySchema.safeParse({ status: "resolved", [key]: value }).success, `status refuses ${key}`);
    assert(
      !putWorkOrderRootCauseBodySchema.safeParse({ rootCause: null, correctiveAction: null, causeCode: null, [key]: value }).success,
      `root-cause refuses ${key}`,
    );
  }
}

/** Ruling P4: the copilot never sends the findings — they are `clientOnly` on `workOrder.setStatus`, and absent from its model body. */
export function copilotNeverSendsTheFindings(): void {
  const entry = COPILOT_CATALOG.find((candidate) => candidate.id === "workOrder.setStatus");
  assert(entry !== undefined, "workOrder.setStatus is catalogued");
  for (const field of ["rootCause", "correctiveAction", "preventiveAction", "causeCode"]) {
    assert(entry?.clientOnly.includes(field) === true, `${field} is clientOnly on workOrder.setStatus`);
    assert(!copilotWorkOrderSetStatusModelBodySchema.safeParse({ status: "resolved", [field]: "wear_and_tear" }).success, `the model body refuses ${field}`);
  }
}
