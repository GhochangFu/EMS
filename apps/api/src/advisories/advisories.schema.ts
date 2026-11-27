import { z } from "zod";

import { scopeIdQueryField } from "../auth/asset-scope.schema";

/**
 * `E1.6a` / ADR 0137 decision 5 (plan T1.7) — `GET /advisories?organizationId=&locationId=`:
 * the two scope keys the Anomalies and Forecasts lists take, each an optional lower-cased
 * uuid that `AssetFilterScopeService.narrow` ANDs onto the caller's readable assets. They
 * narrow and never widen: a key outside scope answers `advisories: []`, not 403. `.strict()`:
 * a group, an asset or a misspelt key is a 400. Registered as `AdvisoriesController_list`.
 * `GET /assets/:assetId/advisories` takes no query.
 */
export const advisoriesQuerySchema = z
  .object({
    organizationId: scopeIdQueryField,
    locationId: scopeIdQueryField,
  })
  .strict();

export type AdvisoriesQuery = z.infer<typeof advisoriesQuerySchema>;
