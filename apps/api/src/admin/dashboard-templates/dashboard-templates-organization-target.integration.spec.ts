import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  NotImplementedException,
} from "@nestjs/common";
import { expect } from "vitest";

import { TEMPLATE_TARGET_BODY_MESSAGE } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type {
  DashboardTemplatesInstantiateService,
  OrganizationTemplateArm,
} from "./dashboard-templates-instantiate.service";
import { ORGANIZATION_ARM_NOT_WIRED_MESSAGE } from "./dashboard-templates-instantiate.service";

/**
 * `F4.317` task 3.4 — the instantiate service's organization arm, a seam only (ADR 0112 decision
 * 4). The copy action that fills it is `OrganizationLayoutService` (PR 4); this suite holds what
 * the service proves before it delegates: the published status and the body/target fit, the
 * body's organization being the template's own, authorship on the organization target (the
 * location admin's narrow grant), and the 501 while nothing provides the arm.
 *
 * One exported function per claim; `dashboard-templates-organization-target.integration.test.ts`
 * is the Vitest entry point and owns the fixtures (ADR 0014).
 */

/** The rejection a promise ends in, or `null` if it resolved. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (err: unknown) => err,
  );
}

/** A recording arm: every call is kept, and it answers `answer`. */
export function recordingArm(answer: object): {
  arm: OrganizationTemplateArm;
  calls: Parameters<OrganizationTemplateArm>[];
} {
  const calls: Parameters<OrganizationTemplateArm>[] = [];
  return {
    arm: async (...args) => {
      calls.push(args);
      return answer;
    },
    calls,
  };
}

/** No arm provided: the organization body answers 501 with the sentence that says so. */
export async function assertOrganizationArmAnswers501UntilWired(
  service: DashboardTemplatesInstantiateService,
  actor: JwtPayload,
  templateId: string,
  organizationId: string,
): Promise<void> {
  const err = await rejectionOf(service.instantiateOrganization(actor, templateId, { organizationId }));
  expect(err, "the unwired organization arm must answer 501").toBeInstanceOf(NotImplementedException);
  expect((err as Error).message).toBe(ORGANIZATION_ARM_NOT_WIRED_MESSAGE);
}

/** With an arm provided, it receives the template's id and organization and the body unchanged. */
export async function assertOrganizationArmReceivesTheTemplateAndBody(
  makeService: (arm: OrganizationTemplateArm) => DashboardTemplatesInstantiateService,
  actor: JwtPayload,
  templateId: string,
  organizationId: string,
): Promise<void> {
  const answer = { kind: "organization-layout" };
  const { arm, calls } = recordingArm(answer);
  const result = await makeService(arm).instantiateOrganization(actor, templateId, { organizationId });
  expect(result, "the arm's answer must be returned unchanged").toBe(answer);
  expect(calls.length, "the arm must be called exactly once").toBe(1);
  expect(calls[0]?.[1]).toEqual({ id: templateId, organizationId });
  expect(calls[0]?.[2]).toEqual({ organizationId });
}

/**
 * A body naming ANOTHER organization than the template's is a 404, and the arm is never reached:
 * a template copies into its own organization only, and the answer does not say whether the
 * other organization exists.
 */
export async function assertAForeignOrganizationIdIsA404(
  makeService: (arm: OrganizationTemplateArm) => DashboardTemplatesInstantiateService,
  actor: JwtPayload,
  templateId: string,
  foreignOrganizationId: string,
): Promise<void> {
  const { arm, calls } = recordingArm({});
  const err = await rejectionOf(
    makeService(arm).instantiateOrganization(actor, templateId, { organizationId: foreignOrganizationId }),
  );
  expect(err, "a foreign organizationId must answer 404").toBeInstanceOf(NotFoundException);
  expect(calls.length, "a refused body must never reach the arm").toBe(0);
}

/** ADR 0112 decision 5 — a location admin of the template's organization reaches the arm. */
export async function assertLocationAdminReachesTheOrganizationArm(
  makeService: (arm: OrganizationTemplateArm) => DashboardTemplatesInstantiateService,
  locationAdmin: JwtPayload,
  templateId: string,
  organizationId: string,
): Promise<void> {
  const { arm, calls } = recordingArm({});
  await makeService(arm).instantiateOrganization(locationAdmin, templateId, { organizationId });
  expect(calls.length, "a location admin of the organization must reach the organization arm").toBe(1);
}

/** An asset-group admin is no master-data role: refused before the arm. */
export async function assertAssetGroupAdminCannotReachTheOrganizationArm(
  makeService: (arm: OrganizationTemplateArm) => DashboardTemplatesInstantiateService,
  assetGroupAdmin: JwtPayload,
  templateId: string,
  organizationId: string,
): Promise<void> {
  const { arm, calls } = recordingArm({});
  const err = await rejectionOf(
    makeService(arm).instantiateOrganization(assetGroupAdmin, templateId, { organizationId }),
  );
  expect(err, "an asset-group admin must be refused the organization arm").toBeInstanceOf(ForbiddenException);
  expect(calls.length, "a refused caller must never reach the organization arm").toBe(0);
}

/** An organization body on an asset-group template is refused by the stored target: 400. */
export async function assertOrganizationBodyOnGroupTemplateIsRefused(
  service: DashboardTemplatesInstantiateService,
  actor: JwtPayload,
  groupTemplateId: string,
  organizationId: string,
): Promise<void> {
  const err = await rejectionOf(service.instantiateOrganization(actor, groupTemplateId, { organizationId }));
  expect(err, "an organization body on a group template must answer 400").toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(TEMPLATE_TARGET_BODY_MESSAGE);
}

/** Only a published version instantiates: a draft organization template answers 409. */
export async function assertADraftOrganizationTemplateIsRefused(
  service: DashboardTemplatesInstantiateService,
  actor: JwtPayload,
  draftTemplateId: string,
  organizationId: string,
): Promise<void> {
  const err = await rejectionOf(service.instantiateOrganization(actor, draftTemplateId, { organizationId }));
  expect((err as Error | null)?.message ?? "").toMatch(/Only a published template can be instantiated/);
}
