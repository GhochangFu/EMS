import { expect } from "vitest";

import { healthBadActorsQuerySchema } from "./health-inputs.schema";

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan T1.3, T1.6) — the bad-actors query: two
 * optional scope ids, lower-cased before any scope check, and nothing else (no
 * `windowMinutes`, plan §14; no `assetGroupId`, the summary's narrowing, R-d).
 * Entry point: `health-inputs.schema.test.ts` (ADR 0014).
 */
const ORG = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const LOC = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";

/** Both keys parse, lower-cased; neither is required. */
export function theTwoScopeKeysParseLowerCased(): void {
  expect(healthBadActorsQuerySchema.parse({ organizationId: ORG, locationId: LOC })).toEqual({
    organizationId: ORG.toLowerCase(),
    locationId: LOC.toLowerCase(),
  });
  expect(healthBadActorsQuerySchema.parse({})).toEqual({});
}

/** A non-UUID, `assetGroupId`, `windowMinutes` and any unknown key are refused. */
export function anythingElseIsRefused(): void {
  for (const query of [
    { organizationId: "not-a-uuid" },
    { locationId: "1234" },
    { assetGroupId: ORG.toLowerCase() },
    { windowMinutes: "60" },
    { since: "2026-11-10T00:00:00.000Z" },
  ]) {
    expect(healthBadActorsQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
  }
}
