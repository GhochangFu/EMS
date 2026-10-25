import { expect } from "vitest";

import {
  convertMaintenanceBodySchema,
  copilotActivateMaintenanceScheduleModelBodySchema,
  copilotDeactivateMaintenanceScheduleModelBodySchema,
  createMaintenanceScheduleBodySchema,
  updateMaintenanceScheduleBodySchema,
} from "./maintenance-writes";
import { maintenanceScheduleItemSchema } from "./operations";

/**
 * `F4.281` (ADR 0099 Amendment 8, ADR 0030) — the maintenance schedule write
 * bodies, moved from `apps/api/src/maintenance/maintenance.schema.ts`.
 * Vitest entry point: the sibling `.test.ts`.
 */

const ASSET = "22222222-2222-4222-8222-222222222222";

const CREATE = { assetId: ASSET, title: "Quarterly filter check", intervalDays: 90, firstDueAt: "2026-11-01T09:00:00.000Z" };

export function theCreateBodyRefusesAnUnknownKey(): void {
  expect(createMaintenanceScheduleBodySchema.safeParse({ ...CREATE, colour: "red" }).success).toBe(false);
}

export function theCreateBodyFillsItsDefaults(): void {
  const parsed = createMaintenanceScheduleBodySchema.parse(CREATE);
  expect({ priority: parsed.priority, estimatedMinutes: parsed.estimatedMinutes }).toEqual({ priority: "medium", estimatedMinutes: 60 });
}

export function theCreateBodyRefusesAFirstDueAtWithoutAnInstant(): void {
  expect(createMaintenanceScheduleBodySchema.safeParse({ ...CREATE, firstDueAt: "2026-11-01" }).success).toBe(false);
}

export function theUpdateBodyRequiresActive(): void {
  expect(updateMaintenanceScheduleBodySchema.safeParse({ reason: "Season over" }).success).toBe(false);
}

export function theUpdateBodyRefusesAShortReason(): void {
  expect(updateMaintenanceScheduleBodySchema.safeParse({ active: false, reason: "no" }).success).toBe(false);
}

/** Owner ruling DC1 (2026-10-24): each direction's model body fixes `active` and keeps the optional reason. */
export function eachDirectionModelBodyFixesActive(): void {
  expect(copilotDeactivateMaintenanceScheduleModelBodySchema.safeParse({ active: false, reason: "Season over" }).success).toBe(true);
  expect(copilotDeactivateMaintenanceScheduleModelBodySchema.safeParse({ active: true }).success).toBe(false);
  expect(copilotActivateMaintenanceScheduleModelBodySchema.safeParse({ active: true }).success).toBe(true);
  expect(copilotActivateMaintenanceScheduleModelBodySchema.safeParse({ active: false }).success).toBe(false);
}

/** Owner ruling DC2: a list item carries its `active` state. */
export function theScheduleItemRequiresActive(): void {
  const shape = maintenanceScheduleItemSchema.shape as Record<string, unknown>;
  expect(shape.active).toBeDefined();
  expect(maintenanceScheduleItemSchema.shape.active.safeParse(undefined).success).toBe(false);
}

/** `F4.284` (ADR 0106 decision 5): the convert body moved here from the API. */
export function theConvertBodyIsStrict(): void {
  expect(convertMaintenanceBodySchema.safeParse({ notes: "Quarterly check", extra: 1 }).success).toBe(false);
}

export function theConvertBodyRefusesShortNotes(): void {
  expect(convertMaintenanceBodySchema.safeParse({ notes: "ok" }).success).toBe(false);
}
