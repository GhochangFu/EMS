import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { UserRole } from "@bms/shared";

import { DashboardScopeFields, type DashboardScopeValue } from "./dashboard-scope-fields";

/**
 * `F3.1d` Unit 7 — the org-wide / location scope choice (ADR 0038 decision 10,
 * plan §6.2, §9.4 owner ruling); `F3.34` Unit 4 — the asset-group choice (ADR
 * 0047 Amendment 5).
 *
 * Assertions live here; `dashboard-scope-fields.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR
 * 0042 decision 2).
 *
 * **The load-bearing assertions in this file.** For a `location_admin` or an
 * `asset_group_admin`, the organization-wide radio AND the asset-group radio
 * are absent from the DOM — asserted with `queryBy…` returning `null`, never
 * `toBeDisabled()`, each beside a positive control that the `Location` radio
 * rendered. A `toBeDisabled` assertion would stay green under exactly the
 * "buttons, not forms" regression this row exists to prevent (plan §9): the
 * option would still be in the render tree, just greyed out, and a determined
 * operator (or a script) could still submit it.
 *
 * The asset-group radio and its select are queried by role — `getByRole("radio",
 * { name: "Asset group" })` and `getByRole("combobox", { name: "Asset group" })`
 * — because `getByLabelText("Asset group")` matches both the radio's label and
 * the `Field` label and throws.
 */

const ORGANIZATIONS = [{ id: "org-1", name: "Ion Exchange" }];
const LOCATIONS = [{ id: "loc-1", name: "Kolkata Works", organizationId: "org-1" }];
const ASSET_GROUPS = [{ id: "grp-1", name: "Hvac", organizationId: "org-1", locationName: "Kolkata Works" }];

function locationValue(): DashboardScopeValue {
  return { kind: "location", organizationId: "", locationId: "" };
}

function renderFields(
  role: UserRole,
  value: DashboardScopeValue = locationValue(),
  onChange: (value: DashboardScopeValue) => void = () => {},
): void {
  render(
    <DashboardScopeFields
      role={role}
      value={value}
      onChange={onChange}
      organizations={ORGANIZATIONS}
      locations={LOCATIONS}
      assetGroups={ASSET_GROUPS}
    />,
  );
}

export function locationAdminNeverSeesTheOrganizationWideOption(): void {
  renderFields("location_admin");

  expect(screen.queryByRole("radio", { name: "Organization-wide" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
  // The location branch is still there — this role authors freely inside its
  // own scope (`canAuthorDashboards` already admits it).
  expect(screen.getByRole("radio", { name: "Location" })).toBeInTheDocument();
}

export function assetGroupAdminNeverSeesTheOrganizationWideOptionEither(): void {
  renderFields("asset_group_admin");

  expect(screen.queryByRole("radio", { name: "Organization-wide" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
}

export function organizationAdminSeesTheOrganizationWideOption(): void {
  renderFields("organization_admin");

  expect(screen.getByRole("radio", { name: "Organization-wide" })).toBeInTheDocument();
}

export function adminSeesTheOrganizationWideOption(): void {
  renderFields("admin");

  expect(screen.getByRole("radio", { name: "Organization-wide" })).toBeInTheDocument();
}

/**
 * Review finding (HIGH) — `duplicate-dashboard-dialog.tsx` and
 * `dashboard-builder-edit-page.tsx` both prefill two-way from the source's own scope
 * (`source.locationId ? location : organization`). For a `location_admin` fed an
 * organization-wide source that way, this component previously rendered neither the
 * organization-wide radio nor its select — nothing indicated the current scope — while
 * `value.kind === "organization"` still made the caller's own `scopeChosen` read true, leaving
 * Save/Duplicate enabled for a submit the server refuses. The role cases above render the
 * default `{kind: "location"}` value, which is why they could not see this: this case feeds
 * the mismatched `{kind: "organization"}` value through `renderFields`' `value` parameter.
 */
export function forALocationAdminAnOrganizationWideValueClampsToLocation(): void {
  const onChange = vi.fn();
  renderFields("location_admin", { kind: "organization", organizationId: "org-1" }, onChange);

  expect(
    onChange,
    "a role that cannot author organization-wide must have its value clamped back to " +
      "an (unchosen) location, not left as an organization-wide value nothing in the DOM shows",
  ).toHaveBeenCalledWith({ kind: "location", organizationId: "org-1", locationId: "" });
  expect(screen.queryByRole("radio", { name: "Organization-wide" })).not.toBeInTheDocument();
}

// ---------------------------------------------------------------------------
// `F3.34` — the asset-group scope kind (ADR 0047 Amendment 5).
// ---------------------------------------------------------------------------

/** Mutation: render the radio behind `canOrgWide && false` ⇒ red. */
export function adminSeesTheAssetGroupOption(): void {
  renderFields("admin");

  expect(screen.getByRole("radio", { name: "Asset group" })).toBeInTheDocument();
}

/** Mutation: gate the radio on `role === "admin"` alone ⇒ red. */
export function organizationAdminSeesTheAssetGroupOption(): void {
  renderFields("organization_admin");

  expect(screen.getByRole("radio", { name: "Asset group" })).toBeInTheDocument();
}

/**
 * The API's group arm refuses `location_admin` (`canManageDashboard`: `target.kind !==
 * "location"`, pinned by `access-control.integration.spec.ts`), so the option is not in the
 * DOM. Mutation: render it `disabled` instead of omitting ⇒ red (the forms-not-buttons carrier).
 * The second `expect` is the adjacent positive control — the component rendered at all.
 */
export function locationAdminNeverSeesTheAssetGroupOption(): void {
  renderFields("location_admin");

  expect(screen.queryByRole("radio", { name: "Asset group" })).toBeNull();
  expect(screen.getByRole("radio", { name: "Location" })).toBeInTheDocument();
}

/** Widening the option to this role is `F3.63`'s, with its own gate. Same shape as above. */
export function assetGroupAdminNeverSeesTheAssetGroupOption(): void {
  renderFields("asset_group_admin");

  expect(screen.queryByRole("radio", { name: "Asset group" })).toBeNull();
  expect(screen.getByRole("radio", { name: "Location" })).toBeInTheDocument();
}

/**
 * Choosing a group DECIDES the dashboard's organization (plan §3 0.2) — the group DTO carries
 * `organizationId`, exactly as a `ScopeLocationOption` does. Mutation: derive `organizationId`
 * from `value.organizationId` instead of the chosen group ⇒ red.
 */
export async function choosingAGroupDecidesTheOrganization(): Promise<void> {
  const onChange = vi.fn();
  renderFields("admin", { kind: "assetGroup", organizationId: "", assetGroupId: "" }, onChange);

  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset group" }), "grp-1");

  expect(onChange).toHaveBeenCalledWith({ kind: "assetGroup", organizationId: "org-1", assetGroupId: "grp-1" });
}

/**
 * The seed names every location's groups identically (`Electrical`, `Hvac`, … at each
 * location — plan §3 0.3), so the option text carries the location. Mutation: render `name`
 * alone ⇒ red.
 */
export function theOptionTextNamesTheLocation(): void {
  renderFields("admin", { kind: "assetGroup", organizationId: "", assetGroupId: "" });

  expect(screen.getByRole("option", { name: "Hvac — Kolkata Works" })).toBeInTheDocument();
}

/**
 * The clamp generalises (plan §4.5): a value whose kind this role is NOT offered is clamped to
 * an unchosen location, exactly as an organization-wide value is. Mutation: narrow the clamp
 * back to `kind === "organization"` only ⇒ red.
 */
export function forALocationAdminAnAssetGroupValueClampsToLocation(): void {
  const onChange = vi.fn();
  renderFields("location_admin", { kind: "assetGroup", organizationId: "org-1", assetGroupId: "grp-1" }, onChange);

  expect(onChange).toHaveBeenCalledWith({ kind: "location", organizationId: "org-1", locationId: "" });
}

/** Positive control for the clamp: a role that IS offered the kind keeps its value. Mutation:
 * clamp on `kind === "assetGroup"` unconditionally ⇒ red. */
export function forAdminAnAssetGroupValueIsNotClamped(): void {
  const onChange = vi.fn();
  renderFields("admin", { kind: "assetGroup", organizationId: "org-1", assetGroupId: "grp-1" }, onChange);

  expect(onChange).not.toHaveBeenCalled();
}
