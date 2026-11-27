import { expect } from "vitest";

import { degradationQuerySchema } from "./degradation.schema";

/**
 * `E1.5a` / ADR 0138 (plan T1.7, T1.8) — `GET /degradation?organizationId=&locationId=`:
 * the two scope keys of the advisories list, each an optional lower-cased uuid,
 * `.strict()`. Assertions live here; `degradation.schema.test.ts` is the vitest
 * entry point (ADR 0014).
 */
const ORG = "D0D0D0D0-0000-4000-8000-000000000001";
const LOC = "d1d1d1d1-0000-4000-8000-000000000001";

export function theTwoScopeKeysParseAndAreLowerCased(): void {
  expect(degradationQuerySchema.parse({})).toEqual({});
  expect(degradationQuerySchema.parse({ organizationId: ORG })).toEqual({ organizationId: ORG.toLowerCase() });
  expect(degradationQuerySchema.parse({ locationId: LOC })).toEqual({ locationId: LOC });
  expect(degradationQuerySchema.parse({ organizationId: ORG, locationId: LOC })).toEqual({
    organizationId: ORG.toLowerCase(),
    locationId: LOC,
  });
}

export function aGroupAnUnknownKeyOrANonUuidIsRefused(): void {
  for (const bad of [
    { assetGroupId: LOC },
    { assetId: LOC },
    { window: "28" },
    { organizationId: "not-a-uuid" },
    { locationId: "1234" },
    { organizationId: [ORG, ORG] },
  ]) {
    expect(degradationQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  }
}
