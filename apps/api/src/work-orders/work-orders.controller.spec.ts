import "reflect-metadata";

import { BadRequestException, ForbiddenException, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import type { JwtPayload, UserRole } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import {
  canOverrideWorkOrderSla,
  canPerformOperationsWrite,
  operationsWriteDenialReason,
  type OperationsWriteClass,
  WORK_ORDER_SLA_OVERRIDE_DENIAL,
} from "../auth/operations-write";
import type { WorkOrderFindingsService } from "./work-order-findings.service";
import type { WorkOrderTaskAddService } from "./work-order-task-add.service";
import type { WorkOrderTasksService } from "./work-order-tasks.service";
import { WorkOrdersController } from "./work-orders.controller";
import type { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.1` (ADR 0122 decisions 3.2, 4 and 10) — the work-order controller against stubbed
 * gates and stubbed services: who may send the per-ticket SLA override (owner ruling,
 * 2026-11-11), the gate order of the two checklist routes, and where the literal
 * `checklist-templates` read is declared. Assertions live here; the sibling `.test.ts`
 * runs them (ADR 0014). The real roles are the integration suites'.
 */

const ASSET_ID = "30000000-0000-4000-8000-000000000001";
const WORK_ORDER_ID = "50000000-0000-4000-8000-000000000001";
const TASK_ID = "60000000-0000-4000-8000-000000000001";

const ALL_ROLES: readonly UserRole[] = ["admin", "organization_admin", "location_admin", "asset_group_admin", "operator", "viewer"];

function user(role: UserRole): JwtPayload {
  return { sub: `sub-${role}`, email: `${role}@bms.local`, name: role, role };
}

type Harness = {
  controller: WorkOrdersController;
  /** Every gate and service call, in the order it ran. */
  calls: string[];
};

/** The gates answer from the real matrix and the real SLA predicate, on the token's role. */
function harness(): Harness {
  const calls: string[] = [];
  const access = {
    async assertOperationsWriteRole(jwt: JwtPayload, writeClass: OperationsWriteClass): Promise<void> {
      calls.push(`role:${writeClass}`);
      if (!canPerformOperationsWrite(jwt.role, writeClass)) {
        throw new ForbiddenException(operationsWriteDenialReason(writeClass));
      }
    },
    async assertWorkOrderSlaOverrideRole(jwt: JwtPayload): Promise<void> {
      calls.push("sla-override");
      if (!canOverrideWorkOrderSla(jwt.role)) {
        throw new ForbiddenException(WORK_ORDER_SLA_OVERRIDE_DENIAL);
      }
    },
    async readableAssetIds(): Promise<string[] | null> {
      calls.push("scope");
      return [ASSET_ID];
    },
  } as unknown as AccessControlService;
  const workOrders = {
    async create(dto: { slaMinutes?: number }): Promise<{ id: string }> {
      calls.push(`create:${dto.slaMinutes ?? "policy"}`);
      return { id: WORK_ORDER_ID };
    },
  } as unknown as WorkOrdersService;
  const tasks = {
    async updateTask(): Promise<{ id: string }> {
      calls.push("updateTask");
      return { id: TASK_ID };
    },
    async listTemplatesForAsset(assetId: string, assetIds: string[] | null): Promise<{ items: never[] }> {
      calls.push(`templates:${assetId}:${JSON.stringify(assetIds)}`);
      return { items: [] };
    },
  } as unknown as WorkOrderTasksService;
  const taskAdd = {
    async addTask(): Promise<{ id: string }> {
      calls.push("addTask");
      return { id: TASK_ID };
    },
  } as unknown as WorkOrderTaskAddService;
  const findings = {
    async putRootCause(): Promise<{ id: string }> {
      calls.push("putRootCause");
      return { id: WORK_ORDER_ID };
    },
    async listCauseCodes(): Promise<{ items: never[] }> {
      calls.push("causeCodes");
      return { items: [] };
    },
  } as unknown as WorkOrderFindingsService;
  return { controller: new WorkOrdersController(workOrders, access, tasks, taskAdd, findings), calls };
}

const CREATE = { assetId: ASSET_ID, title: "Replace bearing" };

/** The predicate itself: the four admin roles may override the SLA; an operator and a viewer may not. */
export function onlyTheFourAdminRolesMayOverrideTheSla(): void {
  expect(ALL_ROLES.filter((role) => canOverrideWorkOrderSla(role))).toEqual([
    "admin",
    "organization_admin",
    "location_admin",
    "asset_group_admin",
  ]);
}

/** An operator who sends `slaMinutes` is refused with 403 and the fixed sentence, and nothing is created. */
export async function anOperatorSendingSlaMinutesIsRefused(): Promise<void> {
  const { controller, calls } = harness();
  const attempt = controller.create({ ...CREATE, slaMinutes: 45 }, user("operator"));
  await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
  await expect(attempt).rejects.toThrow(WORK_ORDER_SLA_OVERRIDE_DENIAL);
  expect(calls.filter((call) => call.startsWith("create")), "the service was never called").toEqual([]);
  expect(calls.slice(0, 2)).toEqual(["role:operational", "sla-override"]);
}

/** An operator who sends no `slaMinutes` creates the ticket, and the SLA gate is not even asked. */
export async function anOperatorWithoutSlaMinutesCreatesTheTicket(): Promise<void> {
  const { controller, calls } = harness();
  await expect(controller.create(CREATE, user("operator"))).resolves.toEqual({ id: WORK_ORDER_ID });
  expect(calls).toEqual(["role:operational", "scope", "create:policy"]);
}

/** Each of the four admin roles may send `slaMinutes`, and the service receives it. */
export async function anAdminRoleMaySendSlaMinutes(): Promise<void> {
  for (const role of ["admin", "organization_admin", "location_admin", "asset_group_admin"] as const) {
    const { controller, calls } = harness();
    await expect(controller.create({ ...CREATE, slaMinutes: 45 }, user(role)), role).resolves.toEqual({ id: WORK_ORDER_ID });
    expect(calls, role).toEqual(["role:operational", "sla-override", "scope", "create:45"]);
  }
}

/** An operator's malformed `slaMinutes` is a 400: the body is parsed before the SLA gate reads a role. */
export async function aMalformedSlaIsA400BeforeTheSlaGate(): Promise<void> {
  const { controller, calls } = harness();
  await expect(controller.create({ ...CREATE, slaMinutes: 0 }, user("operator"))).rejects.toBeInstanceOf(BadRequestException);
  expect(calls).toEqual(["role:operational"]);
}

/** A viewer is refused on both checklist routes by the role gate, before the ids and the body are parsed. */
export async function aViewerIsRefusedOnTheChecklistRoutesBeforeTheBodyIsParsed(): Promise<void> {
  const add = harness();
  await expect(add.controller.addTask("not-a-uuid", { nope: true }, user("viewer"))).rejects.toBeInstanceOf(ForbiddenException);
  expect(add.calls).toEqual(["role:operational"]);

  const update = harness();
  await expect(update.controller.updateTask("not-a-uuid", "nor-this", { nope: true }, user("viewer"))).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  expect(update.calls).toEqual(["role:operational"]);
}

/** An operator may add and tick a checklist item; a bad id or body is a 400 and reaches no service. */
export async function anOperatorMayWriteTheChecklist(): Promise<void> {
  const ok = harness();
  await expect(ok.controller.addTask(WORK_ORDER_ID, { title: "Check the oil level" }, user("operator"))).resolves.toEqual({ id: TASK_ID });
  await expect(ok.controller.updateTask(WORK_ORDER_ID, TASK_ID, { result: "done" }, user("operator"))).resolves.toEqual({ id: TASK_ID });
  expect(ok.calls).toEqual(["role:operational", "scope", "addTask", "role:operational", "scope", "updateTask"]);

  const bad = harness();
  await expect(bad.controller.addTask(WORK_ORDER_ID, { title: "x" }, user("operator"))).rejects.toBeInstanceOf(BadRequestException);
  await expect(bad.controller.updateTask(WORK_ORDER_ID, "not-a-uuid", { result: "done" }, user("operator"))).rejects.toBeInstanceOf(
    BadRequestException,
  );
  await expect(bad.controller.updateTask(WORK_ORDER_ID, TASK_ID, {}, user("operator"))).rejects.toBeInstanceOf(BadRequestException);
  expect(bad.calls).toEqual(["role:operational", "role:operational", "role:operational"]);
}

/** The template list is a read for anyone signed in — a viewer included — behind the caller's asset scope. */
export async function theTemplateListIsAReadBehindTheAssetScope(): Promise<void> {
  const { controller, calls } = harness();
  await expect(controller.listChecklistTemplates(user("viewer"), ASSET_ID)).resolves.toEqual({ items: [] });
  expect(calls, "no operations write gate, no admin gate").toEqual(["scope", `templates:${ASSET_ID}:["${ASSET_ID}"]`]);

  const bad = harness();
  await expect(bad.controller.listChecklistTemplates(user("operator"), "nope")).rejects.toBeInstanceOf(BadRequestException);
  await expect(bad.controller.listChecklistTemplates(user("operator"), undefined)).rejects.toBeInstanceOf(BadRequestException);
  expect(bad.calls).toEqual([]);
}

/**
 * Nest matches `GET` routes in declaration order, so the literal `checklist-templates`
 * must be declared before `:id` (plan D13). Method order on the prototype is
 * declaration order.
 */
export function theLiteralReadIsDeclaredAboveTheIdRead(): void {
  const proto = WorkOrdersController.prototype;
  const gets = Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor")
    .filter((name) => Reflect.getMetadata(METHOD_METADATA, proto[name as keyof WorkOrdersController]) === RequestMethod.GET)
    .map((name) => Reflect.getMetadata(PATH_METADATA, proto[name as keyof WorkOrdersController]) as string);
  expect(gets).toContain(":id");
  for (const literal of ["checklist-templates", "cause-codes"]) {
    expect(gets, literal).toContain(literal);
    expect(gets.indexOf(literal), `${literal} is declared above :id`).toBeLessThan(gets.indexOf(":id"));
  }
}

/** The two checklist routes sit where ADR 0122 decision 10 says. */
export function theChecklistRoutesAreWhereTheAdrSays(): void {
  const proto = WorkOrdersController.prototype;
  expect([Reflect.getMetadata(METHOD_METADATA, proto.addTask), Reflect.getMetadata(PATH_METADATA, proto.addTask)]).toEqual([
    RequestMethod.POST,
    ":id/tasks",
  ]);
  expect([Reflect.getMetadata(METHOD_METADATA, proto.updateTask), Reflect.getMetadata(PATH_METADATA, proto.updateTask)]).toEqual([
    RequestMethod.PATCH,
    ":id/tasks/:taskId",
  ]);
}

const ROOT_CAUSE = { rootCause: "Bearing worn out", correctiveAction: "Bearing replaced", causeCode: "wear_and_tear" };

/** The root-cause route is operational: a viewer is refused before the id and the body are parsed, an operator may write. */
export async function theRootCauseRouteIsOperational(): Promise<void> {
  const refused = harness();
  await expect(refused.controller.putRootCause("not-a-uuid", { nope: true }, user("viewer"))).rejects.toBeInstanceOf(ForbiddenException);
  expect(refused.calls).toEqual(["role:operational"]);

  const ok = harness();
  await expect(ok.controller.putRootCause(WORK_ORDER_ID, ROOT_CAUSE, user("operator"))).resolves.toEqual({ id: WORK_ORDER_ID });
  expect(ok.calls).toEqual(["role:operational", "scope", "putRootCause"]);
  const proto = WorkOrdersController.prototype;
  expect([Reflect.getMetadata(METHOD_METADATA, proto.putRootCause), Reflect.getMetadata(PATH_METADATA, proto.putRootCause)]).toEqual([
    RequestMethod.PUT,
    ":id/root-cause",
  ]);
}

/** A root-cause body that carries a snapshot key, or lacks a required one, is a 400 and reaches no service. */
export async function aBadRootCauseBodyIs400(): Promise<void> {
  const { controller, calls } = harness();
  for (const body of [{ ...ROOT_CAUSE, alarmRootCause: "forged" }, { rootCause: "Bearing worn out" }, { ...ROOT_CAUSE, rootCause: "x" }]) {
    await expect(controller.putRootCause(WORK_ORDER_ID, body, user("operator"))).rejects.toBeInstanceOf(BadRequestException);
  }
  expect(calls).toEqual(["role:operational", "role:operational", "role:operational"]);
}

/** The cause-code list is a read with no gate at all beyond the sign-in guard. */
export async function theCauseCodeListIsAPlainRead(): Promise<void> {
  const { controller, calls } = harness();
  await expect(controller.listCauseCodes()).resolves.toEqual({ items: [] });
  expect(calls).toEqual(["causeCodes"]);
}
