import { z } from "zod";

import { scopeIdQueryField } from "../auth/asset-scope.schema";

/**
 * `E1.5a` / ADR 0138 (plan T1.8) — `GET /degradation?organizationId=&locationId=`:
 * the two scope keys the advisories list takes, each an optional lower-cased
 * uuid that `AssetFilterScopeService.narrow` ANDs onto the caller's readable
 * assets. They narrow and never widen: a key outside scope answers `assets: []`,
 * not 403. `.strict()`: a group, an asset or a misspelt key is a 400. Registered
 * as `DegradationController_list`. `GET /assets/:assetId/degradation` takes no query.
 */
export const degradationQuerySchema = z
  .object({
    organizationId: scopeIdQueryField,
    locationId: scopeIdQueryField,
  })
  .strict();

export type DegradationQuery = z.infer<typeof degradationQuerySchema>;
