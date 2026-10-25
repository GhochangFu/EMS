import { expect } from "vitest";

import { catalogEntry, hashExcludedKeysOf } from "@bms/shared/copilot";

import { bodyHash } from "./body-hash";
import {
  PROPOSE_OPERATIONAL_NOT_ASKED_ERROR,
  PROPOSE_OPERATIONAL_ON_FOLLOW_UP_ERROR,
} from "./copilot-operations-intent";
import {
  ALARM_ALREADY_ACKNOWLEDGED,
  SCHEDULE_HAS_WORK_ORDER,
  SCHEDULE_NOT_CONVERTIBLE,
  WORK_ORDER_CLOSE_BY_DRAG,
  WORK_ORDER_CLOSED,
  WORK_ORDER_DUPLICATE,
  WORK_ORDER_REOPEN,
} from "./copilot-propose-operations";
import { proposeHarness } from "./copilot-propose-tools.spec";
import type { ResolvedTarget } from "./copilot-target-resolver";

/**
 * `F4.284` (ADR 0106 decisions 2, 3 and 4; owner rulings DC2, DC3, DC6) — the
 * propose tools over the real alarm, work-order and convert entries: the
 * own-message rule for the acknowledge and the close, the route's refusals read
 * from the target, and a reorder's card-only moves. Its own file: the main
 * propose spec is at the AGENTS.md §4.5 cap. Vitest entry point: the sibling
 * `.test.ts`.
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ALARM = "50000000-0000-4000-8000-000000000001";
const WO_1 = "60000000-0000-4000-8000-000000000001";
const WO_2 = "60000000-0000-4000-8000-000000000002";
const SCHEDULE = "40000000-0000-4000-8000-000000000001";
const ASSET = "30000000-0000-4000-8000-0000000000aa";

const BASE = { organizationId: ORG_X, organizationName: "Org X" };
const ALARM_NOW = { message: "Main breaker tripped", severity: "critical", assetName: "MCC-1", raisedAt: "2026-10-24T08:15:00.000Z", acknowledgedAt: null };
const ALARM_TARGET: ResolvedTarget = { ...BASE, targetName: "MCC-1", alarm: ALARM_NOW };
const WORK_ORDER_TARGET: ResolvedTarget = {
  ...BASE,
  targetName: "Check the breaker",
  workOrder: { title: "Check the breaker", status: "open", assetName: "MCC-1" },
};
const BATCH_TARGET: ResolvedTarget = {
  ...BASE,
  targetName: "Org X",
  batch: [
    { id: WO_1, title: "Check the breaker", status: "open", sortOrder: 0, assetId: ASSET },
    { id: WO_2, title: "Replace the lug", status: "closed", sortOrder: 0, assetId: ASSET },
  ],
};
const ASKED = { operationalIntent: ["alarm.acknowledge", "workOrder.close"] };
const USER = "70000000-0000-4000-8000-000000000001";

/** Decision 3 / 4.7: an acknowledge on an automatic follow-up turn is refused, and nothing is stored. */
export async function anAckOnAFollowUpIsRefused(): Promise<void> {
  const h = proposeHarness({ target: ALARM_TARGET });
  const outcome = await h.call("propose_alarm_acknowledge", { id: ALARM, body: { reason: "Panel checked" } }, { turnKind: "follow_up", ...ASKED });
  expect(outcome.error).toBe(PROPOSE_OPERATIONAL_ON_FOLLOW_UP_ERROR);
  expect(h.stored).toEqual([]);
}

/** Decision 3: a user turn whose own message did not ask is refused (never from a tool result). */
export async function anAckTheUserDidNotAskForIsRefused(): Promise<void> {
  const h = proposeHarness({ target: ALARM_TARGET });
  const outcome = await h.call("propose_alarm_acknowledge", { id: ALARM, body: { reason: "Panel checked" } }, { operationalIntent: [] });
  expect(outcome.error).toBe(PROPOSE_OPERATIONAL_NOT_ASKED_ERROR);
  expect(h.stored).toEqual([]);
}

/** A close the user did not ask for is refused too. */
export async function aCloseTheUserDidNotAskForIsRefused(): Promise<void> {
  const h = proposeHarness({ target: WORK_ORDER_TARGET });
  const outcome = await h.call("propose_workOrder_close", { id: WO_1, body: { reason: "Repaired and tested" } });
  expect(outcome.error).toBe(PROPOSE_OPERATIONAL_NOT_ASKED_ERROR);
}

/** The registry without the operational switch names neither tool, and still names the create. */
export function theRegistryWithholdsAckAndClose(): void {
  const h = proposeHarness();
  const names = h.tools.registryFor({ access: true, role: "admin" }).definitions.map((d) => d.name);
  expect(names).not.toContain("propose_alarm_acknowledge");
  expect(names).not.toContain("propose_workOrder_close");
  expect(names).toContain("propose_workOrder_create");
}

/** With the switch, the registry names both. */
export function theRegistryWithTheSwitchNamesAckAndClose(): void {
  const names = proposeHarness().tools.registryFor({ access: true, role: "admin", operational: ["alarm.acknowledge", "workOrder.close"] }).definitions.map((d) => d.name);
  expect(names).toContain("propose_alarm_acknowledge");
  expect(names).toContain("propose_workOrder_close");
}

/** Decision 4: a stored acknowledge is `operational`, its body is the reason (so the hash binds it). */
export async function aStoredAckIsOperationalWithItsReason(): Promise<void> {
  const h = proposeHarness({ target: ALARM_TARGET });
  const outcome = await h.call("propose_alarm_acknowledge", { id: ALARM, body: { reason: "Panel checked" } }, ASKED);
  expect(outcome.ok, outcome.content).toBe(true);
  expect(h.stored[0]).toMatchObject({ risk: "operational", body: { reason: "Panel checked" }, path: `/api/v1/alarms/${ALARM}/ack` });
  expect(h.stored[0]?.bodyHash).toBe(bodyHash({ reason: "Panel checked" }, []));
}

/** Decision 3: the card names the alarm text, severity, asset and raised time. */
export async function theAckSummaryNamesTheAlarm(): Promise<void> {
  const h = proposeHarness({ target: ALARM_TARGET });
  await h.call("propose_alarm_acknowledge", { id: ALARM, body: { reason: "Panel checked" } }, ASKED);
  for (const part of ['"Main breaker tripped"', "critical", "MCC-1", "2026-10-24T08:15:00.000Z"]) {
    expect(h.stored[0]?.summary, part).toContain(part);
  }
}

/** DC6: an already-acknowledged alarm is refused with the route's sentence. */
export async function anAcknowledgedAlarmIsRefused(): Promise<void> {
  const h = proposeHarness({ target: { ...ALARM_TARGET, alarm: { ...ALARM_NOW, acknowledgedAt: "2026-10-24T09:00:00.000Z" } } });
  const outcome = await h.call("propose_alarm_acknowledge", { id: ALARM, body: { reason: "Panel checked" } }, ASKED);
  expect(outcome.error).toBe(ALARM_ALREADY_ACKNOWLEDGED);
  expect(h.stored).toEqual([]);
}

/** A target that carries no alarm fails closed. */
export async function anAckWithNoAlarmReadFailsClosed(): Promise<void> {
  const h = proposeHarness({ target: { ...BASE, targetName: "MCC-1" } });
  expect((await h.call("propose_alarm_acknowledge", { id: ALARM, body: { reason: "Panel checked" } }, ASKED)).ok).toBe(false);
  expect(h.stored).toEqual([]);
}

/** DC6: a closed work order's status change is refused with the route's sentence. */
export async function aClosedWorkOrderStatusChangeIsRefused(): Promise<void> {
  const closed = { ...WORK_ORDER_TARGET, workOrder: { title: "Check the breaker", status: "closed", assetName: "MCC-1" } };
  const h = proposeHarness({ target: closed });
  expect((await h.call("propose_workOrder_setStatus", { id: WO_1, body: { status: "open" } })).error).toBe(WORK_ORDER_CLOSED);
}

/** DC6: a closed work order's close is refused with the route's sentence. */
export async function aClosedWorkOrderCloseIsRefused(): Promise<void> {
  const closed = { ...WORK_ORDER_TARGET, workOrder: { title: "Check the breaker", status: "closed", assetName: "MCC-1" } };
  const h = proposeHarness({ target: closed });
  expect((await h.call("propose_workOrder_close", { id: WO_1, body: { reason: "Repaired and tested" } }, ASKED)).error).toBe(WORK_ORDER_CLOSED);
}

/** A stored close is `operational`, with the reason in the body. */
export async function aStoredCloseIsOperational(): Promise<void> {
  const h = proposeHarness({ target: WORK_ORDER_TARGET });
  expect((await h.call("propose_workOrder_close", { id: WO_1, body: { reason: "Repaired and tested" } }, ASKED)).ok).toBe(true);
  expect(h.stored[0]).toMatchObject({ risk: "operational", body: { reason: "Repaired and tested" } });
}

/** Decision 2: the status tool refuses `closed` — a close carries a reason through its own route. */
export async function theStatusToolRefusesClosed(): Promise<void> {
  const h = proposeHarness({ target: WORK_ORDER_TARGET });
  const outcome = await h.call("propose_workOrder_setStatus", { id: WO_1, body: { status: "closed" } });
  expect(outcome.error).toMatch(/^Invalid body: /);
}

/** The status card says where the work order moves from and to. */
export async function theStatusSummaryNamesFromAndTo(): Promise<void> {
  const h = proposeHarness({ target: WORK_ORDER_TARGET });
  await h.call("propose_workOrder_setStatus", { id: WO_1, body: { status: "in_progress" } });
  expect(h.stored[0]?.summary).toContain("from open to in progress");
}

/** DC6: a reorder that reopens a closed work order is refused with the route's sentence. */
export async function aReorderThatReopensIsRefused(): Promise<void> {
  const h = proposeHarness({ target: BATCH_TARGET });
  const items = [{ id: WO_2, status: "open", sortOrder: 0 }];
  expect((await h.call("propose_workOrder_reorder", { body: { items } })).error).toBe(WORK_ORDER_REOPEN);
}

/** DC6: a reorder that closes by drag is refused with the route's sentence. */
export async function aReorderThatClosesIsRefused(): Promise<void> {
  const h = proposeHarness({ target: BATCH_TARGET });
  const items = [{ id: WO_1, status: "closed", sortOrder: 0 }];
  expect((await h.call("propose_workOrder_reorder", { body: { items } })).error).toBe(WORK_ORDER_CLOSE_BY_DRAG);
}

/** A reorder naming one work order twice is refused with the route's sentence. */
export async function aReorderWithADuplicateIsRefused(): Promise<void> {
  const h = proposeHarness({ target: BATCH_TARGET });
  const items = [
    { id: WO_1, status: "assigned", sortOrder: 0 },
    { id: WO_1, status: "assigned", sortOrder: 1 },
  ];
  expect((await h.call("propose_workOrder_reorder", { body: { items } })).error).toBe(WORK_ORDER_DUPLICATE);
}

/** DC2: a good reorder stores the moves beside the body, and the hash leaves them out. */
export async function aReorderStoresItsMovesOutsideTheHash(): Promise<void> {
  const h = proposeHarness({ target: BATCH_TARGET });
  const body = { items: [{ id: WO_1, status: "assigned", sortOrder: 3 }, { id: WO_2, status: "closed", sortOrder: 0 }] };
  expect((await h.call("propose_workOrder_reorder", { body })).ok).toBe(true);
  expect(h.stored[0]?.body.moves).toEqual([
    { id: WO_1, title: "Check the breaker", fromStatus: "open", fromSortOrder: 0, toStatus: "assigned", toSortOrder: 3 },
  ]);
  expect(hashExcludedKeysOf(catalogEntry("workOrder.reorder")!)).toContain("moves");
  expect(h.stored[0]?.bodyHash).toBe(bodyHash(body, []));
}

/** DC6: an inactive schedule's convert is refused with the route's sentence. */
export async function anInactiveScheduleConvertIsRefused(): Promise<void> {
  const target = { ...BASE, targetName: "Quarterly check", convertible: { active: false, hasActiveWorkOrder: false } };
  const h = proposeHarness({ target });
  expect((await h.call("propose_maintenanceSchedule_convert", { id: SCHEDULE, body: {} })).error).toBe(SCHEDULE_NOT_CONVERTIBLE);
}

/** DC6: a schedule with an active work order is refused with the route's sentence. */
export async function aScheduleWithAWorkOrderIsRefused(): Promise<void> {
  const target = { ...BASE, targetName: "Quarterly check", convertible: { active: true, hasActiveWorkOrder: true } };
  const h = proposeHarness({ target });
  expect((await h.call("propose_maintenanceSchedule_convert", { id: SCHEDULE, body: {} })).error).toBe(SCHEDULE_HAS_WORK_ORDER);
}

/** A convertible schedule's convert is stored as a create. */
export async function aConvertIsStoredAsACreate(): Promise<void> {
  const target = { ...BASE, targetName: "Quarterly check", convertible: { active: true, hasActiveWorkOrder: false } };
  const h = proposeHarness({ target });
  expect((await h.call("propose_maintenanceSchedule_convert", { id: SCHEDULE, body: { notes: "Due this week" } })).ok).toBe(true);
  expect(h.stored[0]).toMatchObject({ risk: "create", body: { notes: "Due this week" } });
}

/** A tool result cannot pre-fill an acknowledge wizard: `fill_step` refuses it without the user's own words. */
export async function fillStepRefusesAnUnaskedAck(): Promise<void> {
  const h = proposeHarness({ target: ALARM_TARGET });
  const result = await h.tools.dispatch(
    "fill_step",
    { catalogId: "alarm.acknowledge", params: { id: ALARM }, stepId: "reason", values: { reason: "Panel checked" } },
    h.ctx({ operationalIntent: [] }),
  );
  expect(result.ok ? null : result.error).toBe(PROPOSE_OPERATIONAL_NOT_ASKED_ERROR);
}

/** Review of `F4.284`: a close word alone ("the closed work orders") never allows an acknowledge. */
export async function aCloseWordDoesNotAllowAnAck(): Promise<void> {
  const h = proposeHarness({ target: ALARM_TARGET });
  const args = { id: ALARM, body: { reason: "Panel checked" } };
  const outcome = await h.call("propose_alarm_acknowledge", args, { operationalIntent: ["workOrder.close"] });
  expect([outcome.error, h.stored]).toEqual([PROPOSE_OPERATIONAL_NOT_ASKED_ERROR, []]);
}

/** Review of `F4.284`: an ack word alone never allows a work-order close. */
export async function anAckWordDoesNotAllowAClose(): Promise<void> {
  const h = proposeHarness({ target: WORK_ORDER_TARGET });
  const args = { id: WO_1, body: { reason: "Repaired and tested" } };
  const outcome = await h.call("propose_workOrder_close", args, { operationalIntent: ["alarm.acknowledge"] });
  expect([outcome.error, h.stored]).toEqual([PROPOSE_OPERATIONAL_NOT_ASKED_ERROR, []]);
}

const namesFor = (operational: string[]): string[] =>
  proposeHarness().tools.registryFor({ access: true, role: "admin", operational }).definitions.map((d) => d.name);

/** The registry for a close word names the close tool and withholds the acknowledge. */
export function aCloseOnlyRegistryWithholdsTheAck(): void {
  const names = namesFor(["workOrder.close"]);
  expect([names.includes("propose_workOrder_close"), names.includes("propose_alarm_acknowledge")]).toEqual([true, false]);
}

/** The registry for an ack word names the acknowledge tool and withholds the close. */
export function anAckOnlyRegistryWithholdsTheClose(): void {
  const names = namesFor(["alarm.acknowledge"]);
  expect([names.includes("propose_alarm_acknowledge"), names.includes("propose_workOrder_close")]).toEqual([true, false]);
}

/** `fill_step` holds the per-entry switch too: a close word cannot pre-fill an acknowledge wizard. */
export async function fillStepRefusesAnAckOnACloseWord(): Promise<void> {
  const h = proposeHarness({ target: ALARM_TARGET });
  const result = await h.tools.dispatch(
    "fill_step",
    { catalogId: "alarm.acknowledge", params: { id: ALARM }, stepId: "reason", values: { reason: "Panel checked" } },
    h.ctx({ operationalIntent: ["workOrder.close"] }),
  );
  expect(result.ok ? null : result.error).toBe(PROPOSE_OPERATIONAL_NOT_ASKED_ERROR);
}

const ENRICHMENT_WIZARD = [{ catalogId: "alarm.enrichment.set", params: { id: ALARM }, name: "MCC-1", organizationId: ORG_X }];

/** Owner ruling 2026-10-25 (Q4), replacing DC4: `fill_step` fills a `skillCode` for the enrichment wizard. */
export async function fillStepFillsASkillCode(): Promise<void> {
  const h = proposeHarness({ target: ALARM_TARGET });
  const args = { catalogId: "alarm.enrichment.set", params: { id: ALARM }, stepId: "details", values: { skillCode: "electrical" } };
  const outcome = await h.call("fill_step", args, { openWizards: ENRICHMENT_WIZARD });
  expect(outcome.ok, outcome.content).toBe(true);
}

/** The propose tool stores an enrichment whose body names a skill code. */
export async function anEnrichmentWithASkillCodeIsStored(): Promise<void> {
  const h = proposeHarness({ target: ALARM_TARGET });
  const body = { rootCause: "Loose lug", skillCode: "electrical" };
  await h.call("propose_alarm_enrichment_set", { id: ALARM, body });
  expect(h.stored[0]?.body).toEqual(body);
}

/** The same step's other fields fill too. */
export async function fillStepFillsTheEnrichmentDetails(): Promise<void> {
  const h = proposeHarness({ target: ALARM_TARGET });
  const args = { catalogId: "alarm.enrichment.set", params: { id: ALARM }, stepId: "details", values: { affectedAssetIds: [ASSET] } };
  const outcome = await h.call("fill_step", args, { openWizards: ENRICHMENT_WIZARD });
  expect(outcome.ok, outcome.content).toBe(true);
}

/** DC1 / ADR 0099 decision 4.4: a create's card names the assignee the resolver read. */
export async function theCreateCardNamesTheAssignee(): Promise<void> {
  const h = proposeHarness({ target: { ...BASE, targetName: "MCC-1", refName: "Asha Rao" } });
  const body = { assetId: ASSET, title: "Check the breaker", priority: "high", assignedTo: USER };
  const outcome = await h.call("propose_workOrder_create", { body });
  expect(outcome.ok, outcome.content).toBe(true);
  expect(h.stored[0]?.summary).toContain("assigned to Asha Rao");
}
