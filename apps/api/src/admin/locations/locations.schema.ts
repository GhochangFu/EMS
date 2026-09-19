import { z } from "zod";

export const locationTypeSchema = z.enum(["smoc_campus", "rsmoc", "csmoc"]);

export const createLocationBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    code: z.string().min(2).max(64),
    slug: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9-]+$/),
    name: z.string().min(2).max(255),
    type: locationTypeSchema,
    province: z.string().max(64).optional(),
    capital: z.string().max(128).optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    // E4.1b (ADR 0070 decision 6): an IANA zone name, validated against
    // pg_timezone_names by the service; `null` clears, absent leaves it.
    timezone: z.string().max(64).nullable().optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .strict();

export const updateLocationBodySchema = createLocationBodySchema
  .omit({ organizationId: true })
  .partial();

export type CreateLocationBody = z.infer<typeof createLocationBodySchema>;
export type UpdateLocationBody = z.infer<typeof updateLocationBodySchema>;
