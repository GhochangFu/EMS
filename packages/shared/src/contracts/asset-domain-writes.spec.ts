import { expect } from "vitest";

import { adminAssetDomainDtoSchema, adminAssetDomainsListResponseSchema, updateAssetDomainBodySchema } from "./asset-domain-writes";
import { createAssetTemplateBodySchema, updateAssetTemplateBodySchema } from "./asset-template-writes";
import { adminAssetTemplateDtoSchema } from "./asset-templates";

/**
 * `E3.1` (ADR 0122 decisions 2.4 and 2.5; rulings P8, R4, Q4; plan T7.1 and T7.2) — the
 * work-order prefix as it is written: on an asset domain by the global admin, and on an
 * asset template by its author. Assertions live here; `asset-domain-writes.test.ts` is
 * the Vitest entry point (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const GOOD = ["ST", "STP", "ETP2", "ABCDEFGH", "12"];
const BAD = ["S", "stp", "Stp", "ABCDEFGHI", "ST-P", "ST P", ""];

/** The domain PATCH body is the prefix, required and nullable, and nothing else. */
export function theDomainBodyIsThePrefixOnly(): void {
  for (const workOrderPrefix of GOOD) {
    expect(updateAssetDomainBodySchema.safeParse({ workOrderPrefix }).success, workOrderPrefix).toBe(true);
  }
  expect(updateAssetDomainBodySchema.safeParse({ workOrderPrefix: null }).success, "null clears it").toBe(true);
  for (const workOrderPrefix of BAD) {
    expect(updateAssetDomainBodySchema.safeParse({ workOrderPrefix }).success, JSON.stringify(workOrderPrefix)).toBe(false);
  }
  expect(updateAssetDomainBodySchema.safeParse({}).success, "the prefix is required").toBe(false);
  for (const extra of [{ label: "Water" }, { active: false }, { code: "water" }, { sortOrder: 1 }]) {
    expect(updateAssetDomainBodySchema.safeParse({ workOrderPrefix: "STP", ...extra }).success, JSON.stringify(extra)).toBe(false);
  }
}

/** The admin list answers each domain with its prefix; a prefix is required on the row, and may be null. */
export function theDomainListRoundTrips(): void {
  const row = { code: "water", label: "Water", sortOrder: 40, active: true, workOrderPrefix: "WATER" };
  expect(adminAssetDomainsListResponseSchema.safeParse({ items: [row, { ...row, code: "new", workOrderPrefix: null }] }).success).toBe(true);
  const { workOrderPrefix: _dropped, ...withoutPrefix } = row;
  expect(adminAssetDomainDtoSchema.safeParse(withoutPrefix).success, "a row without the prefix is refused").toBe(false);
  expect(adminAssetDomainDtoSchema.safeParse({ ...row, workOrderPrefix: "water" }).success, "a stored prefix holds the pattern").toBe(false);
}

const TEMPLATE = { organizationId: ORG, code: "WATER-STP", name: "Sewage treatment plant", assetType: "stp", domain: "water" };

/** The template create body takes an optional, nullable prefix that holds the pattern. */
export function theTemplateCreateBodyTakesAPrefix(): void {
  expect(createAssetTemplateBodySchema.safeParse(TEMPLATE).success, "left out").toBe(true);
  expect(createAssetTemplateBodySchema.safeParse({ ...TEMPLATE, workOrderPrefix: null }).success, "null").toBe(true);
  const parsed = createAssetTemplateBodySchema.safeParse({ ...TEMPLATE, workOrderPrefix: "STP" });
  expect(parsed.success && parsed.data.workOrderPrefix).toBe("STP");
  for (const workOrderPrefix of BAD) {
    expect(createAssetTemplateBodySchema.safeParse({ ...TEMPLATE, workOrderPrefix }).success, JSON.stringify(workOrderPrefix)).toBe(false);
  }
}

/** The template update body takes the prefix alone: a value changes it, null clears it, and a bad one is refused. */
export function theTemplateUpdateBodyTakesAPrefix(): void {
  expect(updateAssetTemplateBodySchema.safeParse({ workOrderPrefix: "ETP" }).success).toBe(true);
  expect(updateAssetTemplateBodySchema.safeParse({ workOrderPrefix: null }).success).toBe(true);
  expect(updateAssetTemplateBodySchema.safeParse({ name: "Renamed" }).success, "left out keeps it").toBe(true);
  for (const workOrderPrefix of BAD) {
    expect(updateAssetTemplateBodySchema.safeParse({ workOrderPrefix }).success, JSON.stringify(workOrderPrefix)).toBe(false);
  }
  expect(updateAssetTemplateBodySchema.safeParse({ workOrderPrefix: "ETP", code: "X" }).success, "still strict").toBe(false);
}

/** The template DTO carries the prefix as a required, nullable field. */
export function theTemplateDtoCarriesThePrefix(): void {
  expect(Object.keys(adminAssetTemplateDtoSchema.shape)).toContain("workOrderPrefix");
  expect(adminAssetTemplateDtoSchema.shape.workOrderPrefix.safeParse(null).success).toBe(true);
  expect(adminAssetTemplateDtoSchema.shape.workOrderPrefix.safeParse("STP").success).toBe(true);
  expect(adminAssetTemplateDtoSchema.shape.workOrderPrefix.safeParse(undefined).success, "required").toBe(false);
}
