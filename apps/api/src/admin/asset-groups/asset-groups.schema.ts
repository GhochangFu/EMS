import { setAssetGroupMemberRoleBodySchema } from "@bms/shared";
import type { SetAssetGroupMemberRoleBody } from "@bms/shared";

/**
 * `F3.37` (ADR 0049 decision 5) — the write side of the asset role vocabulary.
 *
 * **Re-exported from `@bms/shared`, not restated here.** §4.8: a copied
 * vocabulary is a copy that drifts. `assetRoleCodeSchema` is a
 * `z.string().min(1).max(64)` and never a `z.enum`, so this schema checks
 * *shape* only — the set is closed by `bms.asset_roles` and
 * `asset_group_members_role_fkey`, and `VocabulariesService.assertAssetRole`
 * is the boundary that turns an unknown code into a 400 rather than a 500.
 *
 * No `.refine` here, deliberately: there is nothing to refine that the
 * vocabulary check does not already own, and
 * `tests/adr-0029-openapi-contract.test.ts` requires every refinement in a
 * `*.schema.ts` to explain itself in source.
 */
export { setAssetGroupMemberRoleBodySchema };
export type { SetAssetGroupMemberRoleBody };
