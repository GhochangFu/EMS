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
 * `organization_admin` manages. That case falls through to the API's 403.
 *
 * **Which 403 depends on what was attempted, and this line used to name only
 * one of them.** Reading a template outside your scope is *"Template is
 * outside your access scope"* (`getById`); writing anything outside it is
 * *"Organization is outside your access scope"* (`assertCanAuthor`), which is
 * the sentence ADR 0038 decision 10 quotes and is correct for a write. See
 * `asset-template-detail-page.tsx`'s docblock for all three.
 *
 * **The detail page renders them since `F4.52`.** Until then
 * `clearSessionOnAuthFailure` treated 403 like 401 and cleared the session, so
 * the user was returned to the login screen before any message could show —
 * confirmed on the running stack from both roles on 2026-08-21. It now clears
 * on 401 only, which is what makes D10's fall-through reachable rather than
 * merely intended.
 *
 * This is a deliberate gap, not an oversight, and
 * `template-authoring-access.spec.ts` asserts both halves of it: that the scope
 * contract still has no organization list, and that this module exports no
 * helper claiming to answer the question.
 *
 * ## Why there is no `canViewTemplates` either
 *
 * Unit 6 exported one. Unit 7 deleted it as dead on arrival: reaching the page
 * at all is already gated twice — `AdminRoute` on `isMasterDataAdmin`, and
 * `visibleMasterDataTabs`, which returns a non-`catalogOnly` tab to every role
 * that reaches `MasterDataLayout`. `canAuthorTemplates(role) ||
 * canInstantiateTemplates(role)` is `isMasterDataAdmin(role)` exactly, so the
 * helper restated an existing gate with no caller — and the export-count
 * assertion below would have kept it looking used.
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
 * Whether the authoring **forms** render editable.
 *
 * Two independent questions, and shipping only one of them was a real defect
 * found in the browser as `wc-admin@bms.local` (`location_admin`):
 *
 * - **Is this version frozen?** `capabilities(status).editable` — false for
 *   published and archived (ADR 0015).
 * - **May this role author at all?** `canAuthorTemplates(role)` — false for
 *   every role below master-data admin.
 *
 * The detail page asked only the first. The lifecycle buttons were correctly
 * role-hidden, so the page *looked* right, while every field in all five tabs
 * stayed editable on a draft. A location admin could author a complete alarm
 * set, press Save, and receive a 403 — which `clearSessionOnAuthFailure` then
 * treated as an authentication failure, clearing the session. The work was
 * lost and the user was returned to the login screen. `F4.52` fixed that
 * second half; this module is still what stops the first.
 *
 * ADR 0038 decision 10 says authoring is **role-hidden** and scope-refused.
 * Hiding the buttons is half of it; a form that cannot be saved must not
 * invite typing either.
 *
 * **This is not the authorization boundary.** The server enforces it at nine
 * call sites through `assertCanAuthor`, and it must keep doing so — this is
 * the UI declining to offer work it knows will be refused.
 */
export function templateFormsAreEditable(role: UserRole, versionIsEditable: boolean): boolean {
  return versionIsEditable && canAuthorTemplates(role);
}
