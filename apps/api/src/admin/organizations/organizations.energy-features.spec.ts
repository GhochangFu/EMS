import { expect } from "vitest";

import { CARD_PRIMARY_METRICS, ENERGY_FEATURES, adminOrganizationDtoSchema } from "@bms/shared";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import type { MasterDataAuditService } from "../master-data-audit.service";
import { createOrganizationBodySchema, updateOrganizationBodySchema } from "./organizations.schema";
import { OrganizationsAdminService } from "./organizations.service";

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

/**
 * S6 (plan D3) — a stored value outside either list (migration 0153's CHECKs forbid it) reads as
 * `auto` on the DTO, never a 500. Driven through `setIngestEnabled` with the stored switch value,
 * which only reads the row and maps it: no update, no audit.
 */
export async function runAnOutOfListStoredValueReadsAsAuto(): Promise<void> {
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    code: "F4364-S6",
    name: "F4.364 S6",
    active: true,
    meta: null,
    currency: "INR",
    timezone: "UTC",
    colourProfile: null,
    designSystem: null,
    ingestEnabled: true,
    energyFeatures: "maybe",
    cardPrimaryMetric: "teal",
    createdAt: new Date(0),
  };
  const tenantDb = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
  } as unknown as BmsDb;
  const access = {
    requireMasterDataUser: async () => ({ role: "admin" }),
    assertAdminRole: () => undefined,
  } as unknown as AccessControlService;
  const audit = { write: async () => undefined } as unknown as MasterDataAuditService;
  const svc = new OrganizationsAdminService({} as BmsDb, tenantDb, access, audit);
  const dto = await svc.setIngestEnabled({ sub: "u", email: "a@bms.local", role: "admin" } as JwtPayload, row.id, true);
  expect(dto).toMatchObject({ energyFeatures: "auto", cardPrimaryMetric: "auto" });
  expect(adminOrganizationDtoSchema.safeParse(dto).success).toBe(true);
}
