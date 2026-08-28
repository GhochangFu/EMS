import type { WorkOrderPriority } from "@bms/shared";
import { z } from "zod";

export const maintenanceCategorySchema = z.enum([
  "preventive",
  "predictive",
  "condition_based",
  "compliance",
  "amc",
  "calibration",
  "runtime_based",
  "seasonal",
  "inspection_round",
  "corrective_follow_up",
  "deferred_backlog",
  "shutdown_outage",
  "energy_optimization",
  "safety_critical",
]);

/** Extracted and exported for the same reason as the category enum — ADR 0019
 * §4 binds a template's `content.maintenance` to this vocabulary.
 *
 * `@bms/shared`'s `WorkOrderPriority` is the *type-level* source for this
 * vocabulary, but it cannot be the runtime source: `@bms/shared` has no runtime
 * dependencies by design, so a Zod enum there would add one — the manifest
 * change AGENTS.md §9.4 gates. That is ADR 0019 §8, which supersedes ADR 0015
 * resolved-decision 2 on where the schema lives. The two are bound by the
 * assertion at the foot of this file instead. */
export const maintenancePrioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const maintenanceGenerationModeSchema = z.enum([
  "manual",
  "calendar",
  "runtime",
  "condition",
  "predictive",
]);

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

