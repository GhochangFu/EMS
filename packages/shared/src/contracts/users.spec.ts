import { expect } from "vitest";

import {
  adminUsersListResponseSchema,
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
