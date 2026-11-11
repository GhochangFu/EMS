/**
 * `E3.1` (ADR 0122 decision 2.4, rulings P8 and R4) — the global-admin surface for an
 * asset domain's work-order reference prefix:
 * `GET /admin/vocabularies/asset-domains` and `PATCH /admin/vocabularies/asset-domains/:code`.
 *
 * Only the prefix is editable. A domain's `code` is a primary key that assets, templates
 * and rules reference, and its label, order and `active` flag have no admin route in this
 * row; `.strict()` turns a body that names any of them into a 400 instead of a silent drop.
 */
import { z } from "zod";

import { workOrderPrefixSchema } from "./work-orders";

/** One asset domain as the admin screen reads it. `workOrderPrefix: null` reads `GEN` on a ticket. */
export const adminAssetDomainDtoSchema = z.object({
  code: z.string(),
  label: z.string(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  workOrderPrefix: workOrderPrefixSchema.nullable(),
});

/** `GET /admin/vocabularies/asset-domains`: every domain, active and retired, in `sortOrder`. */
export const adminAssetDomainsListResponseSchema = z.object({
  items: z.array(adminAssetDomainDtoSchema),
});

/**
 * `PATCH /admin/vocabularies/asset-domains/:code`: the prefix, required. Two to eight
 * upper-case letters or digits, or `null` to clear it (tickets then read `GEN`). A ticket
 * already created keeps its reference (decision 2.3): only later tickets take the new prefix.
 */
export const updateAssetDomainBodySchema = z
  .object({
    workOrderPrefix: workOrderPrefixSchema.nullable(),
  })
  .strict();

export type UpdateAssetDomainBody = z.infer<typeof updateAssetDomainBodySchema>;
