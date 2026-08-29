import { cleanup, render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { UserRole } from "@bms/shared";

import { DashboardScopeFields, type DashboardScopeValue } from "./dashboard-scope-fields";

/**
 * `F3.1d` Unit 7 — the org-wide / location scope choice (ADR 0038 decision 10,
 * plan §6.2, §9.4 owner ruling).
 *
 * Assertions live here; `dashboard-scope-fields.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR
 * 0042 decision 2).
 *
 * **The load-bearing assertion in this file.** For a `location_admin` or an
 * `asset_group_admin`, the organization-wide radio is absent from the DOM —
 * asserted with `queryBy…` returning `null`, never `toBeDisabled()`. A
 * `toBeDisabled` assertion would stay green under exactly the "buttons, not
 * forms" regression this row exists to prevent (plan §9): the option would
 * still be in the render tree, just greyed out, and a determined operator (or
 * a script) could still submit it.
 */

const ORGANIZATIONS = [{ id: "org-1", name: "Ion Exchange" }];
const LOCATIONS = [{ id: "loc-1", name: "Kolkata Works", organizationId: "org-1" }];

function locationValue(): DashboardScopeValue {
  return { kind: "location", organizationId: "", locationId: "" };
}

function renderFields(role: UserRole): void {
  render(
    <DashboardScopeFields
      role={role}
      value={locationValue()}
      onChange={() => {}}
      organizations={ORGANIZATIONS}
      locations={LOCATIONS}
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
 * Save/Duplicate enabled for a submit the server refuses. The existing `renderFields` helper
 * above always passes `{kind: "location"}`, which is why it could not see this: this case feeds
 * the mismatched `{kind: "organization"}` value directly.
 */
export function forALocationAdminAnOrganizationWideValueClampsToLocation(): void {
  const onChange = vi.fn();
  render(
    <DashboardScopeFields
      role="location_admin"
      value={{ kind: "organization", organizationId: "org-1" }}
      onChange={onChange}
      organizations={ORGANIZATIONS}
      locations={LOCATIONS}
    />,
  );

  expect(
    onChange,
    "a role that cannot author organization-wide must have its value clamped back to " +
      "an (unchosen) location, not left as an organization-wide value nothing in the DOM shows",
  ).toHaveBeenCalledWith({ kind: "location", organizationId: "org-1", locationId: "" });
  expect(screen.queryByRole("radio", { name: "Organization-wide" })).not.toBeInTheDocument();
}

/** No asset-group radio anywhere, for any role — the owner ruling plan §6 records (backlog `F3.34`). */
export function noRoleIsOfferedAnAssetGroupOption(): void {
  for (const role of ["admin", "organization_admin", "location_admin", "asset_group_admin"] as const) {
    renderFields(role);
    expect(screen.queryByText(/asset group/i)).not.toBeInTheDocument();
    cleanup();
  }
}
