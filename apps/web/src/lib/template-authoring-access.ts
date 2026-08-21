/**
 * Who may author a template, and who may only deploy one (`F2.5`, ADR 0038
 * decision 10 — Unit 6).
 *
 * ADR 0015 §7 splits the two, and the split is the whole reason this module
 * exists rather than another `isMasterDataAdmin` call: **a `location_admin`
 * cannot author a template but can instantiate one.** That role commissions
 * plant. Hiding the page from it would hide the only route to Instantiate;
 * showing it Edit and Publish would offer two buttons the API answers with 403.
 *
 * Mirrors the server exactly:
 * - `asset-templates.service.ts:459` — `assertCanAuthor` rejects
 *   `location_admin` by name before any scope check.
 * - `asset-templates-instantiate.service.ts:115` — instantiate calls
 *   `requireMasterDataUser` and deliberately does **not** call
 *   `canManageTemplate`, because that helper means "may author".
 *
 * ## Why there is no organization-scope helper here
 *
 * D10's residual case — right role, wrong organization — is **not derivable in
 * the browser**. `accessibleScopeSchema` (`packages/shared/src/contracts/auth.ts`)
 * carries `kind`, `locations`, `assetGroups` and `assetIds`, and no
 * organization list, so the client cannot know which organizations a
 * `organization_admin` manages. That case falls through to the API's 403, whose
 * body ("Organization is outside your access scope") the detail page renders.
 *
 * This is a deliberate gap, not an oversight, and
 * `template-authoring-access.spec.ts` asserts both halves of it: that the scope
 * contract still has no organization list, and that this module exports no
 * helper claiming to answer the question.
 */
import type { UserRole } from "@bms/shared";

import { isMasterDataAdmin } from "./admin-access";

/**
 * Whether the role may create, edit, publish, archive or delete a template.
 *
 * Built on `isMasterDataAdmin` minus `location_admin` rather than listing two
 * roles, so a role added to the master-data set is denied authoring by default.
 * The safe direction: a new role that should author is a visible gap, while a
 * new role that silently gained Publish is not.
 */
export function canAuthorTemplates(role: UserRole): boolean {
  return isMasterDataAdmin(role) && role !== "location_admin";
}

/**
 * Whether the role may build assets from a published template.
 *
 * The whole master-data set, `location_admin` included — that inclusion is
 * ADR 0015 §7's point.
 */
export function canInstantiateTemplates(role: UserRole): boolean {
  return isMasterDataAdmin(role);
}

/**
 * Whether the role may open the templates page at all.
 *
 * Either capability is enough. A `location_admin` reaches the list to find
 * something to instantiate, and sees no authoring control once there.
 */
export function canViewTemplates(role: UserRole): boolean {
  return canAuthorTemplates(role) || canInstantiateTemplates(role);
}
