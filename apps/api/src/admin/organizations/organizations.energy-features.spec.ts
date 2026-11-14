import { expect } from "vitest";

import { CARD_PRIMARY_METRICS, ENERGY_FEATURES, adminOrganizationDtoSchema } from "@bms/shared";

import { createOrganizationBodySchema, updateOrganizationBodySchema } from "./organizations.schema";

/**
 * `F4.364` (ADR 0133 decision 6, plan U9 and ruling Q2) — the two energy settings on the
 * organization read and write contracts. Pure: no database. What the row and the audit log hold is
 * `organizations.energy-features.integration.spec.ts`. The sibling `.test.ts` carries the `it()`s.
 */

const VALID_CREATE = { code: "F4364-U", name: "F4.364 unit", currency: "INR" };

/** S1 — the update body accepts every listed value of each setting, alone and together. */
export function runEveryListedValueIsAccepted(): void {
  for (const energyFeatures of ENERGY_FEATURES) {
    expect(updateOrganizationBodySchema.safeParse({ energyFeatures }).success, energyFeatures).toBe(true);
  }
  for (const cardPrimaryMetric of CARD_PRIMARY_METRICS) {
    expect(updateOrganizationBodySchema.safeParse({ cardPrimaryMetric }).success, cardPrimaryMetric).toBe(true);
  }
  expect(updateOrganizationBodySchema.safeParse({ energyFeatures: "off", cardPrimaryMetric: "health" }).success).toBe(true);
  expect(updateOrganizationBodySchema.safeParse({}).success, "both stay optional").toBe(true);
}

/** S2 — a value outside the list is refused on either key. */
export function runAnUnknownValueIsRefused(): void {
  expect(updateOrganizationBodySchema.safeParse({ energyFeatures: "maybe" }).success).toBe(false);
  expect(updateOrganizationBodySchema.safeParse({ cardPrimaryMetric: "maybe" }).success).toBe(false);
  expect(updateOrganizationBodySchema.safeParse({ energyFeatures: null }).success).toBe(false);
}

/** S3 — the update body is still `.strict()`: a stray key is refused. */
export function runTheUpdateBodyStaysStrict(): void {
  expect(updateOrganizationBodySchema.safeParse({ energyFeatures: "on", energy: "on" }).success).toBe(false);
}

/** S4 — the create body is unchanged (plan D8): it refuses either key. */
export function runTheCreateBodyRefusesBothKeys(): void {
  expect(createOrganizationBodySchema.safeParse(VALID_CREATE).success, "positive control").toBe(true);
  expect(createOrganizationBodySchema.safeParse({ ...VALID_CREATE, energyFeatures: "on" }).success).toBe(false);
  expect(createOrganizationBodySchema.safeParse({ ...VALID_CREATE, cardPrimaryMetric: "kw" }).success).toBe(false);
}

/** S5 — the organization DTO requires both settings, each one of its list. */
export function runTheDtoRequiresBothSettings(): void {
  const dto = {
    id: "o1",
    code: "ORG",
    name: "Org",
    active: true,
    currency: "INR",
    timezone: "UTC",
    colourProfile: null,
    designSystem: null,
    ingestEnabled: true,
    meta: null,
    createdAt: "2026-11-14T00:00:00.000Z",
  };
  expect(adminOrganizationDtoSchema.safeParse({ ...dto, energyFeatures: "auto", cardPrimaryMetric: "auto" }).success).toBe(true);
  expect(adminOrganizationDtoSchema.safeParse({ ...dto, cardPrimaryMetric: "auto" }).success).toBe(false);
  expect(adminOrganizationDtoSchema.safeParse({ ...dto, energyFeatures: "auto" }).success).toBe(false);
  expect(adminOrganizationDtoSchema.safeParse({ ...dto, energyFeatures: "maybe", cardPrimaryMetric: "auto" }).success).toBe(false);
}
