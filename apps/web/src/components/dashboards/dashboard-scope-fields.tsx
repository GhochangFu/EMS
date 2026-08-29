import type { UserRole } from "@bms/shared";

import { canCreateOrganizationWideDashboard } from "../../lib/admin-access";
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

export type DashboardScopeValue =
  | { kind: "organization"; organizationId: string }
  | { kind: "location"; organizationId: string; locationId: string };

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
  error?: string;
};

/**
 * The org-wide / location choice (ADR 0038 decision 10, plan §6.2).
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
 * **No asset-group option, for any role** (plan §6.2, an owner ruling that
 * overrides a reading of the schema). `bms.dashboards.asset_group_id` stays a
 * real column this UI never sets: `isMasterDataRole` excludes
 * `asset_group_admin` from every admin screen, and no asset-groups list
 * endpoint exists anywhere in `apps/api` to populate a picker with —
 * `docs/BACKLOG.md` row `F3.34` owns that gap.
 */
export function DashboardScopeFields({
  role,
  value,
  onChange,
  organizations,
  locations,
  error,
}: DashboardScopeFieldsProps) {
  const canOrgWide = canCreateOrganizationWideDashboard(role);

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

      {error ? <p className="text-[11px] text-red-700">{error}</p> : null}
    </fieldset>
  );
}
