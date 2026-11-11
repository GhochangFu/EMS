import "reflect-metadata";

import { BadRequestException, ForbiddenException, NotFoundException, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import type {
  JwtPayload,
  UserRole,
  WorkOrderChecklistTemplateDto,
  WorkOrderChecklistTemplatesResponse,
} from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import { canPerformOperationsWrite, operationsWriteDenialReason, type OperationsWriteClass } from "../../auth/operations-write";
import { WorkOrderChecklistTemplatesAdminController } from "./work-order-checklist-templates.controller";
import type { WorkOrderChecklistTemplatesAdminService } from "./work-order-checklist-templates.service";

/**
 * `E3.1` (ADR 0122 decision 4.2, plan T3.3) — the checklist template admin controller
 * against a stubbed access-control service and a stubbed service. Assertions live here;
 * the sibling `.test.ts` runs them (ADR 0014). The real roles and the real tables are the
 * integration suite's.
 */

/** The organization the stubbed `organization_admin` administers. */
const ORG_A = "11111111-1111-4111-8111-111111111111";
/** An organization the stubbed `organization_admin` does not administer. */
const ORG_B = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_OF_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEMPLATE_OF_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MISSING_TEMPLATE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const TEMPLATE: WorkOrderChecklistTemplateDto = {
  id: TEMPLATE_OF_A,
  organizationId: ORG_A,
  name: "Chiller quarterly",
  domain: null,
  active: true,
  items: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "Check oil level", mandatory: true, sortOrder: 1 }],
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
};
const LIST: WorkOrderChecklistTemplatesResponse = { items: [TEMPLATE] };

function user(role: UserRole): JwtPayload {
  return { sub: `sub-${role}`, email: `${role}@bms.local`, name: role, role };
}

type Harness = {
  controller: WorkOrderChecklistTemplatesAdminController;
  /** Every gate and service call, in the order it ran. */
  calls: string[];
};

/**
 * The role gate answers from the real ADR 0017 matrix. The organization gate answers
 * `true` for `admin` everywhere and for `organization_admin` in A only, which is what the
 * real one does for an organization admin of A. `organizationOf` knows one template in A
 * and one in B; any other id names no template.
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
      return jwt.role === "admin" || (jwt.role === "organization_admin" && organizationId === ORG_A);
    },
  } as unknown as AccessControlService;
  const owners = new Map([
    [TEMPLATE_OF_A, ORG_A],
    [TEMPLATE_OF_B, ORG_B],
  ]);
  const service = {
    async list(organizationId: string): Promise<WorkOrderChecklistTemplatesResponse> {
      calls.push(`list:${organizationId}`);
      return LIST;
    },
    async create(): Promise<WorkOrderChecklistTemplateDto> {
      calls.push("create");
      return TEMPLATE;
    },
    async update(_actor: unknown, id: string): Promise<WorkOrderChecklistTemplateDto> {
      calls.push(`update:${id}`);
      return TEMPLATE;
    },
    async organizationOf(id: string): Promise<string | null> {
      calls.push(`organizationOf:${id}`);
      return owners.get(id) ?? null;
    },
  } as unknown as WorkOrderChecklistTemplatesAdminService;
  return { controller: new WorkOrderChecklistTemplatesAdminController(access, service), calls };
}

const VALID_CREATE = {
  organizationId: ORG_A,
  name: "Chiller quarterly",
  items: [{ title: "Check oil level", mandatory: true }],
};
/** Invalid on every count: a stray key, a bad uuid, a two-letter name, no items. */
const INVALID_CREATE = { organizationId: "nope", name: "ab", items: [], extra: 1 };
const VALID_UPDATE = { active: false };
/** A stray key and nothing to change. */
const INVALID_UPDATE = { extra: 1 };

/** The routes sit where the ADR's table says: `GET`, `POST`, `PATCH :id` of `admin/work-order-checklist-templates`. */
export function theRoutesAreWhereTheAdrSays(): void {
  expect(Reflect.getMetadata(PATH_METADATA, WorkOrderChecklistTemplatesAdminController)).toBe(
    "admin/work-order-checklist-templates",
  );
  const proto = WorkOrderChecklistTemplatesAdminController.prototype;
  expect(Reflect.getMetadata(METHOD_METADATA, proto.list)).toBe(RequestMethod.GET);
  expect(Reflect.getMetadata(METHOD_METADATA, proto.create)).toBe(RequestMethod.POST);
  expect(Reflect.getMetadata(METHOD_METADATA, proto.update)).toBe(RequestMethod.PATCH);
  expect(Reflect.getMetadata(PATH_METADATA, proto.update)).toBe(":id");
}

/** An `operator` and a `viewer` are refused on `POST` and `PATCH` before the body is parsed: an invalid body still reads 403. */
export async function anOperatorOrViewerIsRefusedBeforeTheBodyIsParsed(): Promise<void> {
  for (const role of ["operator", "viewer"] as const) {
    const post = harness();
    await expect(post.controller.create(user(role), INVALID_CREATE), `${role} POST`).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(post.calls, `${role} POST: the role gate ran and nothing after it`).toEqual(["role:configuration"]);

    const patch = harness();
    await expect(
      patch.controller.update(user(role), "not-a-uuid", INVALID_UPDATE),
      `${role} PATCH`,
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(patch.calls, `${role} PATCH: the role gate ran and nothing after it`).toEqual(["role:configuration"]);
  }
}

/** A `location_admin` passes the role gate and is refused by the organization check on `POST` (403), before the service. */
export async function aLocationAdminIsRefusedByTheOrganizationCheck(): Promise<void> {
  const { controller, calls } = harness();
  await expect(controller.create(user("location_admin"), VALID_CREATE)).rejects.toBeInstanceOf(ForbiddenException);
  expect(calls).toEqual(["role:configuration", `organization:${ORG_A}`]);
}

/** An admin's invalid body is 400 after the role gate and before the organization check; so is a bad `:id`. */
export async function anInvalidBodyOrIdFromAnAdminIs400(): Promise<void> {
  const post = harness();
  await expect(post.controller.create(user("admin"), INVALID_CREATE)).rejects.toBeInstanceOf(BadRequestException);
  expect(post.calls).toEqual(["role:configuration"]);

  const badBody = harness();
  await expect(badBody.controller.update(user("admin"), TEMPLATE_OF_A, INVALID_UPDATE)).rejects.toBeInstanceOf(
    BadRequestException,
  );
  expect(badBody.calls).toEqual(["role:configuration"]);

  const badId = harness();
  await expect(badId.controller.update(user("admin"), "not-a-uuid", VALID_UPDATE)).rejects.toBeInstanceOf(
    BadRequestException,
  );
  expect(badId.calls, "a malformed id costs no organization read").toEqual(["role:configuration"]);
}

/**
 * `PATCH` for a template in an organization the caller does not administer, and for a
 * template that does not exist, answer the same 404 with the same message (F4.64), and
 * the service's `update` never runs.
 */
export async function aForeignOrMissingTemplateIsTheSame404(): Promise<void> {
  const refusals: NotFoundException[] = [];

  const foreign = harness();
  const foreignError = await foreign.controller
    .update(user("organization_admin"), TEMPLATE_OF_B, VALID_UPDATE)
    .then(() => null, (err: unknown) => err);
  expect(foreignError, "a template of B, for A's organization admin").toBeInstanceOf(NotFoundException);
  refusals.push(foreignError as NotFoundException);
  expect(foreign.calls).toEqual(["role:configuration", `organizationOf:${TEMPLATE_OF_B}`, `organization:${ORG_B}`]);

  const missing = harness();
  const missingError = await missing.controller
    .update(user("organization_admin"), MISSING_TEMPLATE, VALID_UPDATE)
    .then(() => null, (err: unknown) => err);
  expect(missingError, "a template that does not exist").toBeInstanceOf(NotFoundException);
  refusals.push(missingError as NotFoundException);
  expect(missing.calls, "no organization to check, so no organization read").toEqual([
    "role:configuration",
    `organizationOf:${MISSING_TEMPLATE}`,
  ]);

  expect(refusals[0]?.message, "the refusal does not confirm the id exists").toBe(refusals[1]?.message);
  expect(refusals[0]?.message).toBe("Checklist template not found");
}

/** A valid `POST` and `PATCH` run the gates in order, then the service, and answer its value. */
export async function aValidWriteRunsTheGatesInOrderThenTheService(): Promise<void> {
  const post = harness();
  await expect(post.controller.create(user("organization_admin"), VALID_CREATE)).resolves.toEqual(TEMPLATE);
  expect(post.calls).toEqual(["role:configuration", `organization:${ORG_A}`, "create"]);

  const patch = harness();
  await expect(patch.controller.update(user("organization_admin"), TEMPLATE_OF_A, VALID_UPDATE)).resolves.toEqual(
    TEMPLATE,
  );
  expect(patch.calls).toEqual([
    "role:configuration",
    `organizationOf:${TEMPLATE_OF_A}`,
    `organization:${ORG_A}`,
    `update:${TEMPLATE_OF_A}`,
  ]);
}

/** `GET` answers the service's value behind the organization check; a non-uuid is 400; every scoped role is 403. */
export async function listAnswersTheServiceValueBehindTheOrganizationCheck(): Promise<void> {
  const ok = harness();
  await expect(ok.controller.list(user("organization_admin"), ORG_A)).resolves.toEqual(LIST);
  expect(ok.calls).toEqual([`organization:${ORG_A}`, `list:${ORG_A}`]);

  const bad = harness();
  await expect(bad.controller.list(user("admin"), "not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
  expect(bad.calls, "a malformed id costs no gate read").toEqual([]);

  for (const role of ["location_admin", "asset_group_admin", "operator", "viewer"] as const) {
    const refused = harness();
    await expect(refused.controller.list(user(role), ORG_A), role).rejects.toBeInstanceOf(ForbiddenException);
    expect(refused.calls, `${role} never reaches the service`).toEqual([`organization:${ORG_A}`]);
  }
}
