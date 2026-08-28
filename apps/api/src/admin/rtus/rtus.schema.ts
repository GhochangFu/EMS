import { z } from "zod";

export const rtuSourceTypeSchema = z.enum(["mqtt", "simulator", "catalog"]);

export const createRtuBodySchema = z
  .object({
    locationId: z.string().uuid(),
    code: z.string().min(2).max(64),
    displayName: z.string().min(2).max(255),
    sourceType: rtuSourceTypeSchema.default("catalog"),
    domain: z.string().max(64).optional(),
    externalRtuId: z.number().int().optional(),
    rtuCode: z.string().max(64).optional(),
    mqttTopic: z.string().max(255).optional(),
    stationCode: z.string().max(64).optional(),
    stationName: z.string().max(255).optional(),
    ingestEnabled: z.boolean().optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .strict();

export const updateRtuBodySchema = createRtuBodySchema.omit({ locationId: true }).partial();

export type CreateRtuBody = z.infer<typeof createRtuBodySchema>;
export type UpdateRtuBody = z.infer<typeof updateRtuBodySchema>;
