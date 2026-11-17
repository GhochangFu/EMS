import { expect } from "vitest";

import { advisoriesQuerySchema } from "./advisories.schema";

/**
 * `E1.6a` / ADR 0137 (plan T1.6, T1.7) — `GET /advisories?organizationId=&locationId=`:
 * the two scope keys of the Anomalies and Forecasts lists, each an optional
 * lower-cased uuid, `.strict()`. Assertions live here; `advisories.schema.test.ts`
 * is the vitest entry point (ADR 0014).
 */
const ORG = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const LOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export function theTwoScopeKeysParseAndAreLowerCased(): void {
  expect(advisoriesQuerySchema.parse({})).toEqual({});
  expect(advisoriesQuerySchema.parse({ organizationId: ORG })).toEqual({ organizationId: ORG.toLowerCase() });
  expect(advisoriesQuerySchema.parse({ locationId: LOC })).toEqual({ locationId: LOC });
  expect(advisoriesQuerySchema.parse({ organizationId: ORG, locationId: LOC })).toEqual({
    organizationId: ORG.toLowerCase(),
    locationId: LOC,
  });
}

export function aGroupAnAssetAnUnknownKeyOrANonUuidIsRefused(): void {
  for (const bad of [
    { assetGroupId: LOC },
    { assetId: LOC },
    { since: "2026-11-10T00:00:00Z" },
    { organizationId: "not-a-uuid" },
    { locationId: "1234" },
    { organizationId: [ORG, ORG] },
  ]) {
    expect(advisoriesQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  }
}
