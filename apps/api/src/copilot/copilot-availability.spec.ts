import { expect } from "vitest";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { type CopilotAccessReads, decideCopilotAvailability } from "./copilot-availability";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";

type Role = ResolvedIdentity["role"];

function identity(role: Role, organizationId: string | null = ORG_A): ResolvedIdentity {
  return {
    id: `user-${role}`,
    email: `${role}@example.test`,
    displayName: role,
    role,
    organizationId,
    oidcSubject: null,
    disabledAt: null,
  } as ResolvedIdentity;
}

interface Stored {
  org?: boolean | null;
  roles?: Partial<Record<"location_admin" | "asset_group_admin", boolean>>;
  overrides?: Record<string, boolean>;
}

/** A fake that answers from `stored` for one organization and records every read. */
function reads(stored: Stored): { open: (organizationId: string) => CopilotAccessReads; log: string[] } {
  const log: string[] = [];
  return {
    log,
    open: (organizationId) => ({
      orgEnabled: async () => {
        log.push(`org:${organizationId}`);
        return stored.org ?? null;
      },
      roleEnabled: async (role) => {
        log.push(`role:${organizationId}:${role}`);
        return stored.roles?.[role] ?? null;
      },
      userOverride: async (userId) => {
        log.push(`user:${organizationId}:${userId}`);
        return stored.overrides?.[userId] ?? null;
      },
    }),
  };
}

export async function assertAnUnprovisionedTokenIsRefusedWithNoRead(): Promise<void> {
  const fake = reads({ org: true });
  expect(await decideCopilotAvailability(null, ORG_A, fake.open)).toEqual({
    available: false,
    reason: "not_provisioned",
  });
  expect(fake.log).toEqual([]);
}

export async function assertOperatorsAndViewersAreRefusedByRoleWithNoRead(): Promise<void> {
  for (const role of ["operator", "viewer"] as const) {
    const fake = reads({ org: true });
    expect(await decideCopilotAvailability(identity(role), ORG_A, fake.open)).toEqual({
      available: false,
      reason: "role",
    });
    expect(fake.log).toEqual([]);
  }
}

/** Decision 10: the global admin may hold a cross-organization conversation on the platform key. */
export async function assertTheGlobalAdminIsAvailableAcrossOrganizations(): Promise<void> {
  const fake = reads({});
  expect(await decideCopilotAvailability(identity("admin", null), null, fake.open)).toEqual({
    available: true,
  });
  expect(fake.log).toEqual([]);
}

/** Drafter choice 7: an organization switched off blocks the global admin inside it too. */
export async function assertTheOrganizationSwitchBindsTheGlobalAdmin(): Promise<void> {
  expect(await decideCopilotAvailability(identity("admin", null), ORG_B, reads({ org: false }).open)).toEqual({
    available: false,
    reason: "organization_off",
  });
  expect(await decideCopilotAvailability(identity("admin", null), ORG_B, reads({ org: true }).open)).toEqual({
    available: true,
  });
}

/** Ruling 15: a new organization, with no rows at all, is off for every administrator in it. */
export async function assertANewOrganizationIsOffForEveryAdministrator(): Promise<void> {
  for (const role of ["admin", "organization_admin", "location_admin", "asset_group_admin"] as const) {
    expect(await decideCopilotAvailability(identity(role), ORG_A, reads({}).open), role).toEqual({
      available: false,
      reason: "organization_off",
    });
  }
}

/**
 * Decision 10: a non-global administrator is bound to their own organization.
 * The refusal is made before any switch is read — a `location_admin` of A must
 * not learn B's switches. Mutation: move the check below the org read → the
 * read log is no longer empty → red.
 */
export async function assertAScopedAdministratorOfAIsRefusedForBWithNoRead(): Promise<void> {
  for (const role of ["organization_admin", "location_admin", "asset_group_admin"] as const) {
    const fake = reads({ org: true, overrides: { [`user-${role}`]: true } });
    expect(await decideCopilotAvailability(identity(role, ORG_A), ORG_B, fake.open), role).toEqual({
      available: false,
      reason: "other_organization",
    });
    expect(fake.log, role).toEqual([]);
  }
}

export async function assertAScopedAdministratorWithNoOrganizationIsRefused(): Promise<void> {
  const fake = reads({ org: true });
  expect(await decideCopilotAvailability(identity("location_admin"), null, fake.open)).toEqual({
    available: false,
    reason: "other_organization",
  });
  expect(fake.log).toEqual([]);
}

/** A user with no home organization cannot be in "their own" organization. */
export async function assertAScopedAdministratorWithNoHomeOrganizationIsRefused(): Promise<void> {
  const fake = reads({ org: true });
  expect(await decideCopilotAvailability(identity("location_admin", null), ORG_A, fake.open)).toEqual({
    available: false,
    reason: "other_organization",
  });
  expect(fake.log).toEqual([]);
}

export async function assertTheOrganizationAdminFollowsTheOrganizationSwitch(): Promise<void> {
  expect(await decideCopilotAvailability(identity("organization_admin"), ORG_A, reads({ org: true }).open)).toEqual({
    available: true,
  });
  expect(await decideCopilotAvailability(identity("organization_admin"), ORG_A, reads({ org: false }).open)).toEqual({
    available: false,
    reason: "organization_off",
  });
}

/** An `organization_admin` has no role switch; a deny exception still narrows. */
export async function assertADenyExceptionNarrowsTheOrganizationAdmin(): Promise<void> {
  const stored = { org: true, overrides: { "user-organization_admin": false } };
  expect(await decideCopilotAvailability(identity("organization_admin"), ORG_A, reads(stored).open)).toEqual({
    available: false,
    reason: "user_denied",
  });
}

/** Q2: a role switch with no row is on. */
export async function assertARoleSwitchWithNoRowIsOn(): Promise<void> {
  for (const role of ["location_admin", "asset_group_admin"] as const) {
    expect(await decideCopilotAvailability(identity(role), ORG_A, reads({ org: true }).open), role).toEqual({
      available: true,
    });
  }
}

export async function assertARoleSwitchedOffIsRefused(): Promise<void> {
  const stored = { org: true, roles: { location_admin: false } };
  expect(await decideCopilotAvailability(identity("location_admin"), ORG_A, reads(stored).open)).toEqual({
    available: false,
    reason: "role_off",
  });
  // The other role's switch is its own.
  expect(await decideCopilotAvailability(identity("asset_group_admin"), ORG_A, reads(stored).open)).toEqual({
    available: true,
  });
}

/** Q2: an exception works in both directions under the role switch. */
export async function assertAnAllowExceptionReEnablesUnderARoleSwitchedOff(): Promise<void> {
  const stored = { org: true, roles: { location_admin: false }, overrides: { "user-location_admin": true } };
  expect(await decideCopilotAvailability(identity("location_admin"), ORG_A, reads(stored).open)).toEqual({
    available: true,
  });
}

export async function assertADenyExceptionRefusesUnderARoleSwitchedOn(): Promise<void> {
  const stored = { org: true, roles: { asset_group_admin: true }, overrides: { "user-asset_group_admin": false } };
  expect(await decideCopilotAvailability(identity("asset_group_admin"), ORG_A, reads(stored).open)).toEqual({
    available: false,
    reason: "user_denied",
  });
}

/** Q2: the organization switch always wins — an allow exception cannot re-enable an organization that is off. */
export async function assertTheOrganizationSwitchBeatsAnAllowException(): Promise<void> {
  const stored = { org: false, overrides: { "user-location_admin": true } };
  expect(await decideCopilotAvailability(identity("location_admin"), ORG_A, reads(stored).open)).toEqual({
    available: false,
    reason: "organization_off",
  });
}

/**
 * An allow exception written while the user was a `location_admin` must not
 * survive a demotion: the role is read from the database row each time, before
 * any exception. Mutation: read the exception before the role check → red.
 */
export async function assertAnAllowExceptionDoesNotSurviveADemotion(): Promise<void> {
  const fake = reads({ org: true, overrides: { "user-operator": true } });
  expect(await decideCopilotAvailability(identity("operator"), ORG_A, fake.open)).toEqual({
    available: false,
    reason: "role",
  });
  expect(fake.log).toEqual([]);
}

/** Every read for one decision opens the organization the caller asked about, and only it. */
export async function assertEveryReadIsBoundToTheAskedOrganization(): Promise<void> {
  const fake = reads({ org: true });
  await decideCopilotAvailability(identity("location_admin"), ORG_A, fake.open);
  expect(fake.log.length).toBeGreaterThan(0);
  expect(fake.log.every((entry) => entry.includes(ORG_A))).toBe(true);
}
