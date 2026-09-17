import { useEffect } from "react";

import type { UserRole } from "@bms/shared";

import {
  canChooseAssetGroupDashboardScope,
  canChooseLocationDashboardScope,
  canCreateOrganizationWideDashboard,
} from "../../lib/admin-access";
import type {
  ChosenScopeValue,
  DashboardScopeValue,
  ScopeAssetGroupOption,
  ScopeAssetOption,
} from "../../lib/dashboard-scope";
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

/** The value union and the asset-group / asset option rows live in `lib/dashboard-scope.ts`
 * with the helpers that switch on them (`scopeAssetGroupOptions` builds the group rows from
 * `/auth/me`, so the lib must not import a component); re-exported here so no caller's import
 * line changes for the types alone. */
export type { DashboardScopeValue, ScopeAssetGroupOption, ScopeAssetOption } from "../../lib/dashboard-scope";

type DashboardScopeFieldsProps = {
  role: UserRole;
  value: DashboardScopeValue;
  /** Emits a CHOSEN kind only — the `asset` kind is prefilled, never chosen, so a caller whose
   * state is `ChosenScopeValue` (the create page, the duplicate dialog) passes its setter without
   * a cast, and the type says what the component can produce. */
  onChange: (value: ChosenScopeValue) => void;
  /** Populates the organization-wide branch's own select. Only read when
   * `canCreateOrganizationWideDashboard(role)` — the branch that reads it is
   * absent from the DOM otherwise. */
  organizations: readonly ScopeOrganizationOption[];
  /** Populates the location branch's select. The location the author picks is
   * what DECIDES `organizationId` for this dashboard (plan §7), so this list
   * is not filtered by an organization not chosen yet. */
  locations: readonly ScopeLocationOption[];
  /** Populates the asset-group branch's select. The caller decides the source —
   * `GET /admin/asset-groups` for a master-data role, `GET /auth/me`'s `scope.assetGroups` for
   * `asset_group_admin` (`useDashboardScopeOptions`, ADR 0047 Amendment 6 §Q1 point 2). Only
   * read when `canChooseAssetGroupDashboardScope(role)` — the branch is absent from the DOM
   * otherwise. */
  assetGroups: readonly ScopeAssetGroupOption[];
  /** Names the read-only `asset` line (ADR 0047 Amendment 6 §Q2); the id is the fallback when
   * the list has no match. REQUIRED, not optional — an optional prop at an adapter is invisible
   * to `tsc` and to fakes. A caller whose state type cannot hold the kind passes `[]`. */
  assets: readonly ScopeAssetOption[];
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
 * **Each chosen kind renders behind its own predicate** (ADR 0047 Amendment 6
 * §Q1 point 2), each mirroring one arm of `AccessControlService.canManageDashboard`:
 *
 * - `organization` for the roles `canCreateOrganizationWideDashboard` admits —
 *   `admin`, `organization_admin`.
 * - `location` for the roles `canChooseLocationDashboardScope` admits —
 *   `admin`, `organization_admin`, `location_admin`. An `asset_group_admin` is
 *   refused because the API's group arm refuses a location target for it
 *   (`target.kind !== "assetGroup"`), so the option would be a 403 behind an
 *   enabled Save.
 * - `assetGroup` for the roles `canChooseAssetGroupDashboardScope` admits —
 *   `admin`, `organization_admin` (Amendment 5, from `GET /admin/asset-groups`)
 *   and `asset_group_admin` (Amendment 6, from `/auth/me`'s `scope.assetGroups`
 *   via `scopeAssetGroupOptions` — the admin list stays refused for the role).
 *   A `location_admin` is refused on the mirror rule (`target.kind !==
 *   "location"`, pinned by `access-control.integration.spec.ts`).
 *
 * So an `asset_group_admin` sees exactly one radio, and the clamp below rewrites
 * a kind the role is not offered to its FIRST offered kind, unchosen — a location
 * where the role has one, else an asset group — never to a kind with no radio.
 *
 * **The `asset` kind is read-only** (Amendment 6 §Q2; ADR 0067's instantiator is
 * `assetId`'s only writer in this app): it renders no radio and no select — not
 * disabled ones, on the same forms-not-buttons rule — but one line naming the
 * asset from `assets`, falling back to the id. It is never clamped for any role;
 * the edit page's `scopePatch` omits both scope columns for it.
 */
export function DashboardScopeFields({
  role,
  value,
  onChange,
  organizations,
  locations,
  assetGroups,
  assets,
  error,
}: DashboardScopeFieldsProps) {
  const canOrgWide = canCreateOrganizationWideDashboard(role);
  const canLocation = canChooseLocationDashboardScope(role);
  const canGroup = canChooseAssetGroupDashboardScope(role);

  // Review finding (HIGH) — `duplicate-dashboard-dialog.tsx` and `dashboard-builder-edit-page.tsx`
  // both prefill from the source's own scope. For a role this component does not offer a kind
  // to, that can hand it a value it renders as NEITHER radio checked and no select — nothing in
  // the DOM shows the current scope — while the caller's own `scopeChosen` still comes back
  // true, leaving Save/Duplicate enabled for a submit the server refuses. Clamped here, once,
  // rather than in every caller that might prefill this value: `locationId` is left EMPTY rather
  // than guessed, so `scopeChosen` reads false and the button is correctly disabled until the
  // author actually picks a location. `F3.34` generalised it from "organization-wide for a role
  // `canOrgWide` refuses" to "any kind this role is not offered" (plan §4.5); `F3.63` made the
  // TARGET follow the role too — the first kind it is offered — because for `asset_group_admin`
  // an unchosen location is a kind with no radio and no select: a dead form (plan §4.4). The
  // `asset` kind is absent from the disjunction on purpose: no role is offered it, and it is
  // never clamped.
  useEffect(() => {
    const kindNotOffered =
      (!canOrgWide && value.kind === "organization") ||
      (!canLocation && value.kind === "location") ||
      (!canGroup && value.kind === "assetGroup");
    if (kindNotOffered) {
      onChange(
        canLocation
          ? { kind: "location", organizationId: value.organizationId, locationId: "" }
          : { kind: "assetGroup", organizationId: value.organizationId, assetGroupId: "" },
      );
    }
  }, [canOrgWide, canLocation, canGroup, value, onChange]);

  // After the hook, so the hook count is the same on every render.
  if (value.kind === "asset") {
    const asset = assets.find((item) => item.id === value.assetId);
    return (
      <fieldset className="space-y-2">
        <legend className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">Scope</legend>
        <p className="text-xs text-bms-muted">
          {`Scoped to asset ${asset?.name ?? value.assetId}. An asset-scoped dashboard keeps its scope; edit its widgets here.`}
        </p>
        {error ? <p className="text-[11px] text-red-700">{error}</p> : null}
      </fieldset>
    );
  }

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
        {canLocation ? (
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
        ) : null}
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

      {canLocation && value.kind === "location" ? (
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
