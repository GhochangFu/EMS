import { z } from "zod";

export const workOrderStatusSchema = z.enum([
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
]);

export const workOrderPrioritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const createWorkOrderBodySchema = z
  .object({
    assetId: z.string().uuid(),
    alarmId: z.string().uuid().optional(),
    title: z.string().min(3).max(255),
    description: z.string().max(4000).optional(),
    priority: workOrderPrioritySchema.default("medium"),
    assignedTo: z.string().uuid().optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const updateWorkOrderStatusBodySchema = z
  .object({
    status: workOrderStatusSchema,
    reason: z.string().min(3).max(2000).optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .strict();

export const closeWorkOrderBodySchema = z
  .object({
    reason: z.string().min(3).max(2000),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();

export const reorderWorkOrdersBodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            status: workOrderStatusSchema,
            sortOrder: z.number().int().min(0).max(100_000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    reason: z.string().min(3).max(2000).optional(),
  })
  .strict();

export type CreateWorkOrderBody = z.infer<typeof createWorkOrderBodySchema>;
export type UpdateWorkOrderStatusBody = z.infer<
  typeof updateWorkOrderStatusBodySchema
>;
export type CloseWorkOrderBody = z.infer<typeof closeWorkOrderBodySchema>;
export type ReorderWorkOrdersBody = z.infer<typeof reorderWorkOrdersBodySchema>;
