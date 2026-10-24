import { z } from "zod";

import { maintenanceGenerationModeSchema, maintenanceScheduleCategorySchema, workOrderPrioritySchema } from "./operations";

/**
 * `F4.281` (ADR 0099 Amendment 8, ADR 0030) — the request bodies of the
 * maintenance schedule write routes (`apps/api/src/maintenance/maintenance.controller.ts`),
 * moved here from `apps/api/src/maintenance/maintenance.schema.ts` so the
 * copilot catalog entries carry the route's own body by identity. The API
 * schema file keeps the list query, the convert body (an excluded route) and
 * the priority drift guard, and re-exports these under their old names.
 *
 * Plain `z.object`s (the `rule-writes.ts` pattern): no `.merge()`, no
 * `.omit().extend()` — `tests/adr-0030-contract-derivation.test.ts` scans for
 * both — no `z.intersection`, since nothing here is composed, and no
 * `.readonly()`, since nothing here is all-readonly. Both route bodies are
 * `.strict()` and carry a ledger entry in `apps/api/src/testing/strict-body-ledger.data.ts`.
 */

export const createMaintenanceScheduleBodySchema = z
  .object({
    assetId: z.string().uuid(),
    title: z.string().min(3).max(255),
    description: z.string().max(4000).optional(),
    category: maintenanceScheduleCategorySchema.default("preventive"),
    generationMode: maintenanceGenerationModeSchema.default("calendar"),
    ownerTeam: z.string().max(128).optional(),
    vendorName: z.string().max(128).optional(),
    complianceRef: z.string().max(128).optional(),
    triggerSummary: z.string().max(2000).optional(),
    safetyCritical: z.boolean().default(false),
    priority: workOrderPrioritySchema.default("medium"),
    estimatedMinutes: z.number().int().min(5).max(1_440).default(60),
    intervalDays: z.number().int().min(1).max(730),
    firstDueAt: z.string().datetime({ offset: true }),
  })
  .strict();

/** The optional reason the audit row records (`maintenance.service.ts` writes a default sentence without one). */
const maintenanceReasonSchema = z.string().min(3).max(2000).optional();

export const updateMaintenanceScheduleBodySchema = z
  .object({
    active: z.boolean(),
    reason: maintenanceReasonSchema,
  })
  .strict();

/**
 * Owner ruling DC1 (2026-10-24, Amendment 8 D3): `maintenanceSchedule.deactivate`
 * and `.activate` are one entry per direction on the PATCH, each with an optional
 * reason, so the audit row records why. The model's body fixes `active` per
 * direction; the route still parses {@link updateMaintenanceScheduleBodySchema}.
 */
export const copilotDeactivateMaintenanceScheduleModelBodySchema = z
  .object({
    active: z.literal(false),
    reason: maintenanceReasonSchema,
  })
  .strict();

export const copilotActivateMaintenanceScheduleModelBodySchema = z
  .object({
    active: z.literal(true),
    reason: maintenanceReasonSchema,
  })
  .strict();

export type CreateMaintenanceScheduleBody = z.infer<typeof createMaintenanceScheduleBodySchema>;
/** What a caller sends: the defaulted fields may be left out. */
export type CreateMaintenanceScheduleInput = z.input<typeof createMaintenanceScheduleBodySchema>;
export type UpdateMaintenanceScheduleBody = z.infer<typeof updateMaintenanceScheduleBodySchema>;
