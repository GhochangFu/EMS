import { expect } from "vitest";

import {
  adminUsersListResponseSchema,
  COPILOT_NEVER_GLOBAL_ADMIN_MESSAGE,
  copilotCreateUserBodySchema,
  copilotUpdateUserBodySchema,
  createUserBodySchema,
  temporaryPasswordBodySchema,
  updateUserBodySchema,
  userWriteResponseSchema,
} from "./users";

/**
 * `F3.78` / ADR 0089 decision 1 — the users API request and response
 * contracts. Assertions live here; `users.test.ts` is the vitest entry point
 * (ADR 0014). One claim per exported function.
 */

const ORG = "6f1c2c1e-9a4b-4c3e-8d2f-0a1b2c3d4e5f";
const PASSWORD = "twelve-chars";

function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: "New.User@Example.COM",
    displayName: "New User",
    role: "viewer",
    organizationId: ORG,
    temporaryPassword: PASSWORD,
    ...overrides,
  };
}

export function assertCreateTrimsAndLowerCasesTheEmail(): void {
  const parsed = createUserBodySchema.parse(createBody({ email: "  New.User@Example.COM  " }));
  expect(parsed.email).toBe("new.user@example.com");
}

export function assertCreateRefusesAnAdminWithAnOrganization(): void {
  const result = createUserBodySchema.safeParse(createBody({ role: "admin", organizationId: ORG }));
  expect(result.success).toBe(false);
}

export function assertCreateRefusesANonAdminWithoutAnOrganization(): void {
  const result = createUserBodySchema.safeParse(createBody({ role: "viewer", organizationId: null }));
  expect(result.success).toBe(false);
}

export function assertCreateAcceptsAnAdminWithANullOrganization(): void {
  const result = createUserBodySchema.safeParse(createBody({ role: "admin", organizationId: null }));
  expect(result.success).toBe(true);
}

export function assertCreateRefusesAnElevenCharacterPassword(): void {
  const result = createUserBodySchema.safeParse(createBody({ temporaryPassword: "eleven-char" }));
  expect(result.success).toBe(false);
}

export function assertCreateAcceptsATwelveCharacterPassword(): void {
  const result = createUserBodySchema.safeParse(createBody({ temporaryPassword: PASSWORD }));
  expect(result.success).toBe(true);
}

export function assertUpdateRefusesAnUnknownKey(): void {
  const result = updateUserBodySchema.safeParse({ displayName: "X", email: "other@example.com" });
  expect(result.success).toBe(false);
}

export function assertUpdateRefusesAnEmptyBody(): void {
  expect(updateUserBodySchema.safeParse({}).success).toBe(false);
}

export function assertUpdateRefusesAnOrganizationWithoutARole(): void {
  expect(updateUserBodySchema.safeParse({ organizationId: ORG }).success).toBe(false);
}

export function assertUpdateRefusesToAdminWithAnOrganization(): void {
  expect(updateUserBodySchema.safeParse({ role: "admin", organizationId: ORG }).success).toBe(false);
}

export function assertUpdateRefusesANonAdminRoleWithANullOrganization(): void {
  expect(updateUserBodySchema.safeParse({ role: "viewer", organizationId: null }).success).toBe(false);
}

export function assertUpdateAcceptsADisplayNameAlone(): void {
  expect(updateUserBodySchema.safeParse({ displayName: "Renamed" }).success).toBe(true);
}

export function assertTemporaryPasswordBodyRefusesElevenCharacters(): void {
  expect(temporaryPasswordBodySchema.safeParse({ temporaryPassword: "eleven-char" }).success).toBe(false);
}

export function assertTemporaryPasswordBodyAcceptsTwelveCharacters(): void {
  expect(temporaryPasswordBodySchema.safeParse({ temporaryPassword: PASSWORD }).success).toBe(true);
}

const USER = {
  id: ORG,
  email: "a@example.com",
  displayName: "A",
  role: "viewer",
  organizationId: ORG,
  linked: true,
  disabledAt: null,
  lastLoginAt: null,
  createdAt: "2026-10-03T00:00:00.000Z",
};

export function assertWriteResponseRefusesAnUnknownFollowUp(): void {
  expect(userWriteResponseSchema.safeParse({ user: USER, followUp: "something_else" }).success).toBe(false);
}

export function assertWriteResponseAcceptsANullFollowUp(): void {
  expect(userWriteResponseSchema.safeParse({ user: USER, followUp: null }).success).toBe(true);
}

export function assertListResponseRefusesARowWithoutLinked(): void {
  const { linked: _linked, ...withoutLinked } = USER;
  expect(adminUsersListResponseSchema.safeParse({ items: [withoutLinked] }).success).toBe(false);
}

// --- F3.86 PR 4 / ADR 0099 decision 3: the copilot's user bodies ---------------

/** The copilot's create body refuses a temporary password: the admin types it on the Confirm card. */
export function assertCopilotCreateRefusesAPassword(): void {
  const result = copilotCreateUserBodySchema.safeParse(createBody());
  expect(result.success).toBe(false);
  const { temporaryPassword: _typed, ...withoutPassword } = createBody();
  expect(copilotCreateUserBodySchema.safeParse(withoutPassword).success).toBe(true);
}

/** The copilot never proposes the global admin role, even with the null organization the route takes. */
export function assertCopilotCreateNeverProposesTheGlobalAdmin(): void {
  const { temporaryPassword: _typed, ...body } = createBody({ role: "admin", organizationId: null });
  const result = copilotCreateUserBodySchema.safeParse(body);
  expect(result.success).toBe(false);
  expect(result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message])).toContainEqual([
    "role",
    COPILOT_NEVER_GLOBAL_ADMIN_MESSAGE,
  ]);
  // The route takes it (positive control): the copilot rule is narrower than the route's.
  expect(createUserBodySchema.safeParse(createBody({ role: "admin", organizationId: null })).success).toBe(true);
}

/** Every other input: the copilot body answers what the route body answers, without the password. */
export function assertCopilotCreateAgreesWithTheRouteOtherwise(): void {
  const inputs = [
    {},
    { role: "viewer", organizationId: null },
    { role: "organization_admin" },
    { email: "not-an-email" },
    { displayName: "" },
  ];
  for (const overrides of inputs) {
    const { temporaryPassword: _typed, ...body } = createBody(overrides);
    expect(copilotCreateUserBodySchema.safeParse(body).success, JSON.stringify(overrides)).toBe(
      createUserBodySchema.safeParse(createBody(overrides)).success,
    );
  }
}

/** The copilot's update keeps the route's rules and refuses a promotion to the global admin. */
export function assertCopilotUpdateNeverProposesTheGlobalAdmin(): void {
  expect(copilotUpdateUserBodySchema.safeParse({ role: "admin", organizationId: null }).success).toBe(false);
  expect(updateUserBodySchema.safeParse({ role: "admin", organizationId: null }).success).toBe(true);
  expect(copilotUpdateUserBodySchema.safeParse({ displayName: "Renamed" }).success).toBe(true);
  expect(copilotUpdateUserBodySchema.safeParse({}).success).toBe(false);
}
