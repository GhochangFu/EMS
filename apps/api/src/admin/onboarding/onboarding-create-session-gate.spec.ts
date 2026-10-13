import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect, vi } from "vitest";

import { rememberIdentity, type ResolvedIdentity } from "../../auth/identity-resolver";
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

/**
 * `F4.255` (ADR 0099 Amendment 2 A1) — `createSession` stamps `created_by`
 * with the actor, so the draft list can say who started a draft. A harness that
 * reaches the insert: an organization row, an opening line, and a
 * `withTenant`-capable `tenantDb.transaction` whose insert records its values.
 */
function insertingServiceAs(jwt: { sub: string }) {
  const reads = { fleetSelect: 0 };
  const inserted: Array<Record<string, unknown>> = [];
  const orgChain = {
    from: () => orgChain,
    where: () => orgChain,
    limit: () => Promise.resolve([{ id: "org-1", code: "ORG", name: "Org" }]),
  };
  const tx = {
    execute: () => Promise.resolve(),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return {
          returning: () =>
            Promise.resolve([
              {
                id: "s-1",
                committedAt: null,
                result: null,
                checkpoints: null,
                createdBy: null,
                createdAt: new Date("2026-10-13T00:00:00.000Z"),
                updatedAt: new Date("2026-10-13T00:00:00.000Z"),
                ...values,
              },
            ]),
        };
      },
    }),
  };
  const tenantDb = {
    select: () => orgChain,
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const emptyChain = {
    from: () => emptyChain,
    where: () => emptyChain,
    limit: () => Promise.resolve([]),
  };
  const fleetDb = {
    select: () => {
      reads.fleetSelect += 1;
      return emptyChain;
    },
  };
  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "organization_admin" }),
    canManageOrganization: () => Promise.resolve(true),
  };
  const chatService = {
    openingMessage: () => ({ assistantMessage: "Welcome to onboarding.", currentPhase: "location", suggestedReplies: [] }),
    createMessage: (role: string, content: string) => ({ id: "m-1", role, content, createdAt: "2026-10-13T00:00:00.000Z" }),
  };
  const none = {} as never;
  const service = new OnboardingService(
    fleetDb as never,
    tenantDb as never,
    accessControl as never,
    chatService as never,
    none,
    none,
    none,
    none,
    none,
    none,
  );
  return { service: service as OnboardingService, inserted, reads, jwt: jwt as never };
}

const ACTOR: ResolvedIdentity = {
  id: "u-1",
  email: "someone@bms.local",
  displayName: "Someone",
  role: "organization_admin",
  organizationId: "org-1",
  oidcSubject: null,
  disabledAt: null,
};

/** The insert carries the actor the guard resolved (the memo), so no identity read is paid. */
export async function theInsertStampsTheActor(): Promise<void> {
  const h = insertingServiceAs({ sub: "kc-memo" });
  rememberIdentity(h.jwt, ACTOR);
  await h.service.createSession(h.jwt, "org-1");
  expect(h.inserted.map((values) => values.createdBy)).toEqual(["u-1"]);
}

/**
 * A token that names no row stamps `null`: local mode answers a non-uuid `sub`
 * with no query. `fleetSelect === 0` proves the short-circuit rather than a
 * fake that happened to answer `[]`.
 */
export async function anUnknownActorStampsNull(): Promise<void> {
  vi.stubEnv("AUTH_MODE", "local");
  vi.stubEnv("OIDC_ISSUER", "");
  try {
    const h = insertingServiceAs({ sub: "spec-user" });
    await h.service.createSession(h.jwt, "org-1");
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]).toHaveProperty("createdBy", null);
    expect(h.reads.fleetSelect).toBe(0);
  } finally {
    vi.unstubAllEnvs();
  }
}
