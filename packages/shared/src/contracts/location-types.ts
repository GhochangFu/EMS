/**
 * The location-type vocabulary (`F4.157`, ADR 0077) — `bms.location_types`.
 *
 * `locationTypeCodeSchema` replaces the closed `z.enum(["smoc_campus",
 * "rsmoc", "csmoc"])` literal that used to sit inline in `admin.ts`, `auth.ts`,
 * `dashboard.ts` and `onboarding.ts`: the type is now a lookup-table row, not a
 * fixed set the schema can enumerate, so the shared schema only bounds the
 * shape a code can take (a non-empty string up to the column width) and the
 * two write paths refuse a code that is not a live row (D2, D4). A NEW file
 * rather than an addition to `admin.ts` or `dashboard.ts` — D1's reason is an
 * import cycle: `auth.ts`, `dashboard.ts` and `onboarding.ts` would otherwise
 * have to import the schema from one another.
 */
import { z } from "zod";

/** `bms.location_types.code` — and so `bms.locations.type` — is `varchar(32)`. */
export const locationTypeCodeSchema = z.string().min(1).max(32);

/** One row of `GET /api/v1/admin/location-types`. */
export const locationTypeDtoSchema = z.object({
  code: z.string(),
  label: z.string(),
});

/**
 * One row of `GET /admin/vocabularies/location-types` — the global-admin
 * catalog view (`F4.162`, ADR 0077 Amendment 1, plan D3). A fresh plain
 * object, not `locationTypeDtoSchema.extend(…)`: ADR 0030 Amendment 1 rule 2
 * forbids the flattening combinators for a derived contract, and this row
 * carries fields (`sortOrder`, `active`, `createdAt`, `locationCount`) the
 * dropdown-facing DTO above never needs.
 */
export const adminLocationTypeDtoSchema = z.object({
  code: z.string(),
  label: z.string(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
  /** `count(locations.id)` over every `bms.locations` row of this type,
   * inactive locations included (OQ4). */
  locationCount: z.number().int().nonnegative(),
});
