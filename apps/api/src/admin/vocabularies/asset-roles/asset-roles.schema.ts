import { z } from "zod";

import { createAssetRoleBodySchema } from "@bms/shared";

/**
 * The `:code` path parameter, and the bound every request body's `code` reuses.
 *
 * **DECLARED HERE WITH THIS PACKAGE'S OWN `z`, NOT IMPORTED FROM `@bms/shared`.**
 * History: at `F3.40` the param parsed with `assetRoleCodeSchema` from the contracts
 * package, and under Vitest the `ZodError` it threw failed `err instanceof ZodError`
 * in `asset-roles.controller.ts` (`apps/api` loaded zod as ESM, `@bms/shared` came from
 * its CJS `dist`), so `controller.update("", ...)` escaped as a raw `ZodError`. Since
 * `F3.85`/`F3.86` the workspace resolves one `zod`, and the controller parses the shared
 * `createAssetRoleBodySchema` bare and maps its `ZodError` to 400;
 * `asset-roles.controller.spec.ts` pins that. The param stays local for the recorded
 * reason and because `contracts/point-key-writes.ts` does the same.
 *
 * `F3.40` / ADR 0051 decision 5 - the create body (`createAssetRoleBodySchema`) lives in
 * `@bms/shared` since `F3.87` PR 1 (ADR 0101 decision 17); only the derived patch body
 * stays here. The RESPONSE type is `assetRoleDtoSchema` in `@bms/shared` (ADR 0030).
 *
 * The bound is `min(1).max(64)`, the same as `assetRoleCodeSchema` and the same
 * as `code varchar(64)`. `contracts/point-key-writes.ts` declares its own bound locally
 * for the same reason, so this is the house pattern and not a new one.
 * `tests/f3.40-asset-role-write-path.test.ts` holds the two together.
 */
export const assetRoleCodeParamSchema = z.string().min(1).max(64);

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
