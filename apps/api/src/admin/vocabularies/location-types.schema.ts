import { CATALOG_CODE_MESSAGE, CATALOG_CODE_PATTERN } from "@bms/shared";
import { z } from "zod";

/**
 * `F4.162` (ADR 0077 Amendment 1, plan D4) — the `:code` path parameter of
 * `admin/vocabularies/location-types`, and the bound every create body's `code`
 * reuses.
 *
 * **Declared here with this package's own `z`, not imported from
 * `@bms/shared`.** `asset-roles.schema.ts`'s header records the measurement: a
 * `ZodError` thrown by a shared schema failed `err instanceof ZodError` under
 * Vitest (ESM `zod` here, CJS `dist` there) and escaped the controller's 400
 * mapping. The bound is `locationTypeCodeSchema`'s — `min(1).max(32)`, the
 * width of `bms.location_types.code varchar(32)` — and
 * `tests/f4.162-location-type-write-path.test.ts` holds the two together.
 * `CATALOG_CODE_PATTERN` below is a plain `RegExp`, so importing it carries no
 * `ZodError` across the package line.
 */
export const locationTypeCodeParamSchema = z.string().min(1).max(32);

/**
 * The ruled spelling of a location-type code (owner ruling OQ1): lower
 * snake_case, starting with a letter — the shape of the four seeded codes
 * `smoc_campus`, `rsmoc`, `csmoc`, `pump_station`. The onboarding chat's
 * label/code matcher folds case, so `PUMP_STATION` would alias `pump_station`
 * there while being a distinct row here.
 */
export const LOCATION_TYPE_CODE_MESSAGE =
  "a location type code is lower-case letters, digits and '_', and starts with a letter — like pump_station";

/**
 * The create body. `.strict()` per ADR 0029: `bms.location_types` has no
 * `organization_id`, and a caller sending one must get a 400, not have it
 * silently dropped.
 */
export const createLocationTypeBodySchema = z
  .object({
    // `F2.23` / ADR 0065 decision 1: the catalog class beside the length bound,
    // and OQ1's narrower class after it. The second is a strict subset of the
    // first; both run, and Zod reports every issue.
    code: locationTypeCodeParamSchema
      .regex(CATALOG_CODE_PATTERN, CATALOG_CODE_MESSAGE)
      .regex(/^[a-z][a-z0-9_]*$/, LOCATION_TYPE_CODE_MESSAGE),
    label: z.string().min(1).max(128),
    /** Optional; the column default (0) stands when it is omitted. */
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .strict();

/**
 * The PATCH body: `label` and `sortOrder`, each optional. No `code` — it is
 * the primary key and the target of `locations.type`'s foreign key, and ADR
 * 0077 Amendment 1 rules it not editable. `.strict()` is what turns a body
 * naming `code` into a 400. No `active`: retirement is
 * `POST :code/deactivate`, the `PointKeysAdminController` shape.
 */
export const updateLocationTypeBodySchema = createLocationTypeBodySchema
  .omit({ code: true })
  .partial()
  .strict();

export type CreateLocationTypeBody = z.infer<typeof createLocationTypeBodySchema>;
export type UpdateLocationTypeBody = z.infer<typeof updateLocationTypeBodySchema>;
