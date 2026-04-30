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
  priority: z.enum(["all", "low", "medium", "high", "critical"]).default("all"),
  horizonDays: z.coerce.number().int().min(1).max(120).default(30),
});

export const convertMaintenanceBodySchema = z.object({
  notes: z.string().min(3).max(2000).optional(),
});

export const createMaintenanceScheduleBodySchema = z.object({
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
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  estimatedMinutes: z.number().int().min(5).max(1_440).default(60),
  intervalDays: z.number().int().min(1).max(730),
  firstDueAt: z.string().datetime({ offset: true }),
});

export const updateMaintenanceScheduleBodySchema = z.object({
  active: z.boolean(),
  reason: z.string().min(3).max(2000).optional(),
});

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
