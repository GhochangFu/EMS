import { z } from "zod";

export const createAssetPointBodySchema = z.object({
  assetId: z.string().uuid(),
  pointKey: z.string().min(1).max(128),
  sourceDataKey: z.string().min(1).max(128),
  sensorCode: z.string().max(64).optional(),
  unit: z.string().max(32).optional(),
});

export const updateAssetPointBodySchema = createAssetPointBodySchema
  .omit({ assetId: true })
  .partial();

export type CreateAssetPointBody = z.infer<typeof createAssetPointBodySchema>;
export type UpdateAssetPointBody = z.infer<typeof updateAssetPointBodySchema>;
