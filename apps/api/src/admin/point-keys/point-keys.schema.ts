import { z } from "zod";

export const createPointKeyBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    code: z.string().min(1).max(128),
    name: z.string().min(1).max(255),
    domain: z.string().max(64).optional(),
    unit: z.string().max(32).optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();

export const updatePointKeyBodySchema = createPointKeyBodySchema
  .omit({ organizationId: true, code: true })
  .partial();

export type CreatePointKeyBody = z.infer<typeof createPointKeyBodySchema>;
export type UpdatePointKeyBody = z.infer<typeof updatePointKeyBodySchema>;
