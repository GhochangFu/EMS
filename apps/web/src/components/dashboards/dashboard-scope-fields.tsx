import { useEffect } from "react";

import type { UserRole } from "@bms/shared";

import { canChooseAssetGroupDashboardScope, canCreateOrganizationWideDashboard } from "../../lib/admin-access";
import type { DashboardScopeValue } from "../../lib/dashboard-scope";
import { Field } from "../asset-templates/field";

/** A pared-down organization row — just enough to label the org-wide select
 * and carry its id, so both the create page (a real `fetchAdminOrganizations`
 * list) and the edit page (the dashboard's own, already-fixed organization,
 * synthesized as a one-item list) can supply it without either depending on
 * the full `AdminOrganizationDto` shape. */
export type ScopeOrganizationOption = { readonly id: string; readonly name: string };

/** A pared-down location row for the same reason — `organizationId` is what
 * lets choosing a location DECIDE this dashboard's organization, per plan §7. */
export type ScopeLocationOption = { readonly id: string; readonly name: string; readonly organizationId: string };

/** A pared-down asset-group row (`F3.34`). `organizationId` decides the
 * dashboard's organization exactly as a location's does; `locationName` is in
 * the option text because the seed names every location's groups identically
 * (`Electrical`, `Hvac`, … at each location — plan §3 0.3). */
export type ScopeAssetGroupOption = {
  readonly id: string;
  readonly name: string;
  readonly organizationId: string;
  readonly locationName: string | null;
};

/** The value union lives in `lib/dashboard-scope.ts` with the three helpers that
 * switch on it; re-exported here so no caller's import line changes for the type alone. */
export type { DashboardScopeValue } from "../../lib/dashboard-scope";

type DashboardScopeFieldsProps = {
  role: UserRole;
  value: DashboardScopeValue;
  onChange: (value: DashboardScopeValue) => void;
  /** Populates the organization-wide branch's own select. Only read when
   * `canCreateOrganizationWideDashboard(role)` — the branch that reads it is
   * absent from the DOM otherwise. */
  organizations: readonly ScopeOrganizationOption[];
  /** Populates the location branch's select. The location the author picks is
   * what DECIDES `organizationId` for this dashboard (plan §7), so this list
   * is not filtered by an organization not chosen yet. */
  locations: readonly ScopeLocationOption[];
  /** Populates the asset-group branch's select (`GET /admin/asset-groups`).
   * Only read when `canChooseAssetGroupDashboardScope(role)` — the branch is
   * absent from the DOM otherwise. */
  assetGroups: readonly ScopeAssetGroupOption[];
  error?: string;
};

function assetGroupLabel(group: ScopeAssetGroupOption): string {
  return group.locationName ? `${group.name} — ${group.locationName}` : group.name;
}

/**
 * The org-wide / location / asset-group choice (ADR 0038 decision 10, plan §6.2;
 * ADR 0047 Amendment 5 for the third kind).
 *
 * **Forms, not buttons.** For a role `canCreateOrganizationWideDashboard`
 * refuses — `location_admin`, `asset_group_admin` — the organization-wide
 * radio, and the organization select inside its branch, are not in this
 * component's rendered tree at all. Not `disabled`, not hidden by CSS:
 * `dashboard-scope-fields.spec.tsx` asserts the absence with `queryBy…`
 * returning `null`, because a `toBeDisabled` assertion here would stay green
 * under exactly the "buttons, not forms" regression this file exists to
 * prevent — the option would still be reachable in the DOM.
 *
 * **The `assetGroup` kind renders for the two roles
 * `canChooseAssetGroupDashboardScope` admits** — `admin` and
 * `organization_admin` (ADR 0047 Amendment 5) — populated from
 * `GET /admin/asset-groups`, and is absent for every other role on the same
 * forms-not-buttons rule. A `location_admin` is refused because the API's own
 * group arm refuses it (`AccessControlService.canManageDashboard`:
 * `target.kind !== "location"`, pinned by `access-control.integration.spec.ts`),
 * so an option shown to it would be a 403 behind an enabled Save. An
 * `asset_group_admin` is admitted by the API by group membership, but no admin
 * screen routes it here; widening the option to that role is `F3.63`'s, with
 * its own gate. `assetId` (ADR 0067) has no control on this form at all.
 */
export function DashboardScopeFields({
  role,
  value,
  onChange,
  organizations,
  locations,
  assetGroups,
  error,
}: DashboardScopeFieldsProps) {
  const canOrgWide = canCreateOrganizationWideDashboard(role);
  const canGroup = canChooseAssetGroupDashboardScope(role);

  // Review finding (HIGH) — `duplicate-dashboard-dialog.tsx` and `dashboard-builder-edit-page.tsx`
  // both prefill from the source's own scope. For a role this component does not offer a kind
  // to, that can hand it a value it renders as NEITHER radio checked and no select — nothing in
  // the DOM shows the current scope — while the caller's own `scopeChosen` still comes back
  // true, leaving Save/Duplicate enabled for a submit the server refuses. Clamped here, once,
  // rather than in every caller that might prefill this value: `locationId` is left EMPTY rather
  // than guessed, so `scopeChosen` reads false and the button is correctly disabled until the
  // author actually picks a location. `F3.34` generalised it from "organization-wide for a role
  // `canOrgWide` refuses" to "any kind this role is not offered" (plan §4.5).
  useEffect(() => {
    const kindNotOffered =
      (!canOrgWide && value.kind === "organization") || (!canGroup && value.kind === "assetGroup");
    if (kindNotOffered) {
      onChange({ kind: "location", organizationId: value.organizationId, locationId: "" });
    }
  }, [canOrgWide, canGroup, value, onChange]);

  return (
    <fieldset className="space-y-2">
      <legend className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">Scope</legend>
      <div className="flex flex-wrap gap-4 text-xs">
        {canOrgWide ? (
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="dashboard-scope-kind"
              checked={value.kind === "organization"}
              onChange={() =>
                onChange({
                  kind: "organization",
                  organizationId: value.organizationId || (organizations[0]?.id ?? ""),
                })
              }
            />
            Organization-wide
          </label>
        ) : null}
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="dashboard-scope-kind"
            checked={value.kind === "location"}
            onChange={() =>
              onChange({
                kind: "location",
                organizationId: locations[0]?.organizationId ?? "",
                locationId: locations[0]?.id ?? "",
              })
            }
          />
          Location
        </label>
        {canGroup ? (
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="dashboard-scope-kind"
              checked={value.kind === "assetGroup"}
              onChange={() =>
                onChange({
                  kind: "assetGroup",
                  organizationId: assetGroups[0]?.organizationId ?? "",
                  assetGroupId: assetGroups[0]?.id ?? "",
                })
              }
            />
            Asset group
          </label>
        ) : null}
      </div>

      {canOrgWide && value.kind === "organization" ? (
        <Field label="Organization">
          <select
            value={value.organizationId}
            onChange={(event) => onChange({ kind: "organization", organizationId: event.target.value })}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          >
            <option value="" disabled>
              Choose an organization
            </option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {value.kind === "location" ? (
        <Field label="Location">
          <select
            value={value.locationId}
            onChange={(event) => {
              const location = locations.find((item) => item.id === event.target.value);
              onChange({
                kind: "location",
                organizationId: location?.organizationId ?? "",
                locationId: event.target.value,
              });
            }}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          >
            <option value="" disabled>
              Choose a location
            </option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {canGroup && value.kind === "assetGroup" ? (
        <Field label="Asset group">
          <select
            value={value.assetGroupId}
            onChange={(event) => {
              const group = assetGroups.find((item) => item.id === event.target.value);
              onChange({
                kind: "assetGroup",
                organizationId: group?.organizationId ?? "",
                assetGroupId: event.target.value,
              });
            }}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
          >
            <option value="" disabled>
              Choose an asset group
            </option>
            {assetGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {assetGroupLabel(group)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {error ? <p className="text-[11px] text-red-700">{error}</p> : null}
    </fieldset>
  );
}
