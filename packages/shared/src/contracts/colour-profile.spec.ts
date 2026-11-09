import { expect } from "vitest";

import { adminOrganizationDtoSchema } from "./admin";
import { currentUserResponseSchema } from "./auth";
import { COLOUR_PROFILES, colourProfileSchema, setOrganizationColourProfileBodySchema } from "./colour-profile";

/**
 * `F4.310` (ADR 0110 decisions 1, 4 and 7) — the closed list of colour profiles, the `PUT` body,
 * and the two responses that carry a profile. Pure: no database. The sibling `.test.ts` carries
 * the `it()`s (ADR 0014).
 */

/** P1 — the nine names (`F4.341` added the last three), in the order the chooser shows them; `nexus` first, the default. */
export function runTheProfilesInOrder(): void {
  expect(COLOUR_PROFILES).toEqual([
    "nexus",
    "ocean",
    "lagoon",
    "indigo",
    "graphite",
    "high-contrast",
    "forest",
    "sand",
    "navy-pop",
  ]);
  expect(colourProfileSchema.options).toEqual(COLOUR_PROFILES);
}

/** P2 — an unknown, mis-cased or empty name is refused. */
export function runAnUnknownNameIsRefused(): void {
  for (const bad of ["Nexus", "dark", "", "high_contrast", " ocean"]) {
    expect(colourProfileSchema.safeParse(bad).success, `"${bad}"`).toBe(false);
  }
}

/** P3 — the `PUT` body is `{ colourProfile }` only (`.strict()`): an extra key is a 400. */
export function runTheBodyIsStrict(): void {
  expect(setOrganizationColourProfileBodySchema.safeParse({ colourProfile: "ocean" }).success).toBe(true);
  expect(setOrganizationColourProfileBodySchema.safeParse({ colourProfile: "ocean", name: "x" }).success).toBe(false);
  expect(setOrganizationColourProfileBodySchema.safeParse({}).success).toBe(false);
}

/**
 * P4 — the organization DTO requires the `colourProfile` key, one of the nine or (since `F4.341`,
 * ADR 0118 decision 9) `null` for "inherit the portal", and the `designSystem` key likewise.
 */
export function runTheOrganizationDtoRequiresAProfile(): void {
  const dto = {
    id: "o1",
    code: "ORG",
    name: "Org",
    active: true,
    currency: "INR",
    timezone: "UTC",
    ingestEnabled: true,
    meta: null,
    createdAt: "2026-11-05T00:00:00.000Z",
    designSystem: null,
  };
  expect(adminOrganizationDtoSchema.safeParse(dto).success).toBe(false);
  expect(adminOrganizationDtoSchema.safeParse({ ...dto, colourProfile: "lagoon" }).success).toBe(true);
  expect(adminOrganizationDtoSchema.safeParse({ ...dto, colourProfile: null }).success).toBe(true);
  expect(adminOrganizationDtoSchema.safeParse({ ...dto, colourProfile: "teal" }).success).toBe(false);
  const { designSystem: _omitted, ...withoutDesign } = { ...dto, colourProfile: "lagoon" };
  expect(adminOrganizationDtoSchema.safeParse(withoutDesign).success).toBe(false);
}

/** P5 — `/auth/me` requires `colourProfile` (deprecated until `F4.342`) and, since `F4.341`, `appearance`. */
export function runTheCurrentUserCarriesAProfile(): void {
  const me = {
    user: { id: "u1", email: "a@b.c", displayName: "A", role: "viewer" },
    scope: { kind: "none", locations: [], assetGroups: [], assetIds: [] },
  };
  const appearance = { designSystem: { value: "nexus-soft", from: "portal" }, colourProfile: { value: "nexus", from: "portal" } };
  expect(currentUserResponseSchema.safeParse(me).success).toBe(false);
  expect(currentUserResponseSchema.safeParse({ ...me, colourProfile: "nexus" }).success).toBe(false);
  expect(currentUserResponseSchema.safeParse({ ...me, colourProfile: "nexus", appearance }).success).toBe(true);
}
