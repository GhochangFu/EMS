import { z } from "zod";

import { ML_FINDINGS_KINDS } from "@bms/shared";

import { scopeIdQueryField } from "../auth/asset-scope.schema";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 10 (plan R-c, T3.4) — the query of
 * `GET /ml/findings/paragraph`: the required `kind` and the summary routes' four
 * scope keys, each an optional lower-cased uuid that `AssetFilterScopeService.narrow`
 * ANDs onto the caller's readable assets. `.strict()`: an unknown key is a 400.
 * Registered as `FindingsParagraphController_get`.
 */
export const findingsParagraphQuerySchema = z
  .object({
    kind: z.enum(ML_FINDINGS_KINDS),
    organizationId: scopeIdQueryField,
    locationId: scopeIdQueryField,
    assetGroupId: scopeIdQueryField,
    assetId: scopeIdQueryField,
  })
  .strict();

export type FindingsParagraphQuery = z.infer<typeof findingsParagraphQuerySchema>;
