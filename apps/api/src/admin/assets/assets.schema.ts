import { z } from "zod";

export const createAssetBodySchema = z.object({
  code: z.string().min(2).max(64),
  name: z.string().min(2).max(255),
  siteName: z.string().min(2).max(255),
  locationId: z.string().uuid(),
  // ADR 0018: optional. Omit for an asset whose points are hand-entered or
  // computed; pass null on update to unwire an existing one.
  rtuId: z.string().uuid().nullish(),
  domain: z.string().min(2).max(64),
  meta: z.record(z.unknown()).optional(),
});

export const updateAssetBodySchema = createAssetBodySchema.partial();

export type CreateAssetBody = z.infer<typeof createAssetBodySchema>;
export type UpdateAssetBody = z.infer<typeof updateAssetBodySchema>;
