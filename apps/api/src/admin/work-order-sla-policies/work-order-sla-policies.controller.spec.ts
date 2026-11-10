import "reflect-metadata";

import { BadRequestException, ForbiddenException, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import type { JwtPayload, UserRole, WorkOrderSlaPoliciesResponse } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import { canPerformOperationsWrite, operationsWriteDenialReason, type OperationsWriteClass } from "../../auth/operations-write";
import { WorkOrderSlaPoliciesAdminController } from "./work-order-sla-policies.controller";
import type { WorkOrderSlaPoliciesAdminService } from "./work-order-sla-policies.service";

/**
 * `E3.1` (ADR 0122 decision 3.2, plan T1.6) — the SLA policy admin controller against a
 * stubbed access-control service and a stubbed service. Assertions live here; the sibling
 * `.test.ts` runs them (ADR 0014). The real roles are the integration suite's.
 */

const ORG_A = "11111111-1111-4111-8111-111111111111";

const RESPONSE: WorkOrderSlaPoliciesResponse = {
  organizationId: ORG_A,
  items: [
    { priority: "critical", resolutionMinutes: 30, source: "default" },
    { priority: "high", resolutionMinutes: 45, source: "organization" },
    { priority: "medium", resolutionMinutes: 240, source: "default" },
    { priority: "low", resolutionMinutes: 1440, source: "default" },
  ],
};

function user(role: UserRole): JwtPayload {
  return { sub: `sub-${role}`, email: `${role}@bms.local`, name: role, role };
}

type Harness = {
  controller: WorkOrderSlaPoliciesAdminController;
  /** Every gate and service call, in the order it ran. */
  calls: string[];
};

/**
 * The role gate answers from the real ADR 0017 matrix; the organization gate answers `true`
 * only for `admin` and `organization_admin`, which is what the real one does for the actor's
 * own organization.
 */
function harness(): Harness {
  const calls: string[] = [];
  const access = {
    async assertOperationsWriteRole(jwt: JwtPayload, writeClass: OperationsWriteClass): Promise<void> {
      calls.push(`role:${writeClass}`);
      if (!canPerformOperationsWrite(jwt.role, writeClass)) {
        throw new ForbiddenException(operationsWriteDenialReason(writeClass));
      }
    },
    async isOrganizationLevelAdmin(jwt: JwtPayload, organizationId: string): Promise<boolean> {
      calls.push(`organization:${organizationId}`);
      return jwt.role === "admin" || jwt.role === "organization_admin";
    },
  } as unknown as AccessControlService;
  const service = {
    async get(organizationId: string): Promise<WorkOrderSlaPoliciesResponse> {
      calls.push(`get:${organizationId}`);
      return RESPONSE;
    },
    async put(): Promise<WorkOrderSlaPoliciesResponse> {
      calls.push("put");
      return RESPONSE;
    },
  } as unknown as WorkOrderSlaPoliciesAdminService;
  return { controller: new WorkOrderSlaPoliciesAdminController(access, service), calls };
}

const VALID_BODY = { organizationId: ORG_A, policies: [{ priority: "high", resolutionMinutes: 45 }] };
/** Invalid on every count: a stray key, a bad uuid, a zero minute. */
const INVALID_BODY = { organizationId: "nope", policies: [{ priority: "high", resolutionMinutes: 0 }], extra: 1 };

/** The routes sit where the plan says: `GET` and `PUT /admin/work-order-sla-policies`. */
export function theRoutesAreWhereThePlanSays(): void {
  expect(Reflect.getMetadata(PATH_METADATA, WorkOrderSlaPoliciesAdminController)).toBe("admin/work-order-sla-policies");
  const proto = WorkOrderSlaPoliciesAdminController.prototype;
  expect(Reflect.getMetadata(METHOD_METADATA, proto.get)).toBe(RequestMethod.GET);
  expect(Reflect.getMetadata(METHOD_METADATA, proto.put)).toBe(RequestMethod.PUT);
}

/** An `operator` and a `viewer` are refused on `PUT` before the body is parsed: an invalid body still reads 403. */
export async function aPutFromAnOperatorOrViewerIsRefusedBeforeTheBodyIsParsed(): Promise<void> {
  for (const role of ["operator", "viewer"] as const) {
    const { controller, calls } = harness();
    await expect(controller.put(user(role), INVALID_BODY), `${role} is refused by role`).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(calls, `${role}: the role gate ran and nothing after it`).toEqual(["role:configuration"]);
  }
}

/** A `location_admin` passes the role gate and is refused by the organization check (403), before the service. */
export async function aPutFromALocationAdminIsRefusedByTheOrganizationCheck(): Promise<void> {
  const { controller, calls } = harness();
  await expect(controller.put(user("location_admin"), VALID_BODY)).rejects.toBeInstanceOf(ForbiddenException);
  expect(calls).toEqual(["role:configuration", `organization:${ORG_A}`]);
}

/** An admin's invalid body is a 400, after the role gate and before the organization check. */
export async function anInvalidBodyFromAnAdminIs400(): Promise<void> {
  const { controller, calls } = harness();
  await expect(controller.put(user("admin"), INVALID_BODY)).rejects.toBeInstanceOf(BadRequestException);
  expect(calls).toEqual(["role:configuration"]);
  const tooMany = {
    organizationId: ORG_A,
    policies: [
      { priority: "high", resolutionMinutes: 45 },
      { priority: "high", resolutionMinutes: 50 },
    ],
  };
  await expect(controller.put(user("admin"), tooMany), "a repeated priority").rejects.toBeInstanceOf(BadRequestException);
}

/** An admin's valid `PUT` runs the three gates in order, then the service, and answers its value. */
export async function aValidPutRunsTheGatesInOrderThenTheService(): Promise<void> {
  const { controller, calls } = harness();
  await expect(controller.put(user("organization_admin"), VALID_BODY)).resolves.toEqual(RESPONSE);
  expect(calls).toEqual(["role:configuration", `organization:${ORG_A}`, "put"]);
}

/** `GET` answers the service's value for an organization admin; a non-uuid is 400; a `location_admin` is 403. */
export async function getAnswersTheServiceValueBehindTheOrganizationCheck(): Promise<void> {
  const ok = harness();
  await expect(ok.controller.get(user("organization_admin"), ORG_A)).resolves.toEqual(RESPONSE);
  expect(ok.calls).toEqual([`organization:${ORG_A}`, `get:${ORG_A}`]);

  const bad = harness();
  await expect(bad.controller.get(user("admin"), "not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
  expect(bad.calls, "a malformed id costs no gate read").toEqual([]);

  for (const role of ["location_admin", "asset_group_admin", "operator", "viewer"] as const) {
    const refused = harness();
    await expect(refused.controller.get(user(role), ORG_A), role).rejects.toBeInstanceOf(ForbiddenException);
    expect(refused.calls, `${role} never reaches the service`).toEqual([`organization:${ORG_A}`]);
  }
}
