import { z } from "zod";

/**
 * The `:code` path parameter, and the bound every request body's `code` reuses.
 *
 * **DECLARED HERE WITH THIS PACKAGE'S OWN `z`, NOT IMPORTED FROM `@bms/shared`,
 * AND THAT IS A CORRECTNESS FIX RATHER THAN A PREFERENCE.** The first draft
 * parsed the param with `assetRoleCodeSchema` straight out of the contracts
 * package. Both packages resolve the same `zod` on disk, but they do not always
 * resolve the same MODULE INSTANCE — under Vitest `apps/api` loads zod as ESM
 * while `@bms/shared` arrives from its CJS `dist`, so the `ZodError` thrown by
 * a shared schema failed `err instanceof ZodError` in
 * `asset-roles.controller.ts` and escaped the 400 mapping as a 500. Measured:
 * `controller.update("", …)` threw a raw `ZodError`, not a
 * `BadRequestException`.
 *
 * A shared schema nested INSIDE a local `z.object` is safe — the outer object
 * builds the error — which is why only the bare param parse was affected and
 * why the body path returned 400 correctly over HTTP. Declaring the bound once
 * here removes the distinction rather than relying on it.
 *
 * The bound is `min(1).max(64)`, the same as `assetRoleCodeSchema` and the same
 * as `code varchar(64)`. `point-keys.schema.ts` declares its own bound locally
 * for the same reason, so this is the house pattern and not a new one.
 * `tests/f3.40-asset-role-write-path.test.ts` holds the two together.
 */
export const assetRoleCodeParamSchema = z.string().min(1).max(64);

/**
 * `F3.40` / ADR 0051 decision 5 — the request bodies for the asset role write
 * path.
 *
 * The RESPONSE type is not declared here. It is `assetRoleDtoSchema` in
 * `@bms/shared`, which `GET /api/v1/vocabularies` already serves, and ADR 0030
 * requires every response type to be `z.infer`red from a contract rather than
 * restated beside the controller. A second shape here would let the two drift
 * and give a caller two answers to "what is an asset role".
 *
 * `.strict()` per ADR 0029, so a body carrying a field this vocabulary does not
 * have gets a 400 instead of having it silently dropped.
 */
export const createAssetRoleBodySchema = z
  .object({
    /**
     * The primary key of `bms.asset_roles`, so it is validated here and never
     * again. `assetRoleCodeSchema` is the same bound the contracts package
     * states (`min(1).max(64)`), matching `code varchar(64)`.
     *
     * **ONE SPELLING CONVENTION, ENFORCED, because a vocabulary with two is a
     * vocabulary nobody can search.** Every one of `0051`'s 26 codes and
     * `0060`'s two is lower-case with hyphens — `incoming-supply`, `ht-panel`,
     * `secondary-clarifier`, `cooling-tower`. A code added at runtime must be
     * spelled the way a code added by a migration is, or `pump`, `Pump` and
     * `pump_2` end up naming the same shape three times and no picker groups
     * them. This bound is the smallest thing that prevents that.
     *
     * **Digits are allowed, but not as the first character.** `co2-scrubber` is
     * a plant shape and `2nd-stage` is a spelling accident. Underscores and
     * capitals are refused outright: `HT_Panel` would be perfectly valid to
     * `varchar(64)` and would also fall outside
     * `tests/f3.38-stock-catalog-vocabulary.test.ts`'s migration parser
     * (`/\('([a-z][a-z-]*)',\s*'/`), so the same mistake made in a migration
     * would go unseen there.
     *
     * **That parser rejects digits too, and this route admitting them is still
     * safe** — said here because the two rules disagree and the disagreement
     * should not look like an oversight. The parser reads MIGRATIONS, never
     * rows created through this route, so a runtime `co2-scrubber` is outside
     * its subject by construction. A digit-bearing code written into a future
     * migration would be skipped by the parser and break that file's exact
     * `.toBe(28)` loudly, which is the safe failure direction.
     */
    code: assetRoleCodeParamSchema.regex(
      /^[a-z][a-z0-9-]*$/,
      "an asset role code is lower-case letters, digits and hyphens, and starts with a letter — like `cooling-tower`",
    ),
    label: z.string().min(1).max(128),
    /**
     * Optional, and the database default of 100 stands when it is omitted.
     * `0051` bands its codes per train (Electrical 110-160, Water 210-250, STP
     * 310-360, ETP 410-440, HVAC 510-550) and `0060` appends 170 and 180. That
     * banding is a convention, not a constraint, so this is an ordinary
     * integer and not an enum of bands.
     */
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .strict();

/**
 * `code` is absent, `active` is present, and both are deliberate.
 *
 * **No `code`.** It is the primary key and the target of
 * `asset_group_members_role_fkey`, which carries no `ON DELETE` by design
 * (`0051` step 3). Renaming a code in place would either break that key or
 * silently re-point every membership that holds it.
 *
 * **`active`, because retirement is this `PATCH` and not a `DELETE`.** ADR 0051
 * decision 5 and `0051`'s own step 3 both say so: *"Retire a role with
 * `active = false`."* A code in use cannot be deleted, and a code not in use
 * still should not be, because a membership may hold it tomorrow.
 */
export const updateAssetRoleBodySchema = createAssetRoleBodySchema
  .omit({ code: true })
  .extend({ active: z.boolean() })
  .partial()
  .strict();

export type CreateAssetRoleBody = z.infer<typeof createAssetRoleBodySchema>;
export type UpdateAssetRoleBody = z.infer<typeof updateAssetRoleBodySchema>;
