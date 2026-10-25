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
  /**
   * `F4.281` (Amendment 8, owner ruling DC3): list deactivated schedules too, so
   * the Schedule Centre can reach the Activate stepper. A string enum, not
   * `z.coerce.boolean()`, which reads `"false"` as `true` (`telemetry.schema.ts`).
   */
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

/**
 * `F4.281` (ADR 0099 Amendment 8, ADR 0030): the two schedule write bodies
 * live in `packages/shared/src/contracts/maintenance-writes.ts`, so the copilot
 * catalog carries the route's own export by identity. Re-exported here under
 * their old names for the service and this file's spec; the controller and the
 * OpenAPI registry import them from `@bms/shared`. `F4.284` (ADR 0106 decision 5)
 * moved the convert body there too.
 */
export {
  convertMaintenanceBodySchema,
  createMaintenanceScheduleBodySchema,
  updateMaintenanceScheduleBodySchema,
} from "@bms/shared";
export type {
  ConvertMaintenanceBody,
  CreateMaintenanceScheduleBody,
  UpdateMaintenanceScheduleBody,
} from "@bms/shared";

export type ListMaintenanceQuery = z.infer<typeof listMaintenanceQuerySchema>;

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

