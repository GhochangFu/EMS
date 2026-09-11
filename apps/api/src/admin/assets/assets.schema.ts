import { assetDomainCodeSchema, CATALOG_CODE_MESSAGE, CATALOG_CODE_PATTERN } from "@bms/shared";
import { z } from "zod";

export const createAssetBodySchema = z
  .object({
    // F2.23 / ADR 0065 decision 1: the catalog class, beside the length bound.
    // Zod runs every check and reports every issue, so `.max()` does not gate
    // the regex; the class is one anchored character class and linear anyway.
    code: z.string().min(2).max(64).regex(CATALOG_CODE_PATTERN, CATALOG_CODE_MESSAGE),
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
  })
  .strict();

export const updateAssetBodySchema = createAssetBodySchema.partial();

export type CreateAssetBody = z.infer<typeof createAssetBodySchema>;
export type UpdateAssetBody = z.infer<typeof updateAssetBodySchema>;
