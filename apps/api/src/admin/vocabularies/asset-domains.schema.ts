import { z } from "zod";

/**
 * `E3.1` (ADR 0122 rulings P8 and R4) — the `:code` path parameter of
 * `PATCH /admin/vocabularies/asset-domains/:code`.
 *
 * Declared here with this package's own `z`, not imported from `@bms/shared`, for the
 * reason `location-types.schema.ts` records: a `ZodError` thrown by a shared schema
 * fails `err instanceof ZodError` under Vitest and escapes the controller's 400 mapping.
 * The bound is the column's: `bms.asset_domains.code varchar(64)`, lower-case
 * letters, digits and underscores.
 */
export const assetDomainCodeParamSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
