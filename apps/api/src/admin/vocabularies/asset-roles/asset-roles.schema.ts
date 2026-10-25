import { z } from "zod";

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
 * `@bms/shared` since `F3.87` PR 1 (ADR 0101 decision 17), and the derived patch body
 * (`updateAssetRoleBodySchema`) since `F4.282` (ADR 0099 Amendment 8); only the param stays here. The RESPONSE type is `assetRoleDtoSchema` in `@bms/shared` (ADR 0030).
 *
 * The bound is `min(1).max(64)`, the same as `assetRoleCodeSchema` and the same
 * as `code varchar(64)`. `contracts/point-key-writes.ts` declares its own bound locally
 * for the same reason, so this is the house pattern and not a new one.
 * `tests/f3.40-asset-role-write-path.test.ts` holds the two together.
 */
export const assetRoleCodeParamSchema = z.string().min(1).max(64);
