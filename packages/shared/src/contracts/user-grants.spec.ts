import { expect } from "vitest";

import { addUserGrantBodySchema, userGrantsResponseSchema } from "./user-grants";

/**
 * `F3.78` / ADR 0089 decision 12 — the grants API contracts. One claim per
 * exported function; `user-grants.test.ts` is the entry point.
 */

const ID = "00000000-0000-4000-8000-000000000001";

export function assertAddBodyAcceptsEachOfTheThreeKinds(): void {
  for (const kind of ["organization", "location", "asset_group"]) {
    expect(addUserGrantBodySchema.safeParse({ kind, targetId: ID }).success).toBe(true);
  }
}

export function assertAddBodyRefusesAnUnknownKind(): void {
  expect(addUserGrantBodySchema.safeParse({ kind: "asset", targetId: ID }).success).toBe(false);
}

/** `.strict()`: a body cannot smuggle a `userId` past the route's `:id`. */
export function assertAddBodyRefusesAnExtraKey(): void {
  expect(addUserGrantBodySchema.safeParse({ kind: "location", targetId: ID, userId: ID }).success).toBe(false);
}

export function assertAddBodyRefusesANonUuidTarget(): void {
  expect(addUserGrantBodySchema.safeParse({ kind: "location", targetId: "WC-01" }).success).toBe(false);
}

export function assertResponseRefusesAGrantWithoutEffective(): void {
  const item = { id: ID, kind: "location", targetId: ID, targetName: "Site", organizationId: ID, createdAt: "x" };
  expect(userGrantsResponseSchema.safeParse({ items: [item] }).success).toBe(false);
  expect(userGrantsResponseSchema.safeParse({ items: [{ ...item, effective: false }] }).success).toBe(true);
}
