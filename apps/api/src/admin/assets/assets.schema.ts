import { assetDomainCodeSchema } from "@bms/shared";
import { z } from "zod";

export const createAssetBodySchema = z.object({
  code: z.string().min(2).max(64),
  name: z.string().min(2).max(255),
  siteName: z.string().min(2).max(255),
  locationId: z.string().uuid(),
  // ADR 0018: optional. Omit for an asset whose points are hand-entered or
  // computed; pass null on update to unwire an existing one.
  rtuId: z.string().uuid().nullish(),
  // ADR 0031 Amendment 1: **shape only**. The plant vocabulary is data
  // (`bms.asset_domains`), so this schema cannot list the valid codes — the
  // check that the code is live happens in `AssetsService` via
  // `VocabulariesService.assertAssetDomain`, which is what keeps an unknown
  // domain a 400 naming the options rather than a 500 from `assets_domain_fk`.
  domain: assetDomainCodeSchema,
  meta: z.record(z.unknown()).optional(),
});

export const updateAssetBodySchema = createAssetBodySchema.partial();

export type CreateAssetBody = z.infer<typeof createAssetBodySchema>;
export type UpdateAssetBody = z.infer<typeof updateAssetBodySchema>;
