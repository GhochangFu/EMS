/**
 * `F3.78` / ADR 0089 decision 7 — the asset-group write bodies. They live
 * beside `admin.ts`, not in it: that file sits at the AGENTS.md §4.5 line cap.
 * All plain objects, so no `.merge()`, `z.intersection` or `.readonly()` is
 * needed (ADR 0030).
 */
import { z } from "zod";

import { CATALOG_CODE_MESSAGE, CATALOG_CODE_PATTERN } from "../constants";
import { assetRoleCodeSchema } from "./operations";

/**
 * `POST /api/v1/admin/asset-groups`. `code` takes the shared catalog-code rule
 * and joins `catalog-code-charset.spec.ts`. `domain` is a vocabulary code the
 * service checks is live, so a retired one is a 400 and not the foreign key's 500.
 */
export const createAssetGroupBodySchema = z.object({
  locationId: z.string().uuid(),
  code: z.string().min(1).max(64).regex(CATALOG_CODE_PATTERN, CATALOG_CODE_MESSAGE),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  domain: z.string().min(1).max(64).nullable().optional(),
});

/**
 * `PATCH /api/v1/admin/asset-groups/:id`. **No `code`, and `.strict()` makes
 * that load-bearing**: a dashboard tab and a site template resolve a group by
 * its code, so a rename is a different group. A client that sends `code` must
 * be told, not have it dropped and answered 200.
 */
export const updateAssetGroupBodySchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).nullable().optional(),
    domain: z.string().min(1).max(64).nullable().optional(),
  })
  .strict();

/** `POST /api/v1/admin/asset-groups/:id/members` — `role` is checked by `assertAssetRole`. */
export const addAssetGroupMemberBodySchema = z.object({
  assetId: z.string().uuid(),
  role: assetRoleCodeSchema.nullable().optional(),
});
