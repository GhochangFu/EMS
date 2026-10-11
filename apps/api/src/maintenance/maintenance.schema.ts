import {
  maintenanceGenerationModeSchema as sharedMaintenanceGenerationModeSchema,
  maintenanceScheduleCategorySchema,
  workOrderPrioritySchema,
} from "@bms/shared";
import type { WorkOrderPriority } from "@bms/shared";
import { z } from "zod";

/**
 * The three maintenance vocabularies, re-exported from `@bms/shared` rather than
 * declared here since `F3.85` PR 11a. ADR 0019 §4 binds a template's
 * `content.maintenance` to them, and that contract moved to
 * `packages/shared/src/contracts/asset-template-content-writes.ts`; the shared
 * definitions already existed with the same values in the same order
 * (`contracts/operations.ts`), so a second `z.enum` here would be a copy that
 * drifts. ADR 0030 gave `@bms/shared` its `zod` runtime, which retired the
 * reason this file used to declare them (ADR 0019 §8).
 */
export const maintenanceCategorySchema = maintenanceScheduleCategorySchema;

/** The *type-level* `WorkOrderPriority` and this runtime schema are still bound
 * by the assertion at the foot of this file. */
export const maintenancePrioritySchema = workOrderPrioritySchema;

export const maintenanceGenerationModeSchema = sharedMaintenanceGenerationModeSchema;

export const listMaintenanceQuerySchema = z.object({
  assetId: z.string().uuid().optional(),
  category: maintenanceCategorySchema.optional(),
  dueState: z.enum(["all", "overdue", "upcoming"]).default("all"),
  /** Derived rather than restated: the `"all"` sentinel is a filter-only value
   * that `maintenancePrioritySchema` must not carry, but the four real values
   * behind it are the same vocabulary and must not drift from it. */
  priority: z.enum(["all", ...maintenancePrioritySchema.options]).default("all"),
  horizonDays: z.coerce.number().int().min(1).max(120).default(30),
});

export const convertMaintenanceBodySchema = z
  .object({
    notes: z.string().min(3).max(2000).optional(),
  })
  .strict();

export const createMaintenanceScheduleBodySchema = z
  .object({
    assetId: z.string().uuid(),
    title: z.string().min(3).max(255),
    description: z.string().max(4000).optional(),
    category: maintenanceCategorySchema.default("preventive"),
    generationMode: maintenanceGenerationModeSchema.default("calendar"),
    ownerTeam: z.string().max(128).optional(),
    vendorName: z.string().max(128).optional(),
    complianceRef: z.string().max(128).optional(),
    triggerSummary: z.string().max(2000).optional(),
    safetyCritical: z.boolean().default(false),
    priority: maintenancePrioritySchema.default("medium"),
    estimatedMinutes: z.number().int().min(5).max(1_440).default(60),
    intervalDays: z.number().int().min(1).max(730),
    firstDueAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const updateMaintenanceScheduleBodySchema = z
  .object({
    active: z.boolean(),
    reason: z.string().min(3).max(2000).optional(),
  })
  .strict();

export type ListMaintenanceQuery = z.infer<typeof listMaintenanceQuerySchema>;
export type ConvertMaintenanceBody = z.infer<
  typeof convertMaintenanceBodySchema
>;
export type CreateMaintenanceScheduleBody = z.infer<
  typeof createMaintenanceScheduleBodySchema
>;
export type UpdateMaintenanceScheduleBody = z.infer<
  typeof updateMaintenanceScheduleBodySchema
>;

/**
 * Compile-time drift guard, same shape and same reason as the one in
 * `admin/asset-templates/asset-templates-content.schema.ts`: the priority
 * vocabulary has a type-level home in `@bms/shared` and a runtime home here,
 * and nothing links them at runtime. Asserting both directions means adding a
 * value to one and not the other stops `pnpm typecheck`.
 *
 * Scope: this binds the *write-path* vocabulary to the shared type. It does not
 * make the service-layer `r.priority as WorkOrderPriority` casts sound — those
 * columns are `varchar(32)` with no CHECK constraint, so a row written outside
 * this schema can still hold anything.
 */
type AssertAssignable<A extends B, B> = A;

/** Both directions, and both exported so `noUnusedLocals` cannot quietly delete
 * the guard along with the protection it provides. */
export type MaintenancePriorityMatchesShared = AssertAssignable<
  z.infer<typeof maintenancePrioritySchema>,
  WorkOrderPriority
>;
export type SharedMatchesMaintenancePriority = AssertAssignable<
  WorkOrderPriority,
  z.infer<typeof maintenancePrioritySchema>
>;

