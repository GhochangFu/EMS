import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { UserRole } from "@bms/shared";

import { DashboardScopeFields, type DashboardScopeValue, type ScopeAssetOption } from "./dashboard-scope-fields";

/**
 * `F3.1d` Unit 7 — the org-wide / location scope choice (ADR 0038 decision 10,
 * plan §6.2, §9.4 owner ruling); `F3.34` Unit 4 — the asset-group choice (ADR
 * 0047 Amendment 5); `F3.63` Unit 5 — the group kind for `asset_group_admin`,
 * the location kind behind its own predicate, and the read-only `asset` line
 * (ADR 0047 Amendment 6 §Q1 point 2, §Q2).
 *
 * Assertions live here; `dashboard-scope-fields.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR
 * 0042 decision 2).
 *
 * **The load-bearing assertions in this file.** Each role sees exactly the
 * kinds its predicate admits, and the others are absent from the DOM —
 * asserted with `queryBy…` returning `null`, never `toBeDisabled()`, each
 * beside a positive control that the role's own radio rendered: the `Location`
 * radio for a `location_admin` (no organization-wide, no asset-group radio),
 * the `Asset group` radio for an `asset_group_admin` (no organization-wide, no
 * location radio). A `toBeDisabled` assertion would stay green under exactly
 * the "buttons, not forms" regression this row exists to prevent (plan §9): the
 * option would still be in the render tree, just greyed out, and a determined
 * operator (or a script) could still submit it. An `asset` value renders no
 * radio at all — the positive control there is the read-only line itself.
 *
 * The radios and their selects are queried by role — `getByRole("radio",
 * { name: "Asset group" })` and `getByRole("combobox", { name: "Asset group" })`
 * — because `getByLabelText("Asset group")` (or `"Location"`) matches both the
 * radio's label and the `Field` label and throws.
 */

const ORGANIZATIONS = [{ id: "org-1", name: "Ion Exchange" }];
const LOCATIONS = [{ id: "loc-1", name: "Kolkata Works", organizationId: "org-1" }];
const ASSET_GROUPS = [{ id: "grp-1", name: "Hvac", organizationId: "org-1", locationName: "Kolkata Works" }];

function locationValue(): DashboardScopeValue {
  return { kind: "location", organizationId: "", locationId: "" };
}

/** `assets` is REQUIRED on the component (an optional prop at an adapter is invisible to `tsc`
 * and to fakes — plan §4.4); it is defaulted here, in the helper only, because every case but
 * the `asset`-kind ones renders a value that never reads it. */
function renderFields(
  role: UserRole,
  value: DashboardScopeValue = locationValue(),
  onChange: (value: DashboardScopeValue) => void = () => {},
  assets: readonly ScopeAssetOption[] = [],
): void {
  render(
    <DashboardScopeFields
      role={role}
      value={value}
      onChange={onChange}
      organizations={ORGANIZATIONS}
      locations={LOCATIONS}
      assetGroups={ASSET_GROUPS}
      assets={assets}
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
  // The positive control moved with `F3.63`: this role's own radio is now `Asset group`, the
  // `Location` radio it used to be checked against is gone for it (Amendment 6 §Q1 point 2).
  expect(screen.getByRole("radio", { name: "Asset group" })).toBeInTheDocument();
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
 * Clicking the `Asset group` RADIO alone — no select afterwards — pre-selects the first group
 * and takes the organization from it (post-merge sweep, Low). Every other case that clicks the
 * radio then calls `selectOptions`, which overwrites the radio's value, so the radio's own
 * derivation was unpinned: with it broken, an author who accepts the pre-selected group sends
 * `organizationId: ""` and gets a 400 behind an enabled Create. Mutation: derive `""` ⇒ red.
 */
export async function clickingTheAssetGroupRadioAloneDecidesTheOrganization(): Promise<void> {
  const onChange = vi.fn();
  renderFields("admin", locationValue(), onChange);

  await userEvent.click(screen.getByRole("radio", { name: "Asset group" }));

  expect(onChange).toHaveBeenCalledWith({ kind: "assetGroup", organizationId: "org-1", assetGroupId: "grp-1" });
}

/**
 * The seed creates a group per asset domain at every location that holds assets, so a name
 * such as `Hvac` repeats across sites (plan §3 0.3); the option text carries the location.
 * Mutation: render `name` alone ⇒ red.
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

// ---------------------------------------------------------------------------
// `F3.63` — the group kind for `asset_group_admin`, the location kind behind its own
// predicate, the read-only `asset` line (ADR 0047 Amendment 6 §Q1 point 2, §Q2).
// ---------------------------------------------------------------------------

const ASSETS: readonly ScopeAssetOption[] = [{ id: "a1", name: "Chiller 1" }];

function assetValue(): DashboardScopeValue {
  return { kind: "asset", organizationId: "org-1", assetId: "a1" };
}

/**
 * Replaces the `F3.34` negative `assetGroupAdminNeverSeesTheAssetGroupOption`, whose claim
 * Amendment 6 §Q1 point 2 rules false: the API's group arm admits the role by membership, and
 * the option now follows. Mutation: keep the `F3.34` membership of
 * `canChooseAssetGroupDashboardScope` (`admin` and `organization_admin` only) ⇒ red.
 */
export function assetGroupAdminSeesTheAssetGroupOption(): void {
  renderFields("asset_group_admin", { kind: "assetGroup", organizationId: "org-1", assetGroupId: "" });

  expect(screen.getByRole("radio", { name: "Asset group" })).toBeInTheDocument();
}

/**
 * The mirror image of `locationAdminNeverSeesTheAssetGroupOption`: the API's group arm refuses a
 * location target for this role (`target.kind !== "assetGroup"`), so the location radio is not
 * in the DOM. Mutation: keep the Location radio unconditional ⇒ red. The last `expect` is the
 * adjacent positive control — the role's own radio rendered.
 */
export function assetGroupAdminNeverSeesTheLocationOption(): void {
  renderFields("asset_group_admin", { kind: "assetGroup", organizationId: "org-1", assetGroupId: "" });

  expect(screen.queryByRole("radio", { name: "Location" })).toBeNull();
  expect(screen.getByRole("radio", { name: "Asset group" })).toBeInTheDocument();
}

/**
 * The location SELECT is gated on the same predicate as its radio — before `F3.63` it rendered
 * on `value.kind === "location"` alone, which for this role fed the create page's default
 * `{kind: "location"}` state would leave a reachable `Location` combobox behind a missing radio
 * (the forms-not-buttons regression, one level down). `onChange` is a no-op here so the clamp
 * cannot rewrite the value away first. Mutation: gate the select on `value.kind` alone ⇒ red.
 */
export function assetGroupAdminNeverSeesTheLocationSelectEither(): void {
  renderFields("asset_group_admin", locationValue());

  expect(screen.queryByRole("combobox", { name: "Location" })).toBeNull();
  expect(screen.getByRole("radio", { name: "Asset group" })).toBeInTheDocument();
}

/** The positive control for the new predicate on the location radio. Mutation:
 * `canChooseLocationDashboardScope` as `role === "location_admin"` alone ⇒ red. */
export function adminStillSeesTheLocationOption(): void {
  renderFields("admin");

  expect(screen.getByRole("radio", { name: "Location" })).toBeInTheDocument();
}

/**
 * The clamp target follows the role (plan §4.4): a kind this role is not offered is rewritten to
 * its FIRST offered kind, unchosen — for `asset_group_admin` that is an unchosen asset group, not
 * an unchosen location (which would render a dead form: no radio, no select, Save disabled
 * forever). Mutation: clamp to `{kind: "location"}` for every role ⇒ red.
 */
export function forAnAssetGroupAdminALocationValueClampsToAssetGroup(): void {
  const onChange = vi.fn();
  renderFields("asset_group_admin", { kind: "location", organizationId: "org-1", locationId: "" }, onChange);

  expect(onChange).toHaveBeenCalledWith({ kind: "assetGroup", organizationId: "org-1", assetGroupId: "" });
}

/**
 * Amendment 6 §Q2: an asset-scoped row renders NO radios — not disabled ones (declined on §6.2's
 * forms-not-buttons rule). The second `expect` is the positive control: the read-only line is
 * what rendered instead. Mutation: render the radios unchecked for the kind ⇒ red.
 */
export function anAssetValueRendersNoRadios(): void {
  renderFields("admin", assetValue(), () => {}, ASSETS);

  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  expect(screen.getByText(/Scoped to asset/)).toBeInTheDocument();
}

/** The line names the asset from the `assets` prop, and says why there is no form. Mutation:
 * render the id instead of the name ⇒ red; drop the second sentence ⇒ red. */
export function anAssetValueNamesTheAsset(): void {
  renderFields("admin", assetValue(), () => {}, ASSETS);

  expect(
    screen.getByText(/Scoped to asset Chiller 1\. An asset-scoped dashboard keeps its scope; edit its widgets here\./),
  ).toBeInTheDocument();
}

/** With no matching asset the line falls back to the id, never to an empty name. Mutation:
 * render `""` when the lookup misses ⇒ red. */
export function anAssetValueWithNoMatchingAssetFallsBackToTheId(): void {
  renderFields("admin", assetValue(), () => {}, []);

  expect(screen.getByText(/Scoped to asset a1\./)).toBeInTheDocument();
}

/** An `asset` value is never clamped — no role is "offered" the kind, and the clamp must not
 * read that as "not offered". Mutation: treat `asset` as a kind not offered ⇒ red. */
export function forAnAssetGroupAdminAnAssetValueIsNotClamped(): void {
  const onChange = vi.fn();
  renderFields("asset_group_admin", assetValue(), onChange, ASSETS);

  expect(onChange).not.toHaveBeenCalled();
}

/** Same claim for a role that IS offered every chosen kind. Mutation: as above ⇒ red. */
export function forAdminAnAssetValueIsNotClamped(): void {
  const onChange = vi.fn();
  renderFields("admin", assetValue(), onChange, ASSETS);

  expect(onChange).not.toHaveBeenCalled();
}
