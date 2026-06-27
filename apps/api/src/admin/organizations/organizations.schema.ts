import { z } from "zod";

export const createOrganizationBodySchema = z.object({
  code: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Z0-9_-]+$/),
  name: z.string().min(2).max(255),
  meta: z.record(z.unknown()).optional(),
});

export const updateOrganizationBodySchema = z.object({
  name: z.string().min(2).max(255).optional(),
  meta: z.record(z.unknown()).optional(),
});

export type CreateOrganizationBody = z.infer<typeof createOrganizationBodySchema>;
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationBodySchema>;
