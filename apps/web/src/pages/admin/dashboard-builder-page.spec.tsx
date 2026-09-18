import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { UserRole } from "@bms/shared";

import * as assetGroupsApi from "../../api/admin/asset-groups";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as assetsApi from "../../api/assets";
import * as dashboardsApi from "../../api/dashboards";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { DashboardBuilderPage } from "./dashboard-builder-page";

/**
 * `F3.1d` Unit 7 — the dashboard create page.
 *
 * Assertions live here; `dashboard-builder-page.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR
 * 0042 decision 2).
 *
 * `F3.63` (ADR 0047 Amendment 6 §Q1 point 2): an `asset_group_admin` reaches this page and
 * authors a group dashboard from `/auth/me`'s `scope.assetGroups` — the cases below set that
 * scope on the store first (`http.spec.ts`'s idiom); the `.test.tsx` resets it in `afterEach`,
 * because a reset at the tail of a case never runs when an `expect` throws. The three admin
 * fetches are still spied (`stubMasterData`) so that a regression is RECORDED as a call, not
 * lost as an unhandled `fetch` in jsdom.
 */

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

const ORGANIZATIONS = [
  { id: "org-1", code: "IONX", name: "Ion Exchange", active: true, meta: null, createdAt: new Date(0).toISOString() },
];

const LOCATION = {
  id: "loc-1",
  organizationId: "org-1",
  organizationCode: "IONX",
  organizationName: "Ion Exchange",
  code: "KOL",
  slug: "kolkata-works",
  name: "Kolkata Works",
  type: "smoc_campus" as const,
  province: null,
  capital: null,
  latitude: 0,
  longitude: 0,
  active: true,
  meta: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

/** `fetchAdminAssetGroups`'s real response shape — the full `AdminAssetGroupDto`, no cast, so a
 * missing `organizationId` (the field "choosing a group decides the organization" rests on) fails
 * the compiler rather than the run. */
const ASSET_GROUP = {
  id: "grp-1",
  code: "hvac",
  name: "Hvac",
  description: null,
  locationId: "loc-1",
  locationName: "Kolkata Works",
  organizationId: "org-1",
  memberCount: 3,
  createdAt: new Date(0).toISOString(),
};

/** Stubs every master-data query the page issues — including `fetchAdminAssetGroups` (`F3.34`),
 * without which the asset-groups query hits `fetch` in jsdom and logs an unhandled rejection. */
function stubMasterData(): void {
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: ORGANIZATIONS });
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [LOCATION] });
  vi.spyOn(assetGroupsApi, "fetchAdminAssetGroups").mockResolvedValue({ items: [ASSET_GROUP] });
}

function renderPage(user: AuthUser): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardBuilderPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Plan §10.4 browser-pass item 7, held in jsdom too: no organization-wide
 * option reaches a `location_admin`'s create form, composed page and all. */
export async function locationAdminGetsNoOrganizationWideOptionOnTheComposedPage(): Promise<void> {
  stubMasterData();
  renderPage(asUser("location_admin"));

  await screen.findByRole("radio", { name: "Location" });
  expect(screen.queryByRole("radio", { name: "Organization-wide" })).not.toBeInTheDocument();
}

/** `F3.34` (ADR 0047 Amendment 5) — the create page's body gains `assetGroupId`. Choosing a group
 * sends its id, sends `locationId: null`, and takes the organization from the group DTO. */
export async function creatingWithAnAssetGroupSendsAssetGroupIdAndNoLocationId(): Promise<void> {
  stubMasterData();
  const createSpy = vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue({
    id: "dash-1",
    organizationId: "org-1",
    slug: "hvac-kolkata",
    name: "HVAC Kolkata",
    description: null,
    locationId: null,
    assetGroupId: "grp-1",
    assetId: null,
    assetTemplateId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    widgets: [],
  });
  vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue({} as never);
  renderPage(asUser("admin"));

  await userEvent.type(await screen.findByLabelText("Name"), "HVAC Kolkata");
  await userEvent.type(screen.getByLabelText("Slug"), "hvac-kolkata");
  await userEvent.click(screen.getByRole("radio", { name: "Asset group" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset group" }), "grp-1");
  await userEvent.click(screen.getByRole("button", { name: "Create dashboard" }));

  await waitFor(() => {
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", assetGroupId: "grp-1", locationId: null }),
    );
  });
}

/** The `Asset group` radio is absent from a `location_admin`'s composed create page — the
 * `Location` radio found first is the positive control that the fields rendered at all. */
export async function locationAdminGetsNoAssetGroupOptionOnTheComposedPage(): Promise<void> {
  stubMasterData();
  renderPage(asUser("location_admin"));

  await screen.findByRole("radio", { name: "Location" });
  expect(screen.queryByRole("radio", { name: "Asset group" })).not.toBeInTheDocument();
}

/** Adding a widget places a tile on the canvas and opens it for editing. */
export async function addingAWidgetSelectsItForEditing(): Promise<void> {
  stubMasterData();
  renderPage(asUser("admin"));

  await screen.findByRole("radio", { name: "Organization-wide" });
  await userEvent.click(screen.getByRole("button", { name: /Value tile/i }));

  expect(screen.getByLabelText("Title")).toBeInTheDocument();
  expect(screen.getByText("Bound points")).toBeInTheDocument();
}

/**
 * Review finding — `WidgetInspector` renders only the SELECTED widget's problems, so adding a
 * second widget (which `addWidget` auto-selects) hid the FIRST widget's own problem entirely:
 * `Save` disabled, "Fix the problems… to save", and nothing on the page named which widget or
 * why. This is the exact reproduction the finding names: two value tiles, the second selected,
 * the first (unselected) still missing its required point binding.
 */
export async function anUnselectedWidgetsProblemRendersInTheSummary(): Promise<void> {
  stubMasterData();
  renderPage(asUser("admin"));

  await screen.findByRole("radio", { name: "Organization-wide" });
  await userEvent.click(screen.getByRole("button", { name: "+ Value tile" }));
  await userEvent.click(screen.getByRole("button", { name: "+ Value tile" }));

  // The second widget just added is auto-selected (`addWidget`'s own behaviour); the first is
  // now unselected and still has zero bound points, which `WidgetInspector` cannot show.
  expect(screen.getByRole("button", { name: "Create dashboard" })).toBeDisabled();
  expect(screen.getByText("Fix the problems below to save.")).toBeInTheDocument();
  expect(screen.getByText(/Widget 1 \(Value tile\):/)).toBeInTheDocument();
}

/** The create action stays disabled until name, slug and scope are filled. */
export async function createIsDisabledUntilRequiredFieldsAreFilled(): Promise<void> {
  stubMasterData();
  renderPage(asUser("admin"));

  await screen.findByRole("radio", { name: "Organization-wide" });
  expect(screen.getByRole("button", { name: "Create dashboard" })).toBeDisabled();

  await userEvent.type(screen.getByLabelText("Name"), "Site A Overview");
  await userEvent.type(screen.getByLabelText("Slug"), "site-a-overview");
  await userEvent.click(screen.getByRole("radio", { name: "Organization-wide" }));
  await userEvent.selectOptions(await screen.findByLabelText("Organization"), "org-1");

  expect(screen.getByRole("button", { name: "Create dashboard" })).toBeEnabled();
}

/** `/auth/me`'s scope for an `asset_group_admin` — `accessibleScopeSchema`'s exact shape. The
 * location's id matches the group's `locationId`, so `scopeAssetGroupOptions` resolves the
 * label `Hvac — Western Cape`; a miss would degrade it to `Hvac` for a fixture reason. */
function signInAsAssetGroupAdmin(): void {
  useAuthStore.setState({
    scope: {
      kind: "asset_group",
      locations: [
        { id: "loc-1", code: "WC", slug: "western-cape", name: "Western Cape", type: "smoc_campus", province: null },
      ],
      assetGroups: [{ id: "grp-1", locationId: "loc-1", code: "hvac", name: "Hvac", organizationId: "org-1" }],
      assetIds: ["a1"],
    },
  });
}

/** Renders the role's create page and waits for its one radio, checked — the fields' clamp has
 * rewritten the page's default `location` state to an unchosen group by then. This is the
 * positive control every absence assertion below sits beside. */
async function renderAssetGroupAdminsPage(): Promise<void> {
  stubMasterData();
  signInAsAssetGroupAdmin();
  renderPage(asUser("asset_group_admin"));
  await screen.findByRole("radio", { name: "Asset group", checked: true });
}

/** `GET /admin/organizations` is a 403 for the role; `organizationsQ` is gated on
 * `canCreateOrganizationWideDashboard`. Mutation: drop that `enabled` clause ⇒ red. */
export async function assetGroupAdminsCreateFormDoesNotFetchOrganizations(): Promise<void> {
  await renderAssetGroupAdminsPage();
  expect(organizationsApi.fetchAdminOrganizations).not.toHaveBeenCalled();
}

/** `GET /admin/locations` is a 403 for the role; the hook gates it on
 * `canChooseLocationDashboardScope`. Mutation: drop that clause ⇒ red. */
export async function assetGroupAdminsCreateFormDoesNotFetchLocations(): Promise<void> {
  await renderAssetGroupAdminsPage();
  expect(locationsApi.fetchAdminLocations).not.toHaveBeenCalled();
}

/** `GET /admin/asset-groups` stays refused for the role (Amendment 6 §Q1 point 2); the hook
 * reads the store instead. Mutation: gate the admin query on the group predicate alone ⇒ red. */
export async function assetGroupAdminsCreateFormDoesNotFetchAdminAssetGroups(): Promise<void> {
  await renderAssetGroupAdminsPage();
  expect(assetGroupsApi.fetchAdminAssetGroups).not.toHaveBeenCalled();
}

/** The group list is the store's `scope.assetGroups`, labelled with the location resolved from
 * `scope.locations`. Mutation: feed the role `[]` instead of the store ⇒ red. */
export async function assetGroupAdminsGroupListComesFromItsOwnScope(): Promise<void> {
  await renderAssetGroupAdminsPage();
  expect(await screen.findByRole("option", { name: "Hvac — Western Cape" })).toBeInTheDocument();
}

/** The create body derives `organizationId` from the chosen group's own `organizationId`
 * (`accessAssetGroupSchema`, Unit 2) — the role has no organization list to take it from.
 * Mutation: derive it from `""` ⇒ red. */
export async function assetGroupAdminCreatesAGroupDashboardFromItsOwnScope(): Promise<void> {
  const createSpy = vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue({
    id: "dash-1",
    organizationId: "org-1",
    slug: "hvac-western-cape",
    name: "HVAC Western Cape",
    description: null,
    locationId: null,
    assetGroupId: "grp-1",
    assetId: null,
    assetTemplateId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    widgets: [],
  });
  vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue({} as never);
  await renderAssetGroupAdminsPage();

  await userEvent.type(screen.getByLabelText("Name"), "HVAC Western Cape");
  await userEvent.type(screen.getByLabelText("Slug"), "hvac-western-cape");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset group" }), "grp-1");
  await userEvent.click(screen.getByRole("button", { name: "Create dashboard" }));

  await waitFor(() => {
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", assetGroupId: "grp-1", locationId: null }),
    );
  });
}

/** The `F3.34` residual its closure recorded: a `location_admin` issued an unread
 * `GET /admin/asset-groups` on every builder load. The hook's admin query is gated on
 * `canChooseAssetGroupDashboardScope`, which refuses the role. Mutation: drop the clause ⇒ red. */
export async function locationAdminDoesNotFetchAssetGroups(): Promise<void> {
  stubMasterData();
  renderPage(asUser("location_admin"));

  await screen.findByRole("radio", { name: "Location" });
  expect(assetGroupsApi.fetchAdminAssetGroups).not.toHaveBeenCalled();
}

/** The page passes the AUTHOR's role to `WidgetInspector`, whose `PointPicker` forks on it
 * (Unit 6): for the role the picker's first control is the `Asset` select from
 * `GET /assets?organizationId=`, not the master-data `Location` chain. Surfaced by mutation —
 * a hard-coded `role="admin"` survived every other case in this file. Mutation: pass a
 * constant master-data role ⇒ red. */
export async function assetGroupAdminsWidgetInspectorOffersTheAssetChain(): Promise<void> {
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  await renderAssetGroupAdminsPage();

  // The picker's asset read is gated on a chosen organization, which the group decides.
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset group" }), "grp-1");
  await userEvent.click(screen.getByRole("button", { name: "+ Value tile" }));

  expect(await screen.findByRole("combobox", { name: "Asset" })).toBeInTheDocument();
}

/** A null store scope (no session written yet) is an EMPTY list for the role, not a crash: the
 * hook guards the `scopeAssetGroupOptions` call. The form still renders its one radio and the
 * select with only the placeholder. Mutation: call `scopeAssetGroupOptions` unguarded ⇒ a
 * TypeError on first render ⇒ red. */
export async function assetGroupAdminWithNoStoreScopeGetsAnEmptyGroupList(): Promise<void> {
  stubMasterData();
  useAuthStore.setState({ scope: null });
  renderPage(asUser("asset_group_admin"));

  await screen.findByRole("radio", { name: "Asset group", checked: true });
  const values = within(screen.getByRole("combobox", { name: "Asset group" }))
    .getAllByRole("option")
    .map((option) => (option as HTMLOptionElement).value);
  expect(values).toEqual([""]);
}
