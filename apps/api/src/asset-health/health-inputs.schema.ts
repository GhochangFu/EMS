import { z } from "zod";

import { scopeIdQueryField } from "../auth/asset-scope.schema";

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan T1.6, R-d) — `GET /asset-health/bad-actors`'s query.
 *
 * The two scope keys the health summary takes, lower-cased before any scope check
 * (`scopeIdQueryField`), and nothing else: no `windowMinutes` (the rule score in the list is the
 * default one-day score the donut and the asset card show, plan §14) and no `assetGroupId` (the
 * route narrows the way the summary does, not with `AssetFilterScopeService.narrow`, R-d).
 * `.strict()`, so an unknown key is a 400. In a `*.schema.ts`, not the controller, so the OpenAPI
 * registry can see it (ADR 0029). `GET /asset-health/assets/:assetId/inputs` takes no query.
 */
export const healthBadActorsQuerySchema = z
  .object({
    organizationId: scopeIdQueryField,
    locationId: scopeIdQueryField.describe("the node and every node under it (ADR 0098 decision 7)"),
  })
  .strict();

export type HealthBadActorsQuery = z.infer<typeof healthBadActorsQuerySchema>;
