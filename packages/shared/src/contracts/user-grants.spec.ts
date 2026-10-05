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

/**
 * `F4.201`: an asset-group grant names its group's location. Zod strips an unknown key, so a
 * schema without `locationName` parses this body and drops the name — the parsed value is read.
 */
export function assertAnAssetGroupGrantKeepsItsLocationName(): void {
  const item = {
    id: ID,
    kind: "asset_group",
    targetId: ID,
    targetName: "HVAC",
    locationName: "Plant North",
    organizationId: ID,
    effective: true,
    createdAt: "x",
  };
  const parsed = userGrantsResponseSchema.parse({ items: [item] });
  expect(parsed.items[0]?.locationName).toBe("Plant North");
}

/** `F4.201`: the field is optional — organization and location grants carry none. */
export function assertAGrantWithoutALocationNameStillParses(): void {
  const item = { id: ID, kind: "location", targetId: ID, targetName: "Site", organizationId: ID, effective: true, createdAt: "x" };
  expect(userGrantsResponseSchema.safeParse({ items: [item] }).success).toBe(true);
}
