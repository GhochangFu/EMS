import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import { OnboardingService } from "./onboarding.service";

/**
 * `F3.86` PR 5 (code review, false green 2) — the copilot's onboarding skill
 * starts through the real `OnboardingService.createSession`, whose
 * `assertOnboardingAccess` is the skill's role gate (ADR 0099 decision 7): a
 * location or asset-group administrator, or an organization outside the
 * caller's scope, is a 403 before any database read; an organization
 * administrator passes the gate (the positive control — the fixture has no
 * organization row, so the next step answers 404). Vitest entry point: the
 * sibling `.test.ts` (ADR 0014).
 */

type Role = "admin" | "organization_admin" | "location_admin" | "asset_group_admin";
const JWT = { sub: "kc-1" } as never;

function serviceAs(role: Role, canManage = true) {
  const reads = { select: 0 };
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve([]),
  };
  const db = {
    select: () => {
      reads.select += 1;
      return selectChain;
    },
  };
  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role }),
    canManageOrganization: () => Promise.resolve(canManage),
  };
  const none = {} as never;
  const service = new OnboardingService(db as never, db as never, accessControl as never, none, none, none, none, none, none, none);
  return { service, reads };
}

/** A location or asset-group administrator is refused before any read. */
export async function aScopedAdminCannotStartAnOnboarding(): Promise<void> {
  for (const role of ["location_admin", "asset_group_admin"] as const) {
    const { service, reads } = serviceAs(role);
    await expect(service.createSession(JWT, "org-1")).rejects.toThrow(
      new ForbiddenException("Onboarding requires admin or organization_admin role"),
    );
    expect(reads.select).toBe(0);
  }
}

/** An organization outside the caller's scope is refused before any read. */
export async function anOrganizationOutsideTheScopeIsRefused(): Promise<void> {
  const { service, reads } = serviceAs("organization_admin", false);
  await expect(service.createSession(JWT, "org-2")).rejects.toThrow(
    new ForbiddenException("Organization is outside your access scope"),
  );
  expect(reads.select).toBe(0);
}

/** The positive control: an organization administrator passes the gate and reaches the organization read. */
export async function anOrganizationAdminPassesTheGate(): Promise<void> {
  const { service, reads } = serviceAs("organization_admin");
  await expect(service.createSession(JWT, "org-1")).rejects.toBeInstanceOf(NotFoundException);
  expect(reads.select).toBe(1);
}
