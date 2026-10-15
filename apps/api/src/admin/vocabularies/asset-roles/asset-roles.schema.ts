import { z } from "zod";

import { createAssetRoleBodySchema } from "@bms/shared";

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
 * as `code varchar(64)`. `contracts/point-key-writes.ts` declares its own bound locally
 * for the same reason, so this is the house pattern and not a new one.
 * `tests/f3.40-asset-role-write-path.test.ts` holds the two together.
 */
export const assetRoleCodeParamSchema = z.string().min(1).max(64);

/**
 * `F3.40` / ADR 0051 decision 5 - the create body (`createAssetRoleBodySchema`) lives in
 * `@bms/shared` since `F3.87` PR 1 (ADR 0101 decision 17); only the derived patch body stays here.
 * The RESPONSE type is `assetRoleDtoSchema` in `@bms/shared` (ADR 0030).
 */

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

export type UpdateAssetRoleBody = z.infer<typeof updateAssetRoleBodySchema>;
