import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import type { MasterDataAuditService } from "../admin/master-data-audit.service";
import type { PutCopilotAccessBody } from "./copilot-access.schema";
import { CopilotAccessService, type OverrideTarget } from "./copilot-access.service";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";

type Role = "admin" | "organization_admin" | "location_admin" | "asset_group_admin" | "operator";

const jwt = (role: Role): JwtPayload => ({ sub: `user-${role}`, email: `${role}@example.test`, role }) as JwtPayload;

/**
 * The access-control fake answers like the real service for a user whose home
 * organization is A: the global admin manages everything, an
 * `organization_admin` holds a direct grant on A, and every other role is
 * `false` from the role alone. `canManageOrganization` answers `true` for every
 * role, as the real one does for a `location_admin` holding a node in A — so a
 * gate that trusts it alone lets the scoped roles through, and the specs below
 * go red.
 */
function harness(targets: Record<string, OverrideTarget | null> = {}) {
  const calls: string[] = [];
  const accessControl = {
    requireMasterDataUser: async (token: JwtPayload) => {
      if (token.role === "operator" || token.role === "viewer") {
        throw new ForbiddenException("master data requires an administrator role");
      }
      return { id: token.sub, email: token.email, displayName: token.sub, role: token.role };
    },
    isOrganizationLevelAdmin: async (token: JwtPayload, organizationId: string) =>
      token.role === "admin" || (token.role === "organization_admin" && organizationId === ORG_A),
    canManageOrganization: async () => true,
  } as unknown as AccessControlService;
  const audit = {
    write: async () => {
      calls.push("audit");
    },
  } as unknown as MasterDataAuditService;
  const tenantDb = {
    transaction: async () => {
      calls.push("transaction");
      throw new Error("the refusal must come before any tenant transaction");
    },
  };
  const authDb = {
    select: () => {
      throw new Error("the spec replaces loadOverrideTarget; the auth pool is not read");
    },
  };
  const service = new CopilotAccessService(tenantDb as never, authDb as never, accessControl, audit);
  service.loadOverrideTarget = async (userId: string) => {
    calls.push(`target:${userId}`);
    return targets[userId] ?? null;
  };
  return { service, calls };
}

async function refused(run: () => Promise<unknown>): Promise<ForbiddenException> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    return error as ForbiddenException;
  }
  throw new Error("expected a 403");
}

/** Operators and viewers are refused before anything else is read. */
export async function assertAnOperatorIsRefusedOnGetAndPut(): Promise<void> {
  const { service, calls } = harness();
  await refused(() => service.get(jwt("operator"), ORG_A));
  await refused(() => service.put(jwt("operator"), ORG_A, { enabled: true }));
  expect(calls).toEqual([]);
}

/**
 * Plan §5.2 / security review H1: the role is checked **before**
 * `isOrganizationLevelAdmin`, and never `canManageOrganization`, which admits a
 * `location_admin` in every organization where it holds one node. Mutation:
 * gate on `canManageOrganization` alone → these three go green → red.
 */
export async function assertScopedAdministratorsCannotReadTheSettings(): Promise<void> {
  for (const role of ["location_admin", "asset_group_admin"] as const) {
    const { service, calls } = harness();
    await refused(() => service.get(jwt(role), ORG_A));
    expect(calls, role).toEqual([]);
  }
}

export async function assertScopedAdministratorsCannotSetARoleSwitch(): Promise<void> {
  for (const role of ["location_admin", "asset_group_admin"] as const) {
    const { service, calls } = harness();
    await refused(() => service.put(jwt(role), ORG_A, { roles: { [role]: true } }));
    expect(calls, role).toEqual([]);
  }
}

export async function assertScopedAdministratorsCannotSetTheirOwnException(): Promise<void> {
  for (const role of ["location_admin", "asset_group_admin"] as const) {
    const self: OverrideTarget = { organizationId: ORG_A, role };
    const { service, calls } = harness({ [`user-${role}`]: self });
    const body: PutCopilotAccessBody = { override: { userId: `user-${role}`, allow: true } };
    await refused(() => service.put(jwt(role), ORG_A, body));
    expect(calls, role).toEqual([]);
  }
}

/** An organization admin of A administers A only. */
export async function assertAnOrganizationAdminIsRefusedForAnotherOrganization(): Promise<void> {
  const { service, calls } = harness();
  await refused(() => service.get(jwt("organization_admin"), ORG_B));
  await refused(() => service.put(jwt("organization_admin"), ORG_B, { roles: { location_admin: false } }));
  expect(calls).toEqual([]);
}

/** Ruling 15 / drafter choice 7: only the global admin switches an organization on or off. */
export async function assertOnlyTheGlobalAdminSetsTheOrganizationSwitch(): Promise<void> {
  const { service, calls } = harness();
  const error = await refused(() => service.put(jwt("organization_admin"), ORG_A, { enabled: true }));
  expect(error.message).toMatch(/global admin/i);
  expect(calls).toEqual([]);
}

/**
 * An exception may name only an administrator whose home organization is this
 * one. A user that does not exist and a user of another organization get the
 * **same** answer, so the route cannot be used to learn which ids exist
 * elsewhere (security review note on PR 3). No row is written either way.
 */
export async function assertAnExceptionForAnUnknownOrForeignUserGetsOneAnswer(): Promise<void> {
  const foreign: OverrideTarget = { organizationId: ORG_B, role: "location_admin" };
  const { service, calls } = harness({ "user-foreign": foreign });
  const unknown = await refused(() =>
    service.put(jwt("organization_admin"), ORG_A, { override: { userId: "user-missing", allow: true } }),
  );
  const other = await refused(() =>
    service.put(jwt("organization_admin"), ORG_A, { override: { userId: "user-foreign", allow: true } }),
  );
  expect(other.getStatus()).toBe(unknown.getStatus());
  expect(other.getResponse()).toEqual(unknown.getResponse());
  expect(calls).toEqual(["target:user-missing", "target:user-foreign"]);
}

/** An exception names an administrator; an operator of this organization is refused the same way. */
export async function assertAnExceptionForANonAdministratorIsRefused(): Promise<void> {
  const operator: OverrideTarget = { organizationId: ORG_A, role: "operator" };
  const { service, calls } = harness({ "user-op": operator });
  await refused(() => service.put(jwt("organization_admin"), ORG_A, { override: { userId: "user-op", allow: true } }));
  expect(calls).toEqual(["target:user-op"]);
}

/**
 * Security and code review (PR 3): removing an exception only narrows, so it
 * must not depend on the user still qualifying — a user demoted or moved away
 * left a stale row that the card listed and could not remove. A remove passes
 * the gate and reaches the transaction without reading the target.
 * Mutation: check the target on a remove too → red.
 */
export async function assertAStaleExceptionCanBeRemoved(): Promise<void> {
  const demoted: OverrideTarget = { organizationId: ORG_A, role: "operator" };
  const { service, calls } = harness({ "user-demoted": demoted });
  await expect(
    service.put(jwt("organization_admin"), ORG_A, { override: { userId: "user-demoted", allow: null } }),
  ).rejects.toThrow("the refusal must come before any tenant transaction");
  expect(calls).toEqual(["transaction"]);
}

/** A scoped administrator cannot set the organization switch either. */
export async function assertScopedAdministratorsCannotSetTheOrganizationSwitch(): Promise<void> {
  for (const role of ["location_admin", "asset_group_admin"] as const) {
    const { service, calls } = harness();
    await refused(() => service.put(jwt(role), ORG_A, { enabled: true }));
    expect(calls, role).toEqual([]);
  }
}
