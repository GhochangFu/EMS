import { z } from "zod";

export const createAssetBodySchema = z.object({
  code: z.string().min(2).max(64),
  name: z.string().min(2).max(255),
  siteName: z.string().min(2).max(255),
  locationId: z.string().uuid(),
  rtuId: z.string().uuid(),
  domain: z.string().min(2).max(64),
  meta: z.record(z.unknown()).optional(),
});

export const updateAssetBodySchema = createAssetBodySchema.partial();

export type CreateAssetBody = z.infer<typeof createAssetBodySchema>;
export type UpdateAssetBody = z.infer<typeof updateAssetBodySchema>;
